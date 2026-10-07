import { toPetError } from '@/features/pets/pet-errors';
import type { Species } from '@/features/pets/types';
import type { Locale } from '@/i18n';
import { supabase } from '@/lib/supabase';

/**
 * Catálogo de especies con su nombre traducido. `catalog_translations` es polimórfica (sin FK hacia
 * `species`), así que no se puede embeber: se piden ambas tablas y se combinan aquí.
 * Incluye especies inactivas para poder mostrar la de una mascota existente; el selector de
 * creación ofrece solo las activas.
 */
export async function fetchSpecies(locale: Locale): Promise<Species[]> {
  const [speciesResult, translationsResult] = await Promise.all([
    supabase.from('species').select('id, code, is_active'),
    supabase
      .from('catalog_translations')
      .select('entity_id, value')
      .eq('entity_type', 'species')
      .eq('field', 'name')
      .eq('locale', locale),
  ]);
  if (speciesResult.error) throw toPetError(speciesResult.error);
  if (translationsResult.error) throw toPetError(translationsResult.error);

  const names = new Map(translationsResult.data.map((row) => [row.entity_id, row.value]));

  return speciesResult.data
    .map((row) => ({
      id: row.id,
      code: row.code,
      isActive: row.is_active,
      name: names.get(row.id) ?? row.code,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));
}
