import type { Pet } from '@/features/pets/types';
import type { LocalStore } from '@/lib/local-store/local-store';

import { compareVersions } from '../../daily-logs/offline/daily-log-version.ts';
import {
  isPetId,
  PET_LIST_ID,
  PET_LIST_SNAPSHOT,
  PET_SNAPSHOTS,
  toCachedPet,
  type CachedPet,
  type PetListSnapshot,
  type PetSnapshot,
} from './pet-snapshot.ts';

/**
 * Copias locales de las mascotas de un usuario (`pet-snapshot.ts`), para verlas sin conexión. Módulo
 * puro: el almacén y el reloj se inyectan. Solo lectura respecto al servidor: aquí entran respuestas
 * correctas del servidor (lecturas y filas devueltas por las escrituras online) y nunca sale nada.
 * Una instancia por usuario y proceso (las marcas de lectura viven en memoria).
 *
 * Qué entra: quien llama solo pasa respuestas remotas correctas y autenticadas como el dueño del
 * almacén (`pet-queries.ts`). Un error, una sesión sin comprobar o una respuesta de otra cuenta nunca
 * llegan aquí: por eso una lista vacía solo puede sustituir a otra si el servidor la devolvió.
 *
 * Orden (respuestas fuera de orden):
 * - Cada lectura toma una marca (`beginRead`) **antes** de pedir los datos. Por mascota se recuerda la
 *   marca de la última observación aceptada (presente o ausente).
 * - Una observación con marca posterior manda sobre la visibilidad (la mascota aparece o deja de
 *   verse), pero sus datos nunca retroceden: si la copia es visible y tiene un `updated_at`
 *   estrictamente posterior, se conservan los de la copia.
 * - Una observación con marca anterior (respuesta tardía) solo se acepta si trae los datos de una
 *   mascota que sigue visible con un `updated_at` estrictamente posterior. Una ausencia tardía, o una
 *   presencia tardía de una mascota que una lectura posterior ya no vio, se ignoran.
 * - La lista guardada solo la sustituye una lista con marca posterior a la última aceptada.
 *
 * Límites: `updated_at` lo pone el servidor con `now()` (inicio de la transacción), así que no
 * ordena dos actualizaciones simultáneas ni cambia cuando cambia la visibilidad (p. ej. se revoca un
 * co-tutor): la visibilidad se ordena por la marca de lectura, que es el orden en que salieron las
 * peticiones desde este dispositivo, no el orden en que las atendió el servidor. Una respuesta mal
 * ordenada se corrige con la siguiente lectura. Entre procesos no hay marcas: la primera lectura
 * correcta del proceso se acepta (los datos siguen sin retroceder por `updated_at`).
 *
 * Nada se borra solo: una mascota que el servidor deja de devolver conserva su copia con
 * `unavailableAt` (y sus Daily Logs locales no se tocan). Una copia ilegible (corrupta, de otra
 * versión del formato o de otra clave) se sustituye por la siguiente respuesta correcta del servidor:
 * es una copia de datos del servidor, no contiene nada que solo exista en el dispositivo.
 *
 * Escrituras: de una en una (cola) y de mejor esfuerzo. Si el dispositivo no puede guardar, lo
 * aceptado se mantiene en memoria (las respuestas siguen ordenándose bien en esta sesión) y la
 * siguiente lectura correcta lo vuelve a intentar.
 */

export type ReadMark = number;

/** Lista guardada en el dispositivo. `never_loaded`: nunca se obtuvo una lista correcta del servidor. */
export type LocalPetList =
  | { status: 'never_loaded' }
  | { status: 'loaded'; savedAt: string; pets: CachedPet[] };

export type PetCacheErrorReason = 'storage_failed' | 'invalid_data' | 'unknown_version' | 'missing_pet';

/** No se pudo leer o validar lo guardado. Recuperable: reintentar, o la próxima lectura correcta. */
export class PetCacheError extends Error {
  readonly code = 'local_read_failed';
  readonly reason: PetCacheErrorReason;

  constructor(reason: PetCacheErrorReason, cause?: unknown) {
    super(`local_read_failed: ${reason}`, { cause });
    this.name = 'PetCacheError';
    this.reason = reason;
  }
}

