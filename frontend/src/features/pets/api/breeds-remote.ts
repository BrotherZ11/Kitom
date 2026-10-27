import type { SupabaseClient } from '@supabase/supabase-js';

import type { Breed } from '@/features/pets/types';
import type { Locale } from '@/i18n';
import type { Database } from '@/types/database.types';

/**
 * Lecturas del catálogo de razas (`breeds`, solo lectura para `authenticated` por RLS). Módulo puro: el
 * cliente se inyecta (se prueba contra el Supabase local). Nombres y alias viven en
 * `catalog_translations` (`entity_type = 'breed'`), tabla polimórfica sin FK: no se puede embeber, así
 * que se piden ambas tablas y se combinan aquí. Lanzan el error de supabase-js tal cual (la UI lo
 * traduce con `toPetError`).
 */

const ALIASES_SEPARATOR = '|';
const BREED_COLUMNS = 'id, code, species_id, is_active';

type BreedRow = { id: string; code: string; species_id: string; is_active: boolean };
type TranslationRow = { entity_id: string; field: string; value: string };

/** La respuesta no trae todas las filas (límite `max_rows` de PostgREST): no se usa ni se guarda. */
export class IncompleteBreedCatalogError extends Error {
  constructor() {
    super('breed_catalog_incomplete');
    this.name = 'IncompleteBreedCatalogError';
  }
}

function toBreed(row: BreedRow, translations: Map<string, TranslationRow[]>): Breed {
  const own = translations.get(row.id) ?? [];
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

function byEntity(rows: TranslationRow[]): Map<string, TranslationRow[]> {
  const map = new Map<string, TranslationRow[]>();
  for (const row of rows) map.set(row.entity_id, [...(map.get(row.entity_id) ?? []), row]);
  return map;
}

function translationsQuery(client: SupabaseClient<Database>, locale: Locale) {
  return client
    .from('catalog_translations')
    .select('entity_id, field, value', { count: 'exact' })
    .eq('entity_type', 'breed')
    .eq('locale', locale)
    .in('field', ['name', 'aliases']);
}

/**
 * Catálogo completo en el idioma: razas de todas las especies, **activas e inactivas** (las inactivas
 * solo sirven para mostrar la raza ya guardada en una mascota), ordenadas por nombre traducido. Una
 * consulta para todo el catálogo (unas 225 razas y 400 traducciones): es lo que se guarda en el
 * dispositivo (`offline/breed-catalog-snapshot.ts`). Si PostgREST recorta alguna de las dos respuestas
 * (`max_rows`), `IncompleteBreedCatalogError`: un catálogo a medias nunca se muestra como completo.
 */
export async function fetchBreedCatalog(client: SupabaseClient<Database>, locale: Locale): Promise<Breed[]> {
  const [breedsResult, translationsResult] = await Promise.all([
    client.from('breeds').select(BREED_COLUMNS, { count: 'exact' }),
    translationsQuery(client, locale),
  ]);
  if (breedsResult.error) throw breedsResult.error;
  if (translationsResult.error) throw translationsResult.error;
  if (breedsResult.count !== breedsResult.data.length || translationsResult.count !== translationsResult.data.length) {
    throw new IncompleteBreedCatalogError();
  }

  const translations = byEntity(translationsResult.data);
  return breedsResult.data
    .map((row) => toBreed(row, translations))
    .sort((a, b) => a.name.localeCompare(b.name, locale));
}

/**
 * Una raza concreta, aunque esté desactivada, cuando no está en el catálogo en memoria (p. ej. se
 * añadió después de cargarlo). `null` si no existe.
 */
export async function fetchBreedById(
  client: SupabaseClient<Database>,
  breedId: string,
  locale: Locale
): Promise<Breed | null> {
  const [breedResult, translationsResult] = await Promise.all([
    client.from('breeds').select(BREED_COLUMNS).eq('id', breedId).maybeSingle(),
    translationsQuery(client, locale).eq('entity_id', breedId),
  ]);
  if (breedResult.error) throw breedResult.error;
  if (translationsResult.error) throw translationsResult.error;

  return breedResult.data ? toBreed(breedResult.data, byEntity(translationsResult.data)) : null;
}
