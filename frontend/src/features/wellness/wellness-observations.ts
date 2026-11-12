import { CORE_SCALES, dailyDefinition, parseSpeciesData } from '../species/species-fields.ts';
import {
  dailySeries,
  periodWindow,
  scaleGroup,
  type EvolutionSeries,
  type WellnessItem,
  type WellnessPeriod,
} from './wellness-stats.ts';

/**
 * Observaciones del resumen de bienestar (D-9): reglas fijas, descriptivas y con umbral. Nunca
 * correlaciones, causas, tendencias ni patrones por día de la semana; ninguna dice «mejor» o «peor» de
 * una escala relativa, ni sugiere ir al veterinario. Cada observación dice qué días la producen.
 * Módulo puro (`npm test`). El texto lo pone la pantalla; aquí solo los datos.
 */

/** Días seguidos en un mismo grupo (fuera de lo habitual) a partir de los que se señala. */
export const MIN_RUN_DAYS = 3;
/** Días con comportamiento inusual en el periodo a partir de los que se señala. */
export const MIN_UNUSUAL_DAYS = 2;
/** Por debajo de esta proporción de días registrados se avisa de la cobertura (periodos ≥ 7 días). */
export const LOW_COVERAGE_RATIO = 0.5;

export type Observation =
  | {
      kind: 'run';
      series: EvolutionSeries;
      group: 'below' | 'above';
      start: string;
      end: string;
      days: number;
    }
  | { kind: 'yes_run'; code: string; start: string; end: string; days: number }
  | { kind: 'unusual'; dates: string[] }
  | { kind: 'tag'; tag: string; dates: string[] }
  | { kind: 'low_coverage'; logged: number; total: number };

/** Tramos de días consecutivos (sin huecos) con el mismo valor, de al menos `min` días. */
function runs<T>(values: readonly (T | null)[], dates: readonly string[], min: number): { value: T; start: string; end: string; days: number }[] {
  const result: { value: T; start: string; end: string; days: number }[] = [];
  let startIndex = -1;
  const close = (endIndex: number) => {
    const days = endIndex - startIndex + 1;
    if (startIndex >= 0 && days >= min) {
      result.push({ value: values[startIndex] as T, start: dates[startIndex], end: dates[endIndex], days });
    }
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === null) {
      if (startIndex >= 0) close(index - 1);
      startIndex = -1;
      continue;
    }
    if (startIndex >= 0 && values[startIndex] !== value) {
      close(index - 1);
      startIndex = index;
    } else if (startIndex < 0) {
      startIndex = index;
    }
  }
  if (startIndex >= 0) close(values.length - 1);
  return result;
}

export function computeObservations(input: {
  items: readonly WellnessItem[];
  today: string;
  period: WellnessPeriod;
  speciesCode: string | null;
}): Observation[] {
  const { items, today, period, speciesCode } = input;
  const window = periodWindow(today, period);
  const current = items.filter(({ log }) => log.log_date >= window.start && log.log_date <= window.end);
  const definition = dailyDefinition(speciesCode);
  const observations: Observation[] = [];

  // Tramos fuera de lo habitual: escalas comunes que se preguntan a la especie y campos «menos/más».
  const series: EvolutionSeries[] = [
    ...CORE_SCALES.filter((field) => definition.core[field] !== 'hidden')
      .map((field): EvolutionSeries => ({ kind: 'core', field })),
    ...definition.daily.filter((field) => field.kind === 'scale3').map((field): EvolutionSeries => ({ kind: 'species', code: field.code })),
  ];
  const runObservations: Observation[] = [];
  for (const item of series) {
    const groups = dailySeries(current, window.dates, item).map((value) => {
      const group = scaleGroup(value);
      return group === 'usual' ? null : group;
    });
    for (const run of runs(groups, window.dates, MIN_RUN_DAYS)) {
      runObservations.push({ kind: 'run', series: item, group: run.value, start: run.start, end: run.end, days: run.days });
    }
  }

  // Sí/no de la especie marcados varios días seguidos (p. ej. «se escondió»).
  for (const field of definition.daily.filter((item) => item.kind === 'boolean')) {
    const byDate = new Map(current.map(({ log }) => [log.log_date, parseSpeciesData(log.species_data)?.[field.code]]));
    const yes = window.dates.map((date) => (byDate.get(date) === true ? true : null));
    for (const run of runs(yes, window.dates, MIN_RUN_DAYS)) {
      runObservations.push({ kind: 'yes_run', code: field.code, start: run.start, end: run.end, days: run.days });
    }
  }
  // Los más recientes primero.
  runObservations.sort((a, b) => {
    const endA = 'end' in a ? a.end : '';
    const endB = 'end' in b ? b.end : '';
    return endA < endB ? 1 : endA > endB ? -1 : 0;
  });
  observations.push(...runObservations);

  const unusual = current.filter(({ log }) => log.unusual_behavior).map(({ log }) => log.log_date).sort();
  if (unusual.length >= MIN_UNUSUAL_DAYS) observations.push({ kind: 'unusual', dates: unusual });

  const tags = new Map<string, string[]>();
  for (const { log } of current) for (const tag of log.tags ?? []) tags.set(tag, [...(tags.get(tag) ?? []), log.log_date]);
  for (const [tag, dates] of [...tags.entries()].sort((a, b) => b[1].length - a[1].length)) {
    observations.push({ kind: 'tag', tag, dates: dates.sort() });
  }

  const logged = current.length;
  if (window.dates.length >= 7 && logged > 0 && logged / window.dates.length < LOW_COVERAGE_RATIO) {
    observations.push({ kind: 'low_coverage', logged, total: window.dates.length });
  }

  return observations;
}
