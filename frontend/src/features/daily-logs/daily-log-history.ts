import type { SupabaseClient } from '@supabase/supabase-js';

import type { DailyLog } from '@/features/daily-logs/types';
import type { Database } from '@/types/database.types';

/**
 * Historial de registros diarios: consulta paginada y ayudas para la caché. Módulo puro (el cliente
 * de Supabase se recibe como parámetro; solo imports de tipos): se prueba con `npm test` y con la
 * integración contra el Supabase local.
 *
 * Paginación por cursor (keyset) sobre `log_date`, que es único por mascota
 * (`UNIQUE (pet_id, log_date)`, índice `idx_daily_logs_pet_date`): estable aunque se añadan
 * registros mientras se navega, a diferencia de `offset`.
 */

export const DAILY_LOG_COLUMNS =
  'id, pet_id, logged_by, last_edited_by, log_date, energy_level, appetite_level, mood_level, activity_level, sleep_quality, vocalization_level, social_interaction_level, unusual_behavior, unusual_behavior_notes, notes, tags, created_at, updated_at';

export const HISTORY_PAGE_SIZE = 20;

export type DailyLogHistoryPage = {
  /** Registros de la página, `log_date` descendente. */
  logs: DailyLog[];
  /** `log_date` desde el que pedir la página siguiente (exclusivo), o `null` si no hay más. */
  nextCursor: string | null;
};

/**
 * Página a partir de las filas pedidas con `limit(pageSize + 1)`: la fila sobrante solo indica que
 * hay más, sin una consulta extra al final.
 */
export function toHistoryPage(rows: DailyLog[], pageSize: number = HISTORY_PAGE_SIZE): DailyLogHistoryPage {
  const logs = rows.slice(0, pageSize);
  return {
    logs,
    nextCursor: rows.length > pageSize ? (logs[logs.length - 1]?.log_date ?? null) : null,
  };
}

/** Una página del historial de una mascota. Solo filtra por `pet_id`: RLS decide el acceso. */
export async function queryHistoryPage(
  client: SupabaseClient<Database>,
  petId: string,
  cursor: string | null,
  pageSize: number = HISTORY_PAGE_SIZE
): Promise<DailyLogHistoryPage> {
  let query = client.from('daily_logs').select(DAILY_LOG_COLUMNS).eq('pet_id', petId);
  if (cursor) query = query.lt('log_date', cursor);
  const { data, error } = await query.order('log_date', { ascending: false }).limit(pageSize + 1);
  if (error) throw error;
  return toHistoryPage(data, pageSize);
}

/** Registros de todas las páginas cargadas, sin duplicados y en `log_date` descendente. */
export function flattenHistory(pages: readonly DailyLogHistoryPage[]): DailyLog[] {
  const byDate = new Map<string, DailyLog>();
  for (const page of pages) {
    for (const log of page.logs) {
      if (!byDate.has(log.log_date)) byDate.set(log.log_date, log);
    }
  }
  return [...byDate.values()].sort((a, b) => (a.log_date < b.log_date ? 1 : a.log_date > b.log_date ? -1 : 0));
}

/**
 * Sustituye en las páginas cargadas el registro guardado (misma mascota y fecha), para que la lista
 * no muestre datos antiguos mientras se revalida. Si no estaba cargado, no cambia nada.
 */
export function replaceLogInHistory<T extends { pages: DailyLogHistoryPage[] }>(data: T, log: DailyLog): T {
  let changed = false;
  const pages = data.pages.map((page) => {
    if (!page.logs.some((item) => item.pet_id === log.pet_id && item.log_date === log.log_date)) return page;
    changed = true;
    return {
      ...page,
      logs: page.logs.map((item) =>
        item.pet_id === log.pet_id && item.log_date === log.log_date ? log : item
      ),
    };
  });
  return changed ? { ...data, pages } : data;
}

export type DailyLogView = 'editable' | 'read_only' | 'missing';

/**
 * Qué mostrar al abrir un registro anterior: sin registro, nada que editar (abrir nunca crea);
 * con registro, editable si `can_edit_pet` (UX: la autorización real es RLS/RPC).
 */
export function resolveHistoryLogView(log: DailyLog | null, canEdit: boolean): DailyLogView {
  if (!log) return 'missing';
  return canEdit ? 'editable' : 'read_only';
}

const LOG_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Parámetro de ruta `YYYY-MM-DD` válido (fecha real del calendario), o `null`. */
export function parseLogDateParam(value: unknown): string | null {
  if (typeof value !== 'string' || !LOG_DATE.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}
