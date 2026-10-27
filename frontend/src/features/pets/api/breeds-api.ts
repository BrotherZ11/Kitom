import { fetchBreedById, fetchBreedCatalog } from '@/features/pets/api/breeds-remote';
import { toPetError } from '@/features/pets/pet-errors';
import type { Breed } from '@/features/pets/types';
import type { Locale } from '@/i18n';
import { supabase } from '@/lib/supabase';

/**
 * Catálogo de razas con el cliente de la app y los errores ya traducidos (`toPetError`). Las lecturas
 * están en `breeds-remote.ts` (puro); la copia del dispositivo, en `offline/breed-catalog-*.ts`.
 */

/** Catálogo completo del idioma (todas las especies, activas e inactivas), ordenado por nombre. */
export async function fetchBreeds(locale: Locale): Promise<Breed[]> {
  try {
    return await fetchBreedCatalog(supabase, locale);
  } catch (error) {
    throw toPetError(error);
  }
}

/** Una raza concreta, aunque esté desactivada. `null` si no existe. */
export async function fetchBreed(breedId: string, locale: Locale): Promise<Breed | null> {
  try {
    return await fetchBreedById(supabase, breedId, locale);
  } catch (error) {
    throw toPetError(error);
  }
}
