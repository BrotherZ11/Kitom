import type { DailyLog, SaveDailyLogArgs } from '@/features/daily-logs/types';

import { parseLogDateParam } from '../daily-log-history.ts';

/**
 * Contenido editable de un registro diario y validación de filas de `daily_logs` leídas del
 * almacén local. Módulo puro (se prueba con `npm test`). Usa los nombres de columna de la BD: es lo
 * que devuelve el servidor y lo que envía `save_daily_log` (`p_<columna>`).
 */

export const LEVEL_COLUMNS = [
  'energy_level',
  'appetite_level',
  'mood_level',
  'activity_level',
  'sleep_quality',
  'vocalization_level',
  'social_interaction_level',
] as const;
export type LevelColumn = (typeof LEVEL_COLUMNS)[number];

/** Las columnas de datos que sustituye `save_daily_log` (el registro completo del día). */
export type DailyLogContent = Record<LevelColumn, number | null> & {
  unusual_behavior: boolean;
  unusual_behavior_notes: string | null;
  notes: string | null;
  tags: string[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** UUID en minúsculas, como lo devuelve Postgres (así coincide con la clave del almacén local). */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/** Fecha real del calendario en `YYYY-MM-DD`. */
export function isLogDate(value: unknown): value is string {
  return parseLogDateParam(value) !== null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLevel(value: unknown): value is number | null {
  return value === null || (Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 5);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** Igual que la RPC: `nullif(btrim(texto, E' \t\r\n'), '')`. */
function normalizeText(value: string | null): string | null {
  const text = (value ?? '').replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
  return text === '' ? null : text;
}

/** Igual que la RPC: sin duplicados y en orden estable. */
export function normalizeTags(tags: readonly string[]): string[] {
  return [...new Set(tags)].sort();
}

/**
 * Forma canónica, la misma que deja `save_daily_log`: así el contenido local y el de una fila del
 * servidor se pueden comparar sin falsos cambios (espacios sobrantes, etiquetas repetidas u orden).
 */
export function normalizeDailyLogContent(content: DailyLogContent): DailyLogContent {
  return {
    energy_level: content.energy_level,
    appetite_level: content.appetite_level,
    mood_level: content.mood_level,
    activity_level: content.activity_level,
    sleep_quality: content.sleep_quality,
    vocalization_level: content.vocalization_level,
    social_interaction_level: content.social_interaction_level,
    unusual_behavior: content.unusual_behavior,
    unusual_behavior_notes: normalizeText(content.unusual_behavior_notes),
    notes: normalizeText(content.notes),
    tags: normalizeTags(content.tags),
  };
}

export function contentFromRow(row: DailyLog): DailyLogContent {
  return normalizeDailyLogContent({
    energy_level: row.energy_level,
    appetite_level: row.appetite_level,
    mood_level: row.mood_level,
    activity_level: row.activity_level,
    sleep_quality: row.sleep_quality,
    vocalization_level: row.vocalization_level,
    social_interaction_level: row.social_interaction_level,
    unusual_behavior: row.unusual_behavior,
    unusual_behavior_notes: row.unusual_behavior_notes,
    notes: row.notes,
    tags: row.tags ?? [],
  });
}

/**
 * Argumentos de `save_daily_log` (sin precondición) para guardar `content` como registro completo del
 * día. Único punto que convierte contenido en parámetros de la RPC.
 */
export function contentToSaveArgs(petId: string, logDate: string, content: DailyLogContent): SaveDailyLogArgs {
  const normalized = normalizeDailyLogContent(content);
  return {
    p_pet_id: petId,
    p_log_date: logDate,
    p_energy_level: normalized.energy_level,
    p_appetite_level: normalized.appetite_level,
    p_mood_level: normalized.mood_level,
    p_activity_level: normalized.activity_level,
    p_sleep_quality: normalized.sleep_quality,
    p_vocalization_level: normalized.vocalization_level,
    p_social_interaction_level: normalized.social_interaction_level,
    p_unusual_behavior: normalized.unusual_behavior,
    p_unusual_behavior_notes: normalized.unusual_behavior_notes,
    p_notes: normalized.notes,
    p_tags: normalized.tags,
  };
}

/** Mismo contenido una vez normalizado. */
export function sameDailyLogContent(a: DailyLogContent, b: DailyLogContent): boolean {
  const left = normalizeDailyLogContent(a);
  const right = normalizeDailyLogContent(b);
  return (
    LEVEL_COLUMNS.every((column) => left[column] === right[column]) &&
    left.unusual_behavior === right.unusual_behavior &&
    left.unusual_behavior_notes === right.unusual_behavior_notes &&
    left.notes === right.notes &&
    left.tags.length === right.tags.length &&
    left.tags.every((tag, index) => tag === right.tags[index])
  );
}

/** Registro vacío según el CHECK `daily_logs_not_empty_check`: el servidor lo rechazaría. */
export function isEmptyDailyLogContent(content: DailyLogContent): boolean {
  const hasText = (value: string | null) => value !== null && /\S/.test(value);
  return (
    LEVEL_COLUMNS.every((column) => content[column] === null) &&
    !content.unusual_behavior &&
    !hasText(content.unusual_behavior_notes) &&
    !hasText(content.notes) &&
    content.tags.length === 0
  );
}

/**
 * Contenido leído del almacén local, o `null` si no tiene la forma esperada. Solo estructura: los
 * límites de texto y el catálogo de etiquetas los decide el servidor (una fila remota puede traer
 * etiquetas que esta versión de la app no conoce y no deben perderse al fusionar).
 */
export function parseDailyLogContent(data: unknown): DailyLogContent | null {
  if (!isRecord(data)) return null;
  if (!LEVEL_COLUMNS.every((column) => isLevel(data[column]))) return null;
  if (typeof data.unusual_behavior !== 'boolean') return null;
  if (!isNullableString(data.unusual_behavior_notes) || !isNullableString(data.notes)) return null;
  if (!isStringArray(data.tags)) return null;
  return normalizeDailyLogContent(data as DailyLogContent);
}

/**
 * Fila de `daily_logs` leída del almacén local, o `null` si no es válida. Devuelve solo las
 * columnas conocidas y deja `updated_at` y `created_at` exactamente como estaban: `updated_at` es
 * la versión que se reenvía al servidor (nunca pasa por `Date`).
 */
export function parseDailyLogRow(data: unknown): DailyLog | null {
  if (!isRecord(data)) return null;
  const content = parseDailyLogContent({ ...data, tags: data.tags ?? [] });
  if (content === null) return null;
  if (typeof data.id !== 'string' || data.id === '') return null;
  if (!isUuid(data.pet_id) || !isLogDate(data.log_date)) return null;
  if (!isNullableString(data.logged_by) || !isNullableString(data.last_edited_by)) return null;
  if (typeof data.created_at !== 'string' || data.created_at === '') return null;
  if (typeof data.updated_at !== 'string' || data.updated_at === '') return null;
  if (data.tags !== null && !isStringArray(data.tags)) return null;
  return {
    id: data.id,
    pet_id: data.pet_id,
    logged_by: data.logged_by,
    last_edited_by: data.last_edited_by,
    log_date: data.log_date,
    energy_level: data.energy_level as number | null,
    appetite_level: data.appetite_level as number | null,
    mood_level: data.mood_level as number | null,
    activity_level: data.activity_level as number | null,
    sleep_quality: data.sleep_quality as number | null,
    vocalization_level: data.vocalization_level as number | null,
    social_interaction_level: data.social_interaction_level as number | null,
    unusual_behavior: data.unusual_behavior as boolean,
    unusual_behavior_notes: data.unusual_behavior_notes as string | null,
    notes: data.notes as string | null,
    tags: data.tags as string[] | null,
    created_at: data.created_at,
    updated_at: data.updated_at,
  };
}
