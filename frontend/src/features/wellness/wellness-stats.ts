import type { DailyLog } from '@/features/daily-logs/types';

import {
  CORE_SCALES,
  dailyDefinition,
  parseSpeciesData,
  type CoreScale,
  type SpeciesFieldKind,
  type SpeciesFieldUnit,
  type SpeciesValue,
} from '../species/species-fields.ts';

/**
 * Resumen de bienestar de una mascota (fase 15, `docs/proposals/2026-11-10-wellness-reports.md`, D-1 a
 * D-13). Módulo puro (`npm test`). Describe lo registrado, no lo interpreta:
 * - Cada escala se resume como **reparto de días** en tres grupos (por debajo de lo habitual / como
 *   siempre / por encima), siempre con su `n`. Nunca medias ni un índice global: las escalas son
 *   ordinales, relativas a «lo habitual» y de tipos distintos (D-1, D-2).
 * - Los días sin registro no cuentan en ningún denominador de escala; las escalas sin indicar, tampoco.
 * - Por debajo de un mínimo de valores (D-4) no hay reparto ni comparación: «pocos datos (n)».
 * - Las cantidades con unidad (paseos, minutos, peso, temperatura) sí son números: mediana, mínimo y
 *   máximo, con `n`.
 * Sale de la vista combinada (servidor + pendientes del dispositivo), como el historial.
 */

export const WELLNESS_PERIODS = [7, 30, 90] as const;
export type WellnessPeriod = (typeof WELLNESS_PERIODS)[number];

/** Valores mínimos de una escala para mostrar su reparto (y, en los dos periodos, para comparar). */
export const MIN_VALUES: Readonly<Record<WellnessPeriod, number>> = { 7: 4, 30: 12, 90: 30 };

/** Registros (en todo lo leído) a partir de los que hay resumen (como el historial, tablero 6.5). */
export const SUMMARY_MIN_LOGGED = 3;

export type ScaleGroup = 'below' | 'usual' | 'above';
export type Distribution = Record<ScaleGroup, number>;

export type WellnessLog = Pick<
  DailyLog,
  | 'log_date'
  | 'energy_level'
  | 'appetite_level'
  | 'mood_level'
  | 'activity_level'
  | 'sleep_quality'
  | 'vocalization_level'
  | 'social_interaction_level'
  | 'unusual_behavior'
  | 'tags'
> & { species_data?: unknown };

export type WellnessItem = { log: WellnessLog; syncStatus: string };

const CORE_COLUMN: Record<CoreScale, keyof WellnessLog> = {
  energy: 'energy_level',
  appetite: 'appetite_level',
  mood: 'mood_level',
  activity: 'activity_level',
  sleep: 'sleep_quality',
  vocalization: 'vocalization_level',
  social: 'social_interaction_level',
};

// ---------------------------------------------------------------------------------------------
// Fechas (aritmética en UTC: `YYYY-MM-DD` sin horarios de verano)
// ---------------------------------------------------------------------------------------------

export function addDaysIso(date: string, days: number): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

export type DateWindow = { start: string; end: string; dates: string[] };

/** Los `period` días que terminan `today` (incluido), del más antiguo a hoy (D-3). */
export function periodWindow(today: string, period: number): DateWindow {
  const start = addDaysIso(today, -(period - 1));
  const dates: string[] = [];
  for (let date = start; date <= today; date = addDaysIso(date, 1)) dates.push(date);
  return { start, end: today, dates };
}

/** El periodo anterior de la misma longitud. */
export function previousWindow(today: string, period: number): DateWindow {
  return periodWindow(addDaysIso(today, -period), period);
}

/** Rango que hay que leer para un periodo y su comparación (2 × periodo). */
export function fetchRange(today: string, period: number): { start: string; end: string } {
  return { start: addDaysIso(today, -(2 * period - 1)), end: today };
}

// ---------------------------------------------------------------------------------------------
// Grupos y repartos
// ---------------------------------------------------------------------------------------------

/** 1–2 por debajo, 3 como siempre, 4–5 por encima (también los detalles antiguos 1 y 5). */
export function scaleGroup(value: unknown): ScaleGroup | null {
  if (value === 1 || value === 2) return 'below';
  if (value === 3) return 'usual';
  if (value === 4 || value === 5) return 'above';
  return null;
}

export function emptyDistribution(): Distribution {
  return { below: 0, usual: 0, above: 0 };
}

