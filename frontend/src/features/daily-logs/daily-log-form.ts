import type { DailyLogErrorCode } from '@/features/daily-logs/daily-log-errors';
import type { DailyLog, SaveDailyLogArgs } from '@/features/daily-logs/types';

/**
 * Formulario del registro diario. Módulo puro (solo imports de tipos, que se eliminan al ejecutar):
 * se prueba con `npm test`. Contrato: `docs/FRONTEND_ARCHITECTURE.md` §4 «DailyLogScreen».
 */

/** Etiquetas permitidas (CHECK `daily_logs_tags_check`). */
export const DAILY_LOG_TAGS = ['vet_visit', 'home_change', 'new_pet'] as const;
export type DailyLogTag = (typeof DAILY_LOG_TAGS)[number];

export const SCALE_VALUES = [1, 2, 3, 4, 5] as const;
export type ScaleValue = (typeof SCALE_VALUES)[number];

/** Escala relativa a lo habitual (1 mucho menos … 3 como siempre … 5 mucho más). */
export const RELATIVE_SCALE_FIELDS = ['energy', 'appetite', 'activity', 'vocalization', 'social'] as const;
/** Escala de calidad (1 muy mal … 3 normal … 5 muy bien). */
export const QUALITY_SCALE_FIELDS = ['mood', 'sleep'] as const;

export type ScaleField =
  | (typeof RELATIVE_SCALE_FIELDS)[number]
  | (typeof QUALITY_SCALE_FIELDS)[number];
export type ScaleKind = 'relative' | 'quality';

/** Orden en pantalla: bloque principal y «Más detalles». */
export const PRIMARY_SCALE_FIELDS = ['energy', 'appetite', 'mood'] as const satisfies readonly ScaleField[];
export const DETAIL_SCALE_FIELDS = ['activity', 'sleep', 'vocalization', 'social'] as const satisfies readonly ScaleField[];
export const SCALE_FIELDS = [...PRIMARY_SCALE_FIELDS, ...DETAIL_SCALE_FIELDS];

/** Valor de «Todo como siempre» (relativa: como siempre; calidad: normal). */
export const USUAL_SCALE_VALUE: ScaleValue = 3;

/** Límites de texto (CHECK `daily_logs_notes_length_check` y `…_unusual_behavior_notes_length_check`). */
export const NOTES_MAX_LENGTH = 2000;
export const UNUSUAL_BEHAVIOR_NOTES_MAX_LENGTH = 1000;

export function scaleKind(field: ScaleField): ScaleKind {
  return (QUALITY_SCALE_FIELDS as readonly ScaleField[]).includes(field) ? 'quality' : 'relative';
}

export type DailyLogFormValues = {
  /** `null` = todavía no indicado (nunca 3 por defecto). */
  scales: Record<ScaleField, ScaleValue | null>;
  unusualBehavior: boolean;
  unusualBehaviorNotes: string;
  notes: string;
  tags: DailyLogTag[];
};

export type DailyLogFormError = 'empty' | 'notes_too_long' | 'unusual_behavior_notes_too_long';

const EMPTY_SCALES: Record<ScaleField, null> = {
  energy: null,
  appetite: null,
  mood: null,
  activity: null,
  sleep: null,
  vocalization: null,
  social: null,
};

export function emptyDailyLogForm(): DailyLogFormValues {
  return { scales: { ...EMPTY_SCALES }, unusualBehavior: false, unusualBehaviorNotes: '', notes: '', tags: [] };
}

function toScaleValue(value: number | null): ScaleValue | null {
  return (SCALE_VALUES as readonly number[]).includes(value ?? NaN) ? (value as ScaleValue) : null;
}

export function isDailyLogTag(value: unknown): value is DailyLogTag {
  return (DAILY_LOG_TAGS as readonly unknown[]).includes(value);
}

/** Valores del formulario a partir del registro guardado (o vacío si no hay). */
export function toDailyLogFormValues(log: DailyLog | null): DailyLogFormValues {
  if (!log) return emptyDailyLogForm();
  return {
    scales: {
      energy: toScaleValue(log.energy_level),
      appetite: toScaleValue(log.appetite_level),
      mood: toScaleValue(log.mood_level),
      activity: toScaleValue(log.activity_level),
      sleep: toScaleValue(log.sleep_quality),
      vocalization: toScaleValue(log.vocalization_level),
      social: toScaleValue(log.social_interaction_level),
    },
    unusualBehavior: log.unusual_behavior,
    unusualBehaviorNotes: log.unusual_behavior_notes ?? '',
    notes: log.notes ?? '',
    tags: (log.tags ?? []).filter(isDailyLogTag),
  };
}

/** Cambia una escala; `null` la deja sin indicar. */
export function setScale(
  values: DailyLogFormValues,
  field: ScaleField,
  value: ScaleValue | null
): DailyLogFormValues {
  return { ...values, scales: { ...values.scales, [field]: value } };
}

/** «Todo como siempre»: las 7 escalas a 3. Solo cambia el formulario; no guarda ni toca lo opcional. */
export function setAllAsUsual(values: DailyLogFormValues): DailyLogFormValues {
  const scales = { ...values.scales };
  for (const field of SCALE_FIELDS) scales[field] = USUAL_SCALE_VALUE;
  return { ...values, scales };
}

/** Añade o quita una etiqueta. Cualquier valor fuera del catálogo cerrado se ignora. */
export function toggleTag(values: DailyLogFormValues, tag: unknown): DailyLogFormValues {
  if (!isDailyLogTag(tag)) return values;
  const tags = values.tags.includes(tag)
    ? values.tags.filter((item) => item !== tag)
    : DAILY_LOG_TAGS.filter((item) => item === tag || values.tags.includes(item));
  return { ...values, tags };
}

