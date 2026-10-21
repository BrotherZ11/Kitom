import type { Species } from '@/features/pets/types';
import type { LocalCollection } from '@/lib/local-store/local-store';

import { isPetId } from './pet-snapshot.ts';

/**
 * Catálogo de especies guardado en el dispositivo (`kitom:v1:<userId>:species-catalog:<locale>`), para
 * poder crear y editar mascotas sin conexión (fase 8): `species_id` es obligatorio y el catálogo solo
 * existe en el servidor. Se guarda al leerlo con conexión y solo se usa sin ella. Módulo puro.
 */
export type SpeciesSnapshot = { savedAt: string; species: Species[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function parseSpecies(value: unknown): Species | null {
  if (!isRecord(value) || !isPetId(value.id)) return null;
  if (typeof value.code !== 'string' || typeof value.name !== 'string' || typeof value.isActive !== 'boolean') return null;
  return { id: value.id, code: value.code, name: value.name, isActive: value.isActive };
}

export const SPECIES_SNAPSHOT: LocalCollection<SpeciesSnapshot> = {
  name: 'species-catalog',
  version: 1,
  parse(data) {
    if (!isRecord(data) || typeof data.savedAt !== 'string' || !Array.isArray(data.species)) return null;
    const species = data.species.map(parseSpecies);
    return species.every((item) => item !== null) ? { savedAt: data.savedAt, species: species as Species[] } : null;
  },
};