function distributionOf(values: readonly unknown[]): { distribution: Distribution; n: number } {
  const distribution = emptyDistribution();
  let n = 0;
  for (const value of values) {
    const group = scaleGroup(value);
    if (group === null) continue;
    distribution[group] += 1;
    n += 1;
  }
  return { distribution, n };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------------------------
// Resumen
// ---------------------------------------------------------------------------------------------

export type ScaleSummary = {
  field: CoreScale;
  role: 'primary' | 'optional';
  /** Días con valor indicado en el periodo. */
  n: number;
  distribution: Distribution;
  /** `n` alcanza el mínimo del periodo: se puede mostrar el reparto. */
  sufficient: boolean;
  last: { date: string; value: number } | null;
  /** Solo si los dos periodos alcanzan el mínimo. */
  comparison: { previous: Distribution; previousN: number } | null;
};

export type SpeciesFieldSummary =
  | {
      code: string;
      kind: 'scale3';
      n: number;
      distribution: Distribution;
      sufficient: boolean;
      comparison: { previous: Distribution; previousN: number } | null;
    }
  | { code: string; kind: 'boolean'; n: number; yes: number; sufficient: boolean }
  | { code: string; kind: 'choice' | 'multi_choice'; n: number; counts: Record<string, number>; options: readonly string[] }
  | {
      code: string;
      kind: 'integer' | 'decimal';
      unit: SpeciesFieldUnit | null;
      n: number;
      sufficient: boolean;
      median: number | null;
      min: number | null;
      max: number | null;
      previousMedian: number | null;
    };

export type WellnessSummary = {
  period: WellnessPeriod;
  window: DateWindow;
  previous: DateWindow;
  /** Días con registro en el periodo y días del periodo. */
  loggedDays: number;
  totalDays: number;
  todayLogged: boolean;
  /** Días del periodo con cambios del dispositivo sin confirmar (pendientes, fallidos o en conflicto). */
  unsyncedDays: number;
  /** Registros en todo lo leído (los dos periodos): con menos de 3 aún no hay resumen. */
  totalLogged: number;
  /** Hay registros anteriores al periodo (para «no hay registros en los últimos 7 días»). */
  hasEarlierLogs: boolean;
  scales: ScaleSummary[];
  speciesFields: SpeciesFieldSummary[];
  unusualDates: string[];
  tags: { tag: string; dates: string[] }[];
};

function inWindow(window: DateWindow, date: string): boolean {
  return date >= window.start && date <= window.end;
}

function speciesValues(items: readonly WellnessItem[], code: string): { date: string; value: SpeciesValue }[] {
  return items.flatMap(({ log }) => {
    const data = parseSpeciesData(log.species_data);
    const value = data?.[code];
    return value === undefined ? [] : [{ date: log.log_date, value }];
  });
}

/**
 * Resumen de un periodo. `items`: registros del rango leído (al menos los dos periodos; puede haber
 * más). `speciesCode`: especie de la mascota (qué escalas y campos se resumen); `null` = las escalas de
 * siempre y ningún campo propio.
 */
export function summarizeWellness(input: {
  items: readonly WellnessItem[];
  today: string;
  period: WellnessPeriod;
  speciesCode: string | null;
}): WellnessSummary {
  const { items, today, period, speciesCode } = input;
  const window = periodWindow(today, period);
  const previous = previousWindow(today, period);
  const current = items.filter(({ log }) => inWindow(window, log.log_date));
  const before = items.filter(({ log }) => inWindow(previous, log.log_date));
  const minimum = MIN_VALUES[period];
  const definition = dailyDefinition(speciesCode);

  const scales: ScaleSummary[] = CORE_SCALES.flatMap((field) => {
    const role = definition.core[field];
    if (role === 'hidden') return [];
    const column = CORE_COLUMN[field];
    const now = distributionOf(current.map(({ log }) => log[column]));
    const prior = distributionOf(before.map(({ log }) => log[column]));
    const sufficient = now.n >= minimum;
    const latest = [...current]
      .filter(({ log }) => typeof log[column] === 'number')
      .sort((a, b) => (a.log.log_date < b.log.log_date ? 1 : -1))[0];
    return [
      {
        field,
        role,
        n: now.n,
        distribution: now.distribution,
        sufficient,
        last: latest ? { date: latest.log.log_date, value: latest.log[column] as number } : null,
        comparison: sufficient && prior.n >= minimum ? { previous: prior.distribution, previousN: prior.n } : null,
      },
    ];
  });

  const speciesFields: SpeciesFieldSummary[] = definition.daily.flatMap((field): SpeciesFieldSummary[] => {
    const now = speciesValues(current, field.code);
    const prior = speciesValues(before, field.code);
    const kind: SpeciesFieldKind = field.kind;
    if (kind === 'scale3') {
      const a = distributionOf(now.map((item) => item.value));
      const b = distributionOf(prior.map((item) => item.value));
      const sufficient = a.n >= minimum;
      return [
        {
          code: field.code,
          kind,
          n: a.n,
          distribution: a.distribution,
          sufficient,
          comparison: sufficient && b.n >= minimum ? { previous: b.distribution, previousN: b.n } : null,
        },
      ];
    }
    if (kind === 'boolean') {
      const values = now.filter((item) => typeof item.value === 'boolean');
      return [
        {
          code: field.code,
          kind,
          n: values.length,
          yes: values.filter((item) => item.value === true).length,
          sufficient: values.length >= minimum,
        },
      ];
    }
    if (kind === 'choice' || kind === 'multi_choice') {
      const counts: Record<string, number> = {};
      let n = 0;
      for (const { value } of now) {
        const chosen = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
        if (chosen.length === 0) continue;
        n += 1;
        for (const option of chosen) counts[option] = (counts[option] ?? 0) + 1;
      }
      return [{ code: field.code, kind, n, counts, options: field.options ?? [] }];
    }
    if (kind === 'integer' || kind === 'decimal') {
      const numbers = now.map((item) => item.value).filter((value): value is number => typeof value === 'number');
      const priorNumbers = prior.map((item) => item.value).filter((value): value is number => typeof value === 'number');
      const sufficient = numbers.length >= minimum;
      return [
        {
          code: field.code,
          kind,
          unit: field.unit ?? null,
          n: numbers.length,
          sufficient,
          median: numbers.length > 0 ? median(numbers) : null,
          min: numbers.length > 0 ? Math.min(...numbers) : null,
          max: numbers.length > 0 ? Math.max(...numbers) : null,
          previousMedian: sufficient && priorNumbers.length >= minimum ? median(priorNumbers) : null,
        },
      ];
    }
    return [];
  });

  const tagDates = new Map<string, string[]>();
  for (const { log } of current) {
    for (const tag of log.tags ?? []) tagDates.set(tag, [...(tagDates.get(tag) ?? []), log.log_date]);
  }

  return {
    period,
    window,
    previous,
    loggedDays: current.length,
    totalDays: window.dates.length,
    todayLogged: current.some(({ log }) => log.log_date === today),
    unsyncedDays: current.filter(({ syncStatus }) => syncStatus !== 'synced').length,
    totalLogged: items.filter(({ log }) => log.log_date <= today).length,
    hasEarlierLogs: items.some(({ log }) => log.log_date < window.start),
    scales,
    speciesFields,
    unusualDates: current
      .filter(({ log }) => log.unusual_behavior)
      .map(({ log }) => log.log_date)
      .sort(),
    tags: [...tagDates.entries()]
      .map(([tag, dates]) => ({ tag, dates: dates.sort() }))
      .sort((a, b) => b.dates.length - a.dates.length || (a.tag < b.tag ? -1 : 1)),
  };
}

// ---------------------------------------------------------------------------------------------
// Evolución
// ---------------------------------------------------------------------------------------------

/** Una serie de la evolución: una escala común o un campo de la especie de tipo `scale3`. */
export type EvolutionSeries = { kind: 'core'; field: CoreScale } | { kind: 'species'; code: string };

function seriesValue(log: WellnessLog, series: EvolutionSeries): number | null {
  if (series.kind === 'core') {
    const value = log[CORE_COLUMN[series.field]];
    return typeof value === 'number' ? value : null;
  }
  const value = parseSpeciesData(log.species_data)?.[series.code];
  return typeof value === 'number' ? value : null;
}

/** Valor de una serie en cada fecha (`null` = sin registro o sin indicar; nunca se rellena). */
export function dailySeries(items: readonly WellnessItem[], dates: readonly string[], series: EvolutionSeries): (number | null)[] {
  const byDate = new Map(items.map(({ log }) => [log.log_date, log]));
  return dates.map((date) => {
    const log = byDate.get(date);
    return log ? seriesValue(log, series) : null;
  });
}

export type WeekBucket = { start: string; end: string; distribution: Distribution; withoutValue: number };

/**
 * Semanas (de 7 días, terminando hoy) con el reparto de días de una serie: lo que se dibuja en 90
 * días, donde una línea diaria con huecos no se lee. `withoutValue`: días de la semana sin dato.
 */
export function weeklyDistributions(
  items: readonly WellnessItem[],
  today: string,
  series: EvolutionSeries,
  weeks: number
): WeekBucket[] {
  const byDate = new Map(items.map(({ log }) => [log.log_date, log]));
  const buckets: WeekBucket[] = [];
  for (let index = weeks - 1; index >= 0; index -= 1) {
    const end = addDaysIso(today, -7 * index);
    const window = periodWindow(end, 7);
    const distribution = emptyDistribution();
    let withoutValue = 0;
    for (const date of window.dates) {
      const log = byDate.get(date);
      const group = log ? scaleGroup(seriesValue(log, series)) : null;
      if (group === null) withoutValue += 1;
      else distribution[group] += 1;
    }
    buckets.push({ start: window.start, end, distribution, withoutValue });
  }
  return buckets;
}
