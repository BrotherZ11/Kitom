/**
 * Logros de una mascota (tableros 9.1–9.2). Las insignias las otorga el servidor
 * (`award_pet_achievement`, desde `recompute_pet_streak` y `request_ai_analysis`); aquí solo se combina
 * el catálogo con lo conseguido y se calcula el progreso visible. Módulo puro: se prueba con `npm test`.
 */

export type CatalogAchievement = {
  id: string;
  code: string;
  sortOrder: number;
  /** `achievements_catalog.criteria` tal cual (jsonb). */
  criteria: unknown;
  /** Traducciones (`catalog_translations`); `null` si no hay. */
  title: string | null;
  description: string | null;
};

export type EarnedAchievement = { achievementId: string; earnedAt: string };

export type BadgeState = 'earned' | 'progress' | 'locked' | 'soon';

export type Badge = {
  id: string;
  code: string;
  title: string | null;
  description: string | null;
  state: BadgeState;
  earnedAt: string | null;
  /** Progreso hacia una racha (`{ count, total }`) cuando se puede calcular. */
  progress: { count: number; total: number } | null;
};

type Criteria =
  | { type: 'streak'; days: number }
  | { type: 'count'; metric: string; value: number }
  | { type: 'unknown' };

export function parseCriteria(criteria: unknown): Criteria {
  if (typeof criteria !== 'object' || criteria === null) return { type: 'unknown' };
  const value = criteria as Record<string, unknown>;
  if (value.type === 'streak' && typeof value.days === 'number' && value.days > 0) {
    return { type: 'streak', days: value.days };
  }
  if (value.type === 'count' && typeof value.metric === 'string' && typeof value.value === 'number') {
    return { type: 'count', metric: value.metric, value: value.value };
  }
  return { type: 'unknown' };
}

/** Métricas de recuento que la app ya sabe medir (las demás dependen de funciones aún no disponibles). */
const MEASURABLE_COUNTS = new Set(['daily_logs', 'ai_analysis_requests']);

/**
 * Insignias en el orden del catálogo, con su estado:
 * - `earned`: la ha otorgado el servidor (con su fecha).
 * - `progress`: una racha en curso (`currentStreak` días de `days`).
 * - `locked`: aún no; `soon`: depende de una función que todavía no existe.
 */
export function buildBadges(
  catalog: readonly CatalogAchievement[],
  earned: readonly EarnedAchievement[],
  { currentStreak, loggedAny }: { currentStreak: number; loggedAny: boolean }
): Badge[] {
  const earnedAt = new Map(earned.map((item) => [item.achievementId, item.earnedAt]));
  return [...catalog]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code))
    .map((item) => {
      const at = earnedAt.get(item.id) ?? null;
      const criteria = parseCriteria(item.criteria);
      const base = { id: item.id, code: item.code, title: item.title, description: item.description, earnedAt: at };
      if (at) return { ...base, state: 'earned' as const, progress: null };
      if (criteria.type === 'streak') {
        const count = Math.min(currentStreak, criteria.days);
        return {
          ...base,
          state: count > 0 ? ('progress' as const) : ('locked' as const),
          progress: { count, total: criteria.days },
        };
      }
      if (criteria.type === 'count' && !MEASURABLE_COUNTS.has(criteria.metric)) {
        return { ...base, state: 'soon' as const, progress: null };
      }
      if (criteria.type === 'count' && criteria.metric === 'daily_logs' && loggedAny) {
        // Ya hay registros pero el servidor aún no la ha dado (p. ej. justo al sincronizar).
        return { ...base, state: 'progress' as const, progress: null };
      }
      return { ...base, state: 'locked' as const, progress: null };
    });
}

export function earnedCount(badges: readonly Badge[]): number {
  return badges.filter((badge) => badge.state === 'earned').length;
}
