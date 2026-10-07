import { toPetError } from '@/features/pets/pet-errors';
import type { Breed } from '@/features/pets/types';
import type { Locale } from '@/i18n';
import { supabase } from '@/lib/supabase';

/**
 * Catálogo de razas (`breeds`, solo lectura para `authenticated` por RLS). Nombres y alias viven en
 * `catalog_translations` (`entity_type = 'breed'`), tabla polimórfica sin FK: no se puede embeber,
 * así que se piden ambas tablas y se combinan aquí.
 */

const ALIASES_SEPARATOR = '|';

type BreedRow = { id: string; code: string; species_id: string; is_active: boolean };
type TranslationRow = { entity_id: string; field: string; value: string };

function toBreed(row: BreedRow, translations: TranslationRow[]): Breed {
  const own = translations.filter((item) => item.entity_id === row.id);
  const aliases = own.find((item) => item.field === 'aliases')?.value ?? '';
  return {
    id: row.id,
    code: row.code,
    speciesId: row.species_id,
    isActive: row.is_active,
    name: own.find((item) => item.field === 'name')?.value ?? row.code,
    aliases: aliases
      .split(ALIASES_SEPARATOR)
      .map((alias) => alias.trim())
      .filter((alias) => alias !== ''),
  };
}

/** Razas activas de una especie, ordenadas por nombre traducido. */
export async function fetchBreeds(speciesId: string, locale: Locale): Promise<Breed[]> {
  const [breedsResult, translationsResult] = await Promise.all([
    supabase
      .from('breeds')
      .select('id, code, species_id, is_active')
      .eq('species_id', speciesId)
      .eq('is_active', true),
    // Todas las traducciones de razas del idioma (unas 300 filas): evita una URL con cientos de ids.
    supabase
      .from('catalog_translations')
      .select('entity_id, field, value')
      .eq('entity_type', 'breed')
      .eq('locale', locale)
      .in('field', ['name', 'aliases']),
  ]);
  if (breedsResult.error) throw toPetError(breedsResult.error);
  if (translationsResult.error) throw toPetError(translationsResult.error);

  return breedsResult.data
    .map((row) => toBreed(row, translationsResult.data))
    .sort((a, b) => a.name.localeCompare(b.name, locale));
}

/**
 * Una raza concreta, aunque esté desactivada: para mostrar la raza ya guardada en una mascota.
 * `null` si no existe.
 */
export async function fetchBreed(breedId: string, locale: Locale): Promise<Breed | null> {
  const [breedResult, translationsResult] = await Promise.all([
    supabase.from('breeds').select('id, code, species_id, is_active').eq('id', breedId).maybeSingle(),
    supabase
      .from('catalog_translations')
      .select('entity_id, field, value')
      .eq('entity_type', 'breed')
      .eq('entity_id', breedId)
      .eq('locale', locale)
      .in('field', ['name', 'aliases']),
  ]);
  if (breedResult.error) throw toPetError(breedResult.error);
  if (translationsResult.error) throw toPetError(translationsResult.error);

  return breedResult.data ? toBreed(breedResult.data, translationsResult.data) : null;
}
