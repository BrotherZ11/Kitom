import type { Enums, Tables } from '@/types/database.types';

/**
 * Orientación con foto y señales (tableros 7.1–7.14). Módulo puro: se prueba con `npm test`.
 * El cliente solo pide (`request_ai_analysis`), invoca la Edge Function `ai-analysis-process` y lee las
 * columnas públicas; el estado, el resultado y el cupo los decide el servidor.
 * Contrato: `docs/FRONTEND_ARCHITECTURE.md` §4 «AIAnalysisScreen».
 */

/** Columnas con SELECT para `authenticated` (`select('*')` falla a propósito). */
export const ANALYSIS_COLUMNS =
  'id, pet_id, requested_by, photo_path, used_full_history, status, urgency_level, summary, possible_causes, recommendations, warning_signs, vet_questions, photo_observations, user_context, symptom_onset, symptom_trend, feedback, created_at';

export type Analysis = Pick<
  Tables<'ai_analysis_requests'>,
  | 'id'
  | 'pet_id'
  | 'requested_by'
  | 'photo_path'
  | 'used_full_history'
  | 'status'
  | 'urgency_level'
  | 'summary'
  | 'possible_causes'
  | 'recommendations'
  | 'warning_signs'
  | 'vet_questions'
  | 'photo_observations'
  | 'user_context'
  | 'symptom_onset'
  | 'symptom_trend'
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

export type ResultScreen = 'result' | 'failed' | 'preparing';

/**
 * Qué muestra la pantalla del resultado. Un `completed` sin nivel de urgencia no debería existir (la
 * Edge Function siempre lo escribe); si llega, se trata como fallido —se puede repetir— en vez de
 * esperar para siempre (el sondeo ya se paró) o inventar un nivel.
 */
export function resultScreen(analysis: Pick<Analysis, 'status' | 'urgency_level'>): ResultScreen {
  if (analysis.status === 'completed') return analysis.urgency_level ? 'result' : 'failed';
  if (analysis.status === 'failed') return 'failed';
  return 'preparing';
}

export type PollState = 'done' | 'waiting' | 'slow';

/** ¿Seguir consultando la fila? `waiting` hasta `SLOW_AFTER_MS`; después `slow` (se sigue, pero se avisa). */
export function pollState(status: AnalysisStatus, waitingSinceMs: number, nowMs: number): PollState {
  if (isTerminal(status)) return 'done';
  return nowMs - waitingSinceMs > SLOW_AFTER_MS ? 'slow' : 'waiting';
}

export type RequestErrorCode =
  | 'limit'
  | 'invalid_symptoms'
  | 'not_allowed'
  | 'archived'
  | 'disclaimer'
  | 'rate_limited'
  | 'failure_limit'
  | 'species_unsupported'
  | 'context_too_long'
  | 'invalid_context'
  | 'network'
  | 'unknown';

const NETWORK = /network request failed|failed to fetch|fetch failed|session_unavailable/i;

/** `hint` de `request_ai_analysis` (migraciones `20261029151011`, `20261030090318` y `*_ai_guidance_v2`). */
const HINT_CODES = new Map<string, RequestErrorCode>([
  ['ai_quota_exceeded', 'limit'],
  ['ai_invalid_symptoms', 'invalid_symptoms'],
  ['ai_not_allowed', 'not_allowed'],
  ['ai_pet_unavailable', 'archived'],
  ['ai_disclaimer_required', 'disclaimer'],
  ['ai_rate_limited', 'rate_limited'],
  ['ai_failure_limit', 'failure_limit'],
  ['ai_species_unsupported', 'species_unsupported'],
  ['ai_context_too_long', 'context_too_long'],
  ['ai_invalid_context', 'invalid_context'],
]);

/**
 * Error de `request_ai_analysis` o de la subida de la foto, como código para la UI. Primero por
 * `hint`; un servidor sin la migración solo da el texto. El texto del servidor nunca se muestra.
 */
export function toRequestErrorCode(error: unknown): RequestErrorCode {
  if (error instanceof TypeError) return 'network';
  const { message = '', code = '', hint = '' } = (error ?? {}) as { message?: string; code?: string; hint?: string };
  if (NETWORK.test(message)) return 'network';
  const byHint = HINT_CODES.get(hint);
  if (byHint) return byHint;
  if (/límite mensual/i.test(message)) return 'limit';
  if (/no es compatible|compatible con la especie/i.test(message)) return 'invalid_symptoms';
  if (/archivada|no encontrada/i.test(message)) return 'archived';
  if (code === '42501' || /acceso de edición|permiso/i.test(message)) return 'not_allowed';
  return 'unknown';
}

/**
 * ¿Se puede borrar la foto recién subida tras un fallo de `request_ai_analysis`? Solo si el servidor la
 * rechazó: sin respuesta (red) la solicitud pudo crearse con esa foto, y borrarla la estropearía.
 */