export type PetCacheRepository = {
  readonly userId: string;
  /** Marca para `applyList`/`applyPet`: se toma justo antes de pedir los datos al servidor. */
  beginRead(): ReadMark;
  /** Lista guardada (sin las mascotas que dejaron de estar disponibles). Lanza `PetCacheError`. */
  readList(): Promise<LocalPetList>;
  /** Copia de una mascota, o `null` si nunca se guardó. Lanza `PetCacheError`. */
  readPet(petId: string): Promise<PetSnapshot | null>;
  /**
   * Aplica una lista correcta del servidor. Devuelve la lista que se debe mostrar: la más reciente
   * conocida (si esta respuesta llegó tarde, la de la lectura posterior).
   */
  applyList(mark: ReadMark, rows: readonly Pet[]): Promise<Pet[]>;
  /**
   * Aplica una mascota leída o escrita en el servidor (`null` = no existe o sin acceso). Devuelve la
   * versión más reciente conocida que se debe mostrar, o `null` si no está disponible.
   */
  applyPet(mark: ReadMark, petId: string, row: Pet | null): Promise<Pet | null>;
};

type Entry = { mark: ReadMark; snapshot: PetSnapshot | null };

const isVisible = (snapshot: PetSnapshot | null | undefined): snapshot is PetSnapshot =>
  snapshot != null && snapshot.unavailableAt === null;

