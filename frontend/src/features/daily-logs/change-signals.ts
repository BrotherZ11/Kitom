import type { DailyLog } from '@/features/daily-logs/types';

import { lastDays } from '../../components/ui/chart-geometry.ts';

/**
 * Señales de cambio para Hoy: compara los últimos días con las semanas anteriores de la misma mascota.
 * Es una comparación con lo que ha registrado el tutor, nunca una valoración médica: no interpreta causas
 * ni urgencia y solo se muestra con datos suficientes. Módulo puro: se prueba con `npm test`.
 * Sale de la primera página del historial combinado (servidor + dispositivo): también funciona sin conexión.
 */

/** Días que terminan hoy y se comparan. */
export const SIGNAL_RECENT_DAYS = 3;
/** Días anteriores a los recientes que forman «lo normal». */
export const SIGNAL_BASELINE_DAYS = 28;
/** Mínimo de registros recientes de una escala: un solo día distinto no es un cambio. */
export const SIGNAL_MIN_RECENT = 2;
/** Mínimo de registros para saber qué es lo normal. */
export const SIGNAL_MIN_BASELINE = 7;
/** Diferencia mínima de medias, en puntos de la escala 1–5. */
export const SIGNAL_MIN_DELTA = 1;
/** Cada día reciente debe apartarse al menos esto de lo normal y hacia el mismo lado. */
const SIGNAL_MIN_DAY_DELTA = 0.5;

const METRICS = [
  { metric: 'appetite', field: 'appetite_level' },
  { metric: 'mood', field: 'mood_level' },
  { metric: 'energy', field: 'energy_level' },
  { metric: 'activity', field: 'activity_level' },
] as const;

export type SignalMetric = (typeof METRICS)[number]['metric'];

export type ChangeSignal =
  | { kind: 'scale'; metric: SignalMetric; direction: 'lower' | 'higher'; delta: number }
  | { kind: 'unusual'; days: number };

type SignalLog = Pick<
  DailyLog,
  'log_date' | 'appetite_level' | 'mood_level' | 'energy_level' | 'activity_level' | 'unusual_behavior'
>;

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Señales de más a menos marcadas; vacío si no hay datos suficientes o nada ha cambiado. */
export function computeChangeSignals(items: readonly { log: SignalLog }[], today: string): ChangeSignal[] {
  const recentDates = lastDays(today, SIGNAL_RECENT_DAYS);
  const recentStart = recentDates[0];
  const baselineStart = lastDays(today, SIGNAL_RECENT_DAYS + SIGNAL_BASELINE_DAYS)[0];

  const recent = items.filter(({ log }) => log.log_date >= recentStart && log.log_date <= today).map(({ log }) => log);
  const baseline = items
    .filter(({ log }) => log.log_date >= baselineStart && log.log_date < recentStart)
    .map(({ log }) => log);

  const scale: Extract<ChangeSignal, { kind: 'scale' }>[] = [];
  for (const { metric, field } of METRICS) {
    const recentValues = recent.flatMap((log) => (log[field] === null ? [] : [log[field] as number]));
    const baselineValues = baseline.flatMap((log) => (log[field] === null ? [] : [log[field] as number]));
    if (recentValues.length < SIGNAL_MIN_RECENT || baselineValues.length < SIGNAL_MIN_BASELINE) continue;

    const normal = mean(baselineValues);
    const delta = mean(recentValues) - normal;
    if (Math.abs(delta) < SIGNAL_MIN_DELTA) continue;
    const sign = Math.sign(delta);
    if (!recentValues.every((value) => (value - normal) * sign >= SIGNAL_MIN_DAY_DELTA)) continue;
    // Mejor ánimo que de costumbre no es algo sobre lo que avisar.
    if (metric === 'mood' && sign > 0) continue;

    scale.push({ kind: 'scale', metric, direction: sign < 0 ? 'lower' : 'higher', delta: Math.abs(delta) });
  }
  scale.sort((a, b) => b.delta - a.delta);

  const unusualDays = recent.filter((log) => log.unusual_behavior).length;
  // Con la misma exigencia de historial: sin saber qué es lo normal, no se compara.
  const unusual: ChangeSignal[] =
    unusualDays >= SIGNAL_MIN_RECENT && baseline.length >= SIGNAL_MIN_BASELINE ? [{ kind: 'unusual', days: unusualDays }] : [];

  return [...unusual, ...scale];
}
