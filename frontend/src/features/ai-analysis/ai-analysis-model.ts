import type { Enums, Tables } from '@/types/database.types';

/**
 * Orientación con foto y señales (tableros 7.1–7.14). Módulo puro: se prueba con `npm test`.
 * El cliente solo pide (`request_ai_analysis`), invoca la Edge Function `ai-analysis-process` y lee las
 * columnas públicas; el estado, el resultado y el cupo los decide el servidor.
 * Contrato: `docs/FRONTEND_ARCHITECTURE.md` §4 «AIAnalysisScreen».
 */

/** Columnas con SELECT para `authenticated` (`select('*')` falla a propósito). */
export const ANALYSIS_COLUMNS =
  'id, pet_id, requested_by, photo_path, used_full_history, status, urgency_level, possible_causes, recommendations, feedback, created_at';

export type Analysis = Pick<
  Tables<'ai_analysis_requests'>,
  | 'id'
  | 'pet_id'
  | 'requested_by'
  | 'photo_path'
  | 'used_full_history'
  | 'status'
  | 'urgency_level'
  | 'possible_causes'
  | 'recommendations'
  | 'feedback'
  | 'created_at'
>;

export type AnalysisStatus = Enums<'ai_request_status'>;
export type UrgencyLevel = Enums<'urgency_level'>;

export function isTerminal(status: AnalysisStatus): boolean {
  return status === 'completed' || status === 'failed';
}

/** Tras este tiempo preparando, se dice que tarda más de lo normal (y se puede reintentar). */
export const SLOW_AFTER_MS = 60_000;
/** Pendiente desde hace este tiempo sin procesar: se vuelve a invocar la función (idempotente). */
export const REINVOKE_AFTER_MS = 8_000;

export type PollState = 'done' | 'waiting' | 'slow';

/** ¿Seguir consultando la fila? `waiting` hasta `SLOW_AFTER_MS`; después `slow` (se sigue, pero se avisa). */
export function pollState(status: AnalysisStatus, waitingSinceMs: number, nowMs: number): PollState {
  if (isTerminal(status)) return 'done';
  return nowMs - waitingSinceMs > SLOW_AFTER_MS ? 'slow' : 'waiting';
}

export type RequestErrorCode = 'limit' | 'invalid_symptoms' | 'not_allowed' | 'archived' | 'network' | 'unknown';

const NETWORK = /network request failed|failed to fetch|fetch failed|session_unavailable/i;

/**
 * Error de `request_ai_analysis` (excepciones con texto, sin `hint`) o de la subida de la foto, como
 * código para la UI. El texto del servidor nunca se muestra.
 */
export function toRequestErrorCode(error: unknown): RequestErrorCode {
  if (error instanceof TypeError) return 'network';
  const { message = '', code = '' } = (error ?? {}) as { message?: string; code?: string };
  if (NETWORK.test(message)) return 'network';
  if (/límite mensual/i.test(message)) return 'limit';
  if (/no es compatible|compatible con la especie/i.test(message)) return 'invalid_symptoms';
  if (/archivada|no encontrada/i.test(message)) return 'archived';
  if (code === '42501' || /acceso de edición|permiso/i.test(message)) return 'not_allowed';
  return 'unknown';
}

/** Primer día del mes siguiente (cuando se renueva el cupo mensual). */
export function nextMonthStart(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth() + 1, 1);
}

export type Entitlement = {
  canRequest: boolean;
  usedThisMonth: number;
  /** `null` = sin límite (Premium). */
  monthlyLimit: number | null;
  fullHistory: boolean;
};

/** Fila de `get_ai_analysis_entitlement()` a un objeto de la app; sin fila, no se puede pedir. */
export function toEntitlement(
  row: { can_request: boolean; would_use_full_history: boolean; monthly_used: number; monthly_limit: number | null } | undefined
): Entitlement {
  if (!row) return { canRequest: false, usedThisMonth: 0, monthlyLimit: null, fullHistory: false };
  return {
    canRequest: row.can_request,
    usedThisMonth: row.monthly_used,
    monthlyLimit: row.monthly_limit,
    fullHistory: row.would_use_full_history,
  };
}

/** Señales elegidas: añadir o quitar una (sin duplicados, en el orden del catálogo). */
export function toggleSymptom(selected: readonly string[], id: string, catalogOrder: readonly string[]): string[] {
  const next = selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
  return catalogOrder.filter((item) => next.includes(item));
}
