import type { CatalogAchievement, EarnedAchievement } from '@/features/achievements/achievements-model';
import type { Locale } from '@/i18n';
import { supabase } from '@/lib/supabase';

/**
 * Catálogo de logros con título y descripción traducidos (`catalog_translations` es polimórfica, sin
 * FK: se piden ambas tablas y se combinan aquí, como las especies). Solo lectura: RLS deja leer el
 * catálogo a cualquier usuario autenticado.
 */
export async function fetchAchievementCatalog(locale: Locale): Promise<CatalogAchievement[]> {
  const [catalog, translations] = await Promise.all([
    supabase.from('achievements_catalog').select('id, code, sort_order, criteria'),
    supabase
      .from('catalog_translations')
      .select('entity_id, field, value')
      .eq('entity_type', 'achievement')
      .eq('locale', locale)
      .in('field', ['title', 'description']),
  ]);
  if (catalog.error) throw catalog.error;
  if (translations.error) throw translations.error;
  const text = new Map(translations.data.map((row) => [`${row.entity_id}:${row.field}`, row.value]));
  return catalog.data.map((row) => ({
    id: row.id,
    code: row.code,
    sortOrder: row.sort_order,
    criteria: row.criteria,
    title: text.get(`${row.id}:title`) ?? null,
    description: text.get(`${row.id}:description`) ?? null,
  }));
}

/** Logros conseguidos por una mascota (RLS: miembros de la mascota). Nunca se escriben desde el cliente. */
export async function fetchPetAchievements(petId: string): Promise<EarnedAchievement[]> {
  const { data, error } = await supabase
    .from('pet_achievements')
    .select('achievement_id, earned_at')
    .eq('pet_id', petId);
  if (error) throw error;
  return data.map((row) => ({ achievementId: row.achievement_id, earnedAt: row.earned_at }));
}
