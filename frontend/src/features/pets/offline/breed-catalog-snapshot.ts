import type { Breed } from '@/features/pets/types';
import type { LocalCollection } from '@/lib/local-store/local-store';

import { isPetId } from './pet-snapshot.ts';

/**
 * Catálogo de razas guardado en el dispositivo (`kitom:v1:<userId>:breed-catalog:<locale>`), para poder
 * buscar y elegir una raza sin conexión (fase 9). Módulo puro (`npm test`).
 *
 * Es el catálogo completo del idioma tal como lo devuelve `fetchBreedCatalog`: razas de todas las
 * especies, activas e inactivas, con su nombre traducido y sus alias, en orden alfabético. Solo datos
 * públicos del catálogo (ni tokens, ni URLs, ni datos del usuario). `breeds: []` = el servidor confirmó
 * que el catálogo está vacío; sin copia = nunca se descargó en este dispositivo. Lo que no valida al
 * leer es una copia no válida (`corrupt`), nunca un catálogo vacío.
 */
export type BreedCatalogSnapshot = {
  /** Idioma de los nombres; debe coincidir con la clave (`matchesKey`). */
  locale: string;
  /** Instante del dispositivo (ISO) en que se guardó. Solo para mostrar «actualizado…». */
  savedAt: string;
  breeds: Breed[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value !== '';

export function parseBreed(value: unknown): Breed | null {
  if (!isRecord(value) || !isPetId(value.id) || !isPetId(value.speciesId)) return null;
  if (!isNonEmptyString(value.code) || !isNonEmptyString(value.name) || typeof value.isActive !== 'boolean') return null;
  if (!Array.isArray(value.aliases) || !value.aliases.every(isNonEmptyString)) return null;
  return {
    id: value.id,
    code: value.code,
    speciesId: value.speciesId,
    isActive: value.isActive,
    name: value.name,
    aliases: [...value.aliases],
  };
}

/** Razas válidas y sin ids repetidos, o `null` si alguna no lo es (no se guarda ni se usa a medias). */
export function parseBreeds(value: unknown): Breed[] | null {
  if (!Array.isArray(value)) return null;
  const breeds: Breed[] = [];
  const ids = new Set<string>();
  for (const item of value) {
    const breed = parseBreed(item);
    if (!breed || ids.has(breed.id)) return null;
    ids.add(breed.id);
    breeds.push(breed);
  }
  return breeds;
}

export const BREED_CATALOG_SNAPSHOT: LocalCollection<BreedCatalogSnapshot> = {
  name: 'breed-catalog',
  version: 1,
  parse(data) {
    if (!isRecord(data) || !isNonEmptyString(data.locale) || !isNonEmptyString(data.savedAt)) return null;
    const breeds = parseBreeds(data.breeds);
    return breeds ? { locale: data.locale, savedAt: data.savedAt, breeds } : null;
  },
  matchesKey: (value, key) => key.id.length === 1 && key.id[0] === value.locale,
};