export function canDiscardUploadedPhoto(error: unknown): boolean {
  return toRequestErrorCode(error) !== 'network';
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

// ---------------------------------------------------------------------------------------------
// Contexto del tutor (migración `*_ai_guidance_v2.sql`)
// ---------------------------------------------------------------------------------------------

/** Mismo límite que el CHECK y `request_ai_analysis` (`ai_context_too_long`). */
export const MAX_CONTEXT_LENGTH = 1000;
/** Sin ninguna señal marcada, el texto es lo único que orienta: al menos esto. */
export const MIN_CONTEXT_WITHOUT_SIGNS = 10;

export const SYMPTOM_ONSETS = ['today', 'days_1_3', 'days_4_7', 'over_week'] as const;
export type SymptomOnset = (typeof SYMPTOM_ONSETS)[number];
export const SYMPTOM_TRENDS = ['better', 'same', 'worse'] as const;
export type SymptomTrend = (typeof SYMPTOM_TRENDS)[number];

export function isSymptomOnset(value: unknown): value is SymptomOnset {
  return (SYMPTOM_ONSETS as readonly unknown[]).includes(value);
}
export function isSymptomTrend(value: unknown): value is SymptomTrend {
  return (SYMPTOM_TRENDS as readonly unknown[]).includes(value);
}

/** El texto tal como lo guardará el servidor: sin espacios en los extremos; vacío = `null`. */
export function normalizeContext(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === '' ? null : trimmed;
}

export type ContextProblem = 'required' | 'too_long' | null;

/**
 * ¿Se puede enviar? Hace falta alguna señal o, sin ninguna, un texto de al menos
 * `MIN_CONTEXT_WITHOUT_SIGNS` caracteres; nunca más de `MAX_CONTEXT_LENGTH`.
 */
export function contextProblem(text: string, signCount: number): ContextProblem {
  const value = normalizeContext(text) ?? '';
  if (value.length > MAX_CONTEXT_LENGTH) return 'too_long';
  if (signCount === 0 && value.length < MIN_CONTEXT_WITHOUT_SIGNS) return 'required';
  return null;
}

// ---------------------------------------------------------------------------------------------
// Señales agrupadas
// ---------------------------------------------------------------------------------------------

/** Orden de las categorías de `symptoms_catalog.category` (`supabase/seed.sql`). */
export const SIGN_CATEGORIES = [
  'general',
  'digestive',
  'oral',
  'urinary',
  'respiratory',
  'skin',
  'ocular',
  'motor',
  'neuro',
  'behavior',
] as const;
export type SignCategory = (typeof SIGN_CATEGORIES)[number] | 'other';

/**
 * Señales por categoría, en el orden de `SIGN_CATEGORIES` (una desconocida, al final como `other`) y,
 * dentro de cada una, en el orden recibido. Sin grupos vacíos.
 */
export function groupSigns<T extends { category: string | null }>(signs: readonly T[]): { category: SignCategory; signs: T[] }[] {
  const known = SIGN_CATEGORIES as readonly string[];
  const order: SignCategory[] = [...SIGN_CATEGORIES, 'other'];
  return order
    .map((category) => ({
      category,
      signs: signs.filter((sign) => (known.includes(sign.category ?? '') ? sign.category === category : category === 'other')),
    }))
    .filter((group) => group.signs.length > 0);
}

/** Clave del título de una categoría: boca y piel se nombran según la especie (QA-09). */
export type SignCategoryLabel =
  | SignCategory
  | 'oralTeeth'
  | 'oralBeak'
  | 'oralReptile'
  | 'skinFur'
  | 'skinFeathers'
  | 'skinScales';

const FURRED = new Set(['dog', 'cat', 'rabbit', 'guinea_pig', 'hamster', 'horse']);

export function signCategoryLabel(category: SignCategory, speciesCode: string | null): SignCategoryLabel {
  if (category === 'oral') {
    if (speciesCode === 'bird_other') return 'oralBeak';
    if (speciesCode === 'reptile_other') return 'oralReptile';
    if (speciesCode && FURRED.has(speciesCode)) return 'oralTeeth';
  }
  if (category === 'skin') {
    if (speciesCode === 'bird_other') return 'skinFeathers';
    if (speciesCode === 'reptile_other') return 'skinScales';
    if (speciesCode && FURRED.has(speciesCode)) return 'skinFur';
  }
  return category;
}

// ---------------------------------------------------------------------------------------------
// Compartir el resumen
// ---------------------------------------------------------------------------------------------

export type ShareLabels = {
  title: string;
  date: string;
  level: string;
  signs: string | null;
  summary: string;
  causes: string;
  todo: string;
  warning: string;
  vet: string;
  yourContext: string;
  footer: string;
};

/**
 * Texto plano del resultado para mandárselo al veterinario (menú de compartir del sistema). Solo lo que
 * hay: secciones vacías fuera. Los textos traducidos los pone la pantalla.
 */
export function buildShareText(
  analysis: Pick<Analysis, 'summary' | 'possible_causes' | 'recommendations' | 'warning_signs' | 'vet_questions' | 'user_context'>,
  labels: ShareLabels
): string {
  const list = (items: readonly string[] | null | undefined) => (items ?? []).map((item) => `• ${item}`);
  const section = (title: string, lines: string[]) => (lines.length ? ['', title, ...lines] : []);
  return [
    labels.title,
    labels.date,
    labels.level,
    ...(labels.signs ? [labels.signs] : []),
    ...section(labels.yourContext, analysis.user_context ? [analysis.user_context] : []),
    ...section(labels.summary, analysis.summary ? [analysis.summary] : []),
    ...section(labels.causes, list(analysis.possible_causes)),
    ...section(labels.todo, list(analysis.recommendations)),
    ...section(labels.warning, list(analysis.warning_signs)),
    ...section(labels.vet, list(analysis.vet_questions)),
    '',
    labels.footer,
  ].join('\n');
}