export function createPetCacheRepository(
  store: LocalStore,
  { now = () => new Date().toISOString() }: { now?: () => string } = {}
): PetCacheRepository {
  let queue: Promise<unknown> = Promise.resolve();
  let marks = 0;
  /** Última lista aceptada en este proceso (marca y contenido). */
  let listMark: ReadMark = 0;
  let list: PetListSnapshot | null = null;
  /** Estado aceptado por mascota en este proceso (marca y copia; `null` = ausente sin copia). */
  const entries = new Map<string, Entry>();

  const exclusive = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  };

  const ignoreFailure = async (write: () => Promise<void>) => {
    try {
      await write();
    } catch {
      // Mejor esfuerzo: lo aceptado sigue en memoria y la próxima lectura correcta lo reintenta.
    }
  };

  /** Copia actual: la aceptada en este proceso o, si no hay, la guardada (ilegible = sin copia). */
  const currentSnapshot = async (petId: string): Promise<PetSnapshot | null> => {
    const entry = entries.get(petId);
    if (entry) return entry.snapshot;
    try {
      const result = await store.read(PET_SNAPSHOTS, [petId]);
      return result.status === 'found' ? result.value : null;
    } catch {
      return null;
    }
  };

  const storedList = async (): Promise<PetListSnapshot | null> => {
    if (list) return list;
    try {
      const result = await store.read(PET_LIST_SNAPSHOT, PET_LIST_ID);
      return result.status === 'found' ? result.value : null;
    } catch {
      return null;
    }
  };

  const accept = async (petId: string, mark: ReadMark, snapshot: PetSnapshot | null, write: boolean) => {
    entries.set(petId, { mark, snapshot });
    if (write && snapshot) await ignoreFailure(() => store.write(PET_SNAPSHOTS, [petId], snapshot));
  };

  /**
   * Observación de una mascota (`pet` validada o `null` = ausente). Devuelve la copia visible tras
   * aplicarla, o `null`.
   */
  const observe = async (mark: ReadMark, petId: string, pet: CachedPet | null): Promise<PetSnapshot | null> => {
    const lastMark = entries.get(petId)?.mark ?? 0;
    const current = await currentSnapshot(petId);
    const savedAt = now();

    if (mark > lastMark) {
      if (pet === null) {
        // Deja de verse: se conserva la copia, marcada como no disponible.
        const next = current && current.unavailableAt === null ? { ...current, unavailableAt: savedAt } : current;
        await accept(petId, mark, next, next !== current);
        return null;
      }
      // Visible; los datos nunca retroceden (`updated_at` estrictamente posterior en la copia).
      const order = isVisible(current) ? compareVersions(pet.updated_at, current.pet.updated_at) : 1;
      const data = order === -1 || order === null ? current!.pet : pet;
      const next: PetSnapshot = { pet: data, savedAt, unavailableAt: null };
      await accept(petId, mark, next, true);
      return next;
    }

    // Respuesta tardía: solo datos más nuevos de una mascota que sigue visible.
    if (pet && isVisible(current) && compareVersions(pet.updated_at, current.pet.updated_at) === 1) {
      const next: PetSnapshot = { pet, savedAt, unavailableAt: null };
      await accept(petId, lastMark, next, true);
      return next;
    }
    return isVisible(current) ? current : null;
  };

  const writeList = async (next: PetListSnapshot) => {
    list = next;
    await ignoreFailure(() => store.write(PET_LIST_SNAPSHOT, PET_LIST_ID, next));
  };

  const visiblePets = async (petIds: readonly string[]): Promise<Pet[]> => {
    const pets: Pet[] = [];
    for (const petId of petIds) {
      const snapshot = await currentSnapshot(petId);
      if (isVisible(snapshot)) pets.push(snapshot.pet);
    }
    return pets;
  };

  return {
    userId: store.userId,

    beginRead: () => {
      marks += 1;
      return marks;
    },

    readList: () =>
      exclusive(async () => {
        let result;
        try {
          result = await store.read(PET_LIST_SNAPSHOT, PET_LIST_ID);
        } catch (error) {
          throw new PetCacheError('storage_failed', error);
        }
        if (result.status === 'missing') return { status: 'never_loaded' } as const;
        if (result.status === 'unknown_version') throw new PetCacheError('unknown_version');
        if (result.status === 'corrupt') throw new PetCacheError('invalid_data');

        const pets: CachedPet[] = [];
        for (const petId of result.value.petIds) {
          const snapshot = await readSnapshot(petId);
          // Una mascota de la lista sin copia legible: la lista no está completa, no se muestra a medias.
          if (!snapshot) throw new PetCacheError('missing_pet');
          // Dejó de estar disponible después de esa lista (p. ej. al abrir su ficha).
          if (snapshot.unavailableAt === null) pets.push(snapshot.pet);
        }
        return { status: 'loaded', savedAt: result.value.savedAt, pets };
      }),

    readPet: (petId) => exclusive(() => readSnapshot(petId)),

    applyList: (mark, rows) =>
      exclusive(async () => {
        const parsed = rows.map(toCachedPet);
        // Una fila que no se podría volver a leer: no se guarda nada de esta respuesta.
        if (parsed.some((pet) => pet === null)) return [...rows];
        const pets = parsed as CachedPet[];

        const shown: string[] = [];
        for (const pet of pets) {
          if (await observe(mark, pet.id, pet)) shown.push(pet.id);
        }

        if (mark <= listMark) {
          // Lista tardía: manda la de la lectura posterior (las mascotas ya se ordenaron una a una).
          return visiblePets(list?.petIds ?? shown);
        }
        listMark = mark;

        // Las que se veían y ya no vienen: no disponibles, salvo que una lectura posterior diga otra cosa.
        const returned = new Set(pets.map((pet) => pet.id));
        const previous = await storedList();
        const candidates = new Set(previous?.petIds ?? []);
        for (const [petId, entry] of entries) if (isVisible(entry.snapshot)) candidates.add(petId);
        for (const petId of candidates) {
          if (returned.has(petId)) continue;
          if (await observe(mark, petId, null)) shown.push(petId);
        }

        await writeList({ savedAt: now(), petIds: shown });
        return visiblePets(shown);
      }),

    applyPet: (mark, petId, row) =>
      exclusive(async () => {
        if (!isPetId(petId)) return row;
        const pet = row === null ? null : toCachedPet(row);
        if (row !== null && (pet === null || pet.id !== petId)) return row;

        const visible = await observe(mark, petId, pet);
        // La lista guardada refleja lo último que se sabe de cada mascota (alta, borrado, acceso).
        if (mark > listMark) {
          const current = await storedList();
          if (current) {
            const included = current.petIds.includes(petId);
            if (visible && !included) await writeList({ ...current, petIds: [...current.petIds, petId] });
            if (!visible && included) {
              await writeList({ ...current, petIds: current.petIds.filter((id) => id !== petId) });
            }
          }
        }
        return visible?.pet ?? null;
      }),
  };

  async function readSnapshot(petId: string): Promise<PetSnapshot | null> {
    if (!isPetId(petId)) return null;
    let result;
    try {
      result = await store.read(PET_SNAPSHOTS, [petId]);
    } catch (error) {
      throw new PetCacheError('storage_failed', error);
    }
    if (result.status === 'found') return result.value;
    if (result.status === 'missing') return null;
    throw new PetCacheError(result.status === 'unknown_version' ? 'unknown_version' : 'invalid_data');
  }
}
