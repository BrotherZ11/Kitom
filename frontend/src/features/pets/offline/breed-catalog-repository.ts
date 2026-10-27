import type { Breed } from '@/features/pets/types';
import type { LocalStore } from '@/lib/local-store/local-store';

import { BREED_CATALOG_SNAPSHOT, parseBreeds, type BreedCatalogSnapshot } from './breed-catalog-snapshot.ts';
import type { ReadMark } from './pet-cache-repository.ts';

/**
 * Copia del catálogo de razas en el dispositivo (`breed-catalog-snapshot.ts`), por usuario e idioma.
 * Módulo puro: el almacén y el reloj se inyectan. Una instancia por usuario y proceso (las marcas de
 * lectura viven en memoria), como la copia de mascotas (`pet-cache-repository.ts`).
 *
 * Qué entra: solo catálogos correctos del servidor (`breed-catalog-queries.ts`): un error de red, de
 * sesión o del servidor lanza antes de llegar aquí, así que nunca borra ni vacía una copia válida.
 *
 * Orden: cada lectura toma una marca (`beginRead`) antes de pedir el catálogo; una respuesta con marca
 * anterior o igual a la del último catálogo aceptado de ese idioma llegó tarde y no sustituye al más
 * reciente (se devuelve este). Entre procesos no hay marcas: la primera respuesta correcta del proceso
 * se acepta (se pidió después de todo lo guardado por procesos anteriores). No hay coordinación entre
 * pestañas de web (limitación conocida de todo el modo offline).
 *
 * Copia no válida (corrupta, de otra versión del formato o de otro idioma): se informa (`onProblem`,
 * solo el motivo, nunca el contenido), se trata como «sin catálogo» y la sustituye la siguiente
 * respuesta correcta del servidor; no contiene nada que solo exista en el dispositivo.
 *
 * Escrituras: de una en una (cola) y de mejor esfuerzo. Si el dispositivo no puede guardar, lo
 * aceptado se mantiene en memoria para este proceso y la siguiente respuesta correcta lo reintenta.
 */

/** Catálogo guardado. `invalid`: había algo guardado, pero no se puede usar. */
export type LocalBreedCatalog =
  | { status: 'never_loaded' }
  | { status: 'invalid'; reason: 'invalid_data' | 'unknown_version' }
  | { status: 'loaded'; savedAt: string; breeds: Breed[] };

export type BreedCatalogProblem = 'invalid_data' | 'unknown_version' | 'write_failed';

/** No se pudo leer el almacenamiento del dispositivo. Recuperable: reintentar. */
export class BreedCatalogError extends Error {
  readonly code = 'local_read_failed';
  readonly reason = 'storage_failed';

  constructor(cause?: unknown) {
    super('local_read_failed: storage_failed', { cause });
    this.name = 'BreedCatalogError';
  }
}

export type BreedCatalogRepository = {
  readonly userId: string;
  /** Marca para `apply`: se toma justo antes de pedir el catálogo al servidor. */
  beginRead(): ReadMark;
  /** Catálogo guardado de un idioma. Lanza `BreedCatalogError` si falla el almacenamiento. */
  read(locale: string): Promise<LocalBreedCatalog>;
  /**
   * Aplica un catálogo correcto del servidor. Devuelve el que se debe mostrar: el más reciente conocido
   * (si esta respuesta llegó tarde, el de la lectura posterior).
   */
  apply(mark: ReadMark, locale: string, breeds: readonly Breed[]): Promise<Breed[]>;
};

export function createBreedCatalogRepository(
  store: LocalStore,
  {
    now = () => new Date().toISOString(),
    onProblem = () => {},
  }: { now?: () => string; onProblem?: (problem: BreedCatalogProblem) => void } = {}
): BreedCatalogRepository {
  let queue: Promise<unknown> = Promise.resolve();
  let marks = 0;
  /** Último catálogo aceptado por idioma en este proceso. */
  const accepted = new Map<string, { mark: ReadMark; snapshot: BreedCatalogSnapshot }>();

  const exclusive = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  };

  return {
    userId: store.userId,

    beginRead: () => {
      marks += 1;
      return marks;
    },

    read: (locale) =>
      exclusive(async () => {
        const current = accepted.get(locale);
        if (current) return { status: 'loaded', savedAt: current.snapshot.savedAt, breeds: current.snapshot.breeds };

        let result;
        try {
          result = await store.read(BREED_CATALOG_SNAPSHOT, [locale]);
        } catch (error) {
          throw new BreedCatalogError(error);
        }
        if (result.status === 'missing') return { status: 'never_loaded' };
        if (result.status === 'found') {
          return { status: 'loaded', savedAt: result.value.savedAt, breeds: result.value.breeds };
        }
        const reason = result.status === 'unknown_version' ? 'unknown_version' : 'invalid_data';
        onProblem(reason);
        return { status: 'invalid', reason };
      }),

    apply: (mark, locale, rows) =>
      exclusive(async () => {
        const breeds = parseBreeds(rows);
        // Una fila que no se podría volver a leer: se muestra lo recibido, pero no se guarda.
        if (!breeds) return [...rows];

        const current = accepted.get(locale);
        if (current && mark <= current.mark) return current.snapshot.breeds;

        const snapshot: BreedCatalogSnapshot = { locale, savedAt: now(), breeds };
        accepted.set(locale, { mark, snapshot });
        try {
          await store.write(BREED_CATALOG_SNAPSHOT, [locale], snapshot);
        } catch {
          // Mejor esfuerzo: queda en memoria y la próxima respuesta correcta lo reintenta.
          onProblem('write_failed');
        }
        return breeds;
      }),
  };
}
