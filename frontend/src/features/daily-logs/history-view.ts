import type { DailyLog } from '@/features/daily-logs/types';

import { addDays, isoDate, lastDays } from '../../components/ui/chart-geometry.ts';

/**
 * Datos del historial (tableros 6.1, 6.2 y 6.5). Módulo puro: se prueba con `npm test`. Sale de la
 * vista combinada (servidor + pendientes del dispositivo, sin duplicados). Los días sin registro se
 * quedan en blanco: nunca se interpola ni se rellena.
 */

type HistoryLog = Pick<
  DailyLog,
  'log_date' | 'energy_level' | 'appetite_level' | 'mood_level' | 'activity_level' | 'sleep_quality'
>;

export type HistorySeriesId = 'energy' | 'appetite' | 'mood' | 'activity' | 'sleep';

/** Series del gráfico, en orden; cada una con su color y su trazo (no depende solo del color). */
export const HISTORY_SERIES = [
  { id: 'energy', column: 'energy_level', color: 'chartEnergy', dash: undefined },
  { id: 'appetite', column: 'appetite_level', color: 'chartAppetite', dash: '6 4' },
  { id: 'mood', column: 'mood_level', color: 'chartMood', dash: '1 4' },
  { id: 'activity', column: 'activity_level', color: 'chartActivity', dash: '10 3 2 3' },
  { id: 'sleep', column: 'sleep_quality', color: 'chartSleep', dash: '2 2' },
] as const satisfies readonly {
  id: HistorySeriesId;
  column: keyof HistoryLog;
  color: string;
  dash: string | undefined;
}[];

export type HistorySeriesColumn = (typeof HISTORY_SERIES)[number]['column'];

/** Se ven hasta 3 series a la vez (tablero 6.1); al empezar, las tres principales del hábito. */
export const MAX_VISIBLE_SERIES = 3;
export const DEFAULT_SERIES: readonly HistorySeriesId[] = ['energy', 'appetite', 'mood'];

/**
 * Activa o quita una serie. Con 3 activas no se añade otra (hay que quitar una antes); la última no
 * se puede quitar (el gráfico nunca queda vacío).
 */
export function toggleSeries(selected: readonly HistorySeriesId[], id: HistorySeriesId): HistorySeriesId[] {
  if (selected.includes(id)) return selected.length > 1 ? selected.filter((item) => item !== id) : [...selected];
  if (selected.length >= MAX_VISIBLE_SERIES) return [...selected];
  const ids: HistorySeriesId[] = HISTORY_SERIES.map((series) => series.id);
  return ids.filter((item) => item === id || selected.includes(item));
}

/** Valor de una serie en cada fecha (`null` = sin registro o sin indicar). */
export function seriesValues(
  items: readonly HistoryLog[],
  dates: readonly string[],
  column: HistorySeriesColumn
): (number | null)[] {
  const byDate = new Map(items.map((item) => [item.log_date, item]));
  return dates.map((date) => {
    const value = byDate.get(date)?.[column];
    return typeof value === 'number' ? value : null;
  });
}

export type DayRow<T> = { date: string; item: T | null };

/**
 * Filas de «Día a día»: los 7 días que terminan hoy (con hueco «Sin registro» si falta), del más
 * reciente al más antiguo, y después el resto de registros cargados, ya sin huecos.
 */
export function dayRows<T extends { log: { log_date: string } }>(items: readonly T[], today: string): DayRow<T>[] {
  const byDate = new Map(items.map((item) => [item.log.log_date, item]));
  const week = lastDays(today, 7).reverse();
  const weekSet = new Set(week);
  const rows: DayRow<T>[] = week.map((date) => ({ date, item: byDate.get(date) ?? null }));
  const older = items
    .filter((item) => !weekSet.has(item.log.log_date) && item.log.log_date < today)
    .sort((a, b) => (a.log.log_date < b.log.log_date ? 1 : -1));
  return [...rows, ...older.map((item) => ({ date: item.log.log_date, item }))];
}

/** Fechas de un mes (`monthIndex` 0 = enero). */
export function monthDates(year: number, monthIndex: number): string[] {
  const first = isoDate(year, monthIndex, 1);
  const dates: string[] = [];
  for (let date = first; date.slice(0, 7) === first.slice(0, 7); date = addDays(date, 1)) dates.push(date);
  return dates;
}

/**
 * ¿Faltan páginas del historial para ver el mes completo? Mientras el registro más antiguo cargado
 * sea posterior al primer día del mes y el servidor tenga más, hay que cargar más.
 */
export function needsOlderPages(
  items: readonly { log_date: string }[],
  monthStart: string,
  hasMore: boolean
): boolean {
  if (!hasMore) return false;
  const oldest = items.reduce<string | null>((min, item) => (min === null || item.log_date < min ? item.log_date : min), null);
  return oldest === null || oldest > monthStart;
}
