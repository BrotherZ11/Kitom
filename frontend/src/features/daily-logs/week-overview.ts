import type { RingDay } from '@/components/ui/week-ring';
import type { DisplaySyncStatus } from '@/features/daily-logs/offline/daily-log-view';
import type { DailyLog } from '@/features/daily-logs/types';

import { lastDays } from '../../components/ui/chart-geometry.ts';

/**
 * Resumen de la semana para Hoy (tableros 4.1–4.6). Módulo puro: se prueba con `npm test`. Sale solo
 * de registros reales: la vista combinada del historial (servidor + cambios pendientes del
 * dispositivo, sin duplicados por fecha). Nada se rellena ni se estima.
 */

export type OverviewItem = {
  log: Pick<DailyLog, 'log_date' | 'energy_level' | 'appetite_level' | 'mood_level' | 'activity_level'>;
  syncStatus: DisplaySyncStatus;
};

export type WeekOverview = {
  /** Los 7 días que terminan hoy, del más antiguo a hoy. */
  dates: string[];
  /** Los 6 días anteriores a hoy para el anillo (del más antiguo a ayer). */
  days: RingDay[];
  /** Registro de hoy (`null` si falta). */
  today: OverviewItem | null;
  /** Días con registro entre los 7 (hoy incluido). */
  weekCount: number;
  /** Días con registro cargados (para «Así verás su evolución», que solo necesita llegar a 3). */
  loggedCount: number;
  yesterdayLogged: boolean;
  /**
   * Días seguidos con registro que terminan hoy (o ayer, si hoy falta). `null` si no se puede afirmar:
   * la racha llega al registro más antiguo cargado y hay más historial sin cargar.
   */
  streak: number | null;
  /** Valores de las 3 escalas principales en los 7 días (`null` = sin registro o sin indicar). */
  series: Record<'energy' | 'appetite' | 'mood', (number | null)[]>;
};

/** Días con registro a partir de los que el historial empieza a mostrar tendencias (tablero 4.1). */
export const TREND_THRESHOLD = 3;

export function computeWeekOverview(
  items: readonly OverviewItem[],
  today: string,
  { hasMore = false }: { hasMore?: boolean } = {}
): WeekOverview {
  const byDate = new Map<string, OverviewItem>();
  for (const item of items) {
    if (item.log.log_date <= today) byDate.set(item.log.log_date, item);
  }
  const dates = lastDays(today, 7);
  const days = dates.slice(0, 6).map((date): RingDay => (byDate.has(date) ? 'on' : 'off'));
  const todayItem = byDate.get(today) ?? null;
  const yesterday = dates[5];

  // Racha: días consecutivos hacia atrás desde hoy (o desde ayer si hoy falta).
  const sorted = [...byDate.keys()].sort();
  const oldestLoaded = sorted[0] ?? null;
  let streak = 0;
  let cursor = todayItem ? today : yesterday;
  let reachedOldest = false;
  while (byDate.has(cursor)) {
    streak += 1;
    if (cursor === oldestLoaded) {
      reachedOldest = true;
      break;
    }
    cursor = lastDays(cursor, 2)[0];
  }

  const valuesOf = (column: 'energy_level' | 'appetite_level' | 'mood_level') =>
    dates.map((date) => byDate.get(date)?.log[column] ?? null);

  return {
    dates,
    days,
    today: todayItem,
    weekCount: dates.filter((date) => byDate.has(date)).length,
    loggedCount: byDate.size,
    yesterdayLogged: byDate.has(yesterday),
    streak: reachedOldest && hasMore ? null : streak,
    series: { energy: valuesOf('energy_level'), appetite: valuesOf('appetite_level'), mood: valuesOf('mood_level') },
  };
}

/** Qué dice la tarjeta del día (tableros 4.1, 4.2, 4.3 y 4.6). */
export type DayCardMessage =
  | { kind: 'first' }
  | { kind: 'restart' }
  | { kind: 'pending'; weekCount: number }
  | { kind: 'done'; weekCount: number; streak: number | null };

export function dayCardMessage(overview: WeekOverview): DayCardMessage {
  if (overview.today) return { kind: 'done', weekCount: overview.weekCount, streak: overview.streak };
  if (overview.loggedCount === 0) return { kind: 'first' };
  // «Empezáis otra racha hoy» solo si hubo una racha que se cortó ayer (no tras un hueco largo sin
  // contexto): ayer faltó y el día anterior sí hubo registro.
  if (!overview.yesterdayLogged && overview.days[4] === 'on') return { kind: 'restart' };
  return { kind: 'pending', weekCount: overview.weekCount };
}