/** Texto recortado; vacío o solo espacios = `null` (la RPC aplica el mismo criterio). */
function toNullableText(value: string): string | null {
  const text = value.trim();
  return text === '' ? null : text;
}

/**
 * Lo que se guardaría. La nota de comportamiento inusual solo cuenta con el interruptor activado:
 * si está desactivado no se envía (el campo no se ve), aunque el texto se conserve en el formulario.
 */
function toContent(values: DailyLogFormValues) {
  return {
    unusualBehaviorNotes: values.unusualBehavior ? toNullableText(values.unusualBehaviorNotes) : null,
    notes: toNullableText(values.notes),
  };
}

/** Mismas reglas que la BD (CHECKs), para avisar antes de enviar. */
export function validateDailyLogForm(values: DailyLogFormValues): DailyLogFormError | null {
  const content = toContent(values);
  if ((content.notes?.length ?? 0) > NOTES_MAX_LENGTH) return 'notes_too_long';
  if ((content.unusualBehaviorNotes?.length ?? 0) > UNUSUAL_BEHAVIOR_NOTES_MAX_LENGTH) {
    return 'unusual_behavior_notes_too_long';
  }
  const hasScale = SCALE_FIELDS.some((field) => values.scales[field] !== null);
  const hasContent =
    hasScale ||
    values.unusualBehavior ||
    content.unusualBehaviorNotes !== null ||
    content.notes !== null ||
    values.tags.length > 0;
  return hasContent ? null : 'empty';
}

/**
 * Argumentos de `save_daily_log`: el registro completo del día (un `null` deja ese dato vacío).
 * Nunca incluye `id`, `logged_by`, `last_edited_by` ni timestamps: los pone la BD.
 */
export function toSaveDailyLogArgs(
  petId: string,
  logDate: string,
  values: DailyLogFormValues
): SaveDailyLogArgs {
  const content = toContent(values);
  return {
    p_pet_id: petId,
    p_log_date: logDate,
    p_energy_level: values.scales.energy,
    p_appetite_level: values.scales.appetite,
    p_mood_level: values.scales.mood,
    p_activity_level: values.scales.activity,
    p_sleep_quality: values.scales.sleep,
    p_vocalization_level: values.scales.vocalization,
    p_social_interaction_level: values.scales.social,
    p_unusual_behavior: values.unusualBehavior,
    p_unusual_behavior_notes: content.unusualBehaviorNotes,
    p_notes: content.notes,
    p_tags: values.tags.filter(isDailyLogTag),
  };
}

export type DailyLogSummary = {
  /** Escalas indicadas, en el orden de pantalla. Las no indicadas no aparecen. */
  scales: { field: ScaleField; value: ScaleValue }[];
  tags: DailyLogTag[];
  unusualBehavior: boolean;
  hasNotes: boolean;
};

/**
 * Resumen de un registro para el historial: solo lo que el usuario indicó, tal cual. Sin
 * puntuaciones agregadas ni interpretaciones.
 */
export function summarizeDailyLog(values: DailyLogFormValues): DailyLogSummary {
  return {
    scales: SCALE_FIELDS.flatMap((field) => {
      const value = values.scales[field];
      return value === null ? [] : [{ field, value }];
    }),
    tags: values.tags,
    unusualBehavior: values.unusualBehavior,
    hasNotes: values.notes.trim() !== '',
  };
}

/** ¿Hay algún dato de «Más detalles»? (para abrir la sección al cargar un registro). */
export function hasDetailValues(values: DailyLogFormValues): boolean {
  return DETAIL_SCALE_FIELDS.some((field) => values.scales[field] !== null);
}

// ---------------------------------------------------------------------------------------------
// Estado del editor (pantalla del registro de hoy)
// ---------------------------------------------------------------------------------------------

export type DailyLogEditorStatus = 'idle' | 'saving' | 'saved' | 'error';

export type DailyLogEditorState = {
  values: DailyLogFormValues;
  status: DailyLogEditorStatus;
  /** Error de validación local o del servidor; `null` si no hay. */
  error: DailyLogFormError | DailyLogErrorCode | null;
};

export type DailyLogEditorAction =
  | { type: 'edit'; update: (values: DailyLogFormValues) => DailyLogFormValues }
  | { type: 'invalid'; error: DailyLogFormError }
  | { type: 'saveStarted' }
  | { type: 'saveSucceeded'; log: DailyLog }
  | { type: 'saveFailed'; error: DailyLogErrorCode };

export function initialDailyLogEditorState(log: DailyLog | null): DailyLogEditorState {
  return { values: toDailyLogFormValues(log), status: 'idle', error: null };
}

export function dailyLogEditorReducer(
  state: DailyLogEditorState,
  action: DailyLogEditorAction
): DailyLogEditorState {
  switch (action.type) {
    case 'edit':
      // Mientras se guarda el formulario está bloqueado: la respuesta sustituirá los valores.
      if (state.status === 'saving') return state;
      return { values: action.update(state.values), status: 'idle', error: null };
    case 'invalid':
      return { ...state, status: 'error', error: action.error };
    case 'saveStarted':
      return { ...state, status: 'saving', error: null };
    case 'saveSucceeded':
      // La fila devuelta por la RPC es la verdad (texto recortado, tags ordenados).
      return { values: toDailyLogFormValues(action.log), status: 'saved', error: null };
    case 'saveFailed':
      // Se conservan los valores introducidos para poder reintentar.
      return { ...state, status: 'error', error: action.error };
  }
}
