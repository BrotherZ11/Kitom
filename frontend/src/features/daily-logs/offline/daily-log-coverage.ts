import type { LocalCollection } from '@/lib/local-store/local-store';

import { isLogDate } from './daily-log-content.ts';

/**
 * Cobertura de las copias locales de registros diarios: qué rangos de fechas de una mascota se han
 * leído **completos** del servidor y cuándo (`kitom:v1:<userId>:daily-log-coverage:<petId>`). Sin
 * conexión distingue «no hay registro ese día» de «ese día nunca se descargó» (resumen de bienestar,
 * `docs/proposals/2026-11-10-wellness-reports.md` §5.2). Solo fechas e instantes: nada privado.
 * Módulo puro (`npm test`).
 */

export type CoverageRange = {
  /** `YYYY-MM-DD`, ambos incluidos. */
  start: string;
  end: string;
  /** Instante (ms del dispositivo) de la lectura más antigua que cubre el rango fusionado. */
  fetchedAt: number;
};

export type DailyLogCoverage = { ranges: CoverageRange[] };

/** Como mucho se guardan estos rangos (los más recientes): la cobertura es una ayuda, no un archivo. */
export const MAX_COVERAGE_RANGES = 24;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseRange(value: unknown): CoverageRange | null {
  if (!isRecord(value) || !isLogDate(value.start) || !isLogDate(value.end)) return null;
  if (value.start > value.end) return null;
  if (typeof value.fetchedAt !== 'number' || !Number.isFinite(value.fetchedAt)) return null;
  return { start: value.start, end: value.end, fetchedAt: value.fetchedAt };
}

export const DAILY_LOG_COVERAGE: LocalCollection<DailyLogCoverage> = {
  name: 'daily-log-coverage',
  version: 1,
  parse(data) {
    if (!isRecord(data) || !Array.isArray(data.ranges)) return null;
    const ranges = data.ranges.map(parseRange);
    return ranges.every((range) => range !== null) ? { ranges: ranges as CoverageRange[] } : null;
  },
};

/** Día siguiente a `date` (`YYYY-MM-DD`, aritmética en UTC: sin horarios de verano). */
function nextDay(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}

/**
 * Añade un rango leído completo. Los que se solapan o se tocan se funden; el instante del resultado
 * es el **más antiguo** de los fundidos (así «actualizado el…» nunca promete más de lo que hay).
 */
export function addCoverage(coverage: DailyLogCoverage | null, range: CoverageRange): DailyLogCoverage {
  const all = [...(coverage?.ranges ?? []), range].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const merged: CoverageRange[] = [];
  for (const item of all) {
    const last = merged.at(-1);
    if (last && item.start <= nextDay(last.end)) {
      last.end = item.end > last.end ? item.end : last.end;
      last.fetchedAt = Math.min(last.fetchedAt, item.fetchedAt);
    } else {
      merged.push({ ...item });
    }
  }
  // Una lectura nueva de un rango ya cubierto renueva su instante si lo cubre entero.
  for (const item of merged) {
    if (range.start <= item.start && range.end >= item.end) item.fetchedAt = range.fetchedAt;
  }
  const recent = merged.sort((a, b) => b.fetchedAt - a.fetchedAt).slice(0, MAX_COVERAGE_RANGES);
  return { ranges: recent.sort((a, b) => (a.start < b.start ? -1 : 1)) };
}

/** Rango guardado que contiene `[start, end]` entero, o `null` (sin conexión, los datos son parciales). */
export function coveringRange(coverage: DailyLogCoverage | null, start: string, end: string): CoverageRange | null {
  return coverage?.ranges.find((range) => range.start <= start && range.end >= end) ?? null;
}
