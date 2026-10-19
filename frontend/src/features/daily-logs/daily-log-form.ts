import type { DailyLogErrorCode } from '@/features/daily-logs/daily-log-errors';
import type { DailyLogContent } from '@/features/daily-logs/offline/daily-log-content';
import type { DailyLog, SaveDailyLogArgs } from '@/features/daily-logs/types';

import { contentToSaveArgs, sameDailyLogContent } from './offline/daily-log-content.ts';

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

/**
 * Orden en pantalla. Principales (tablero 5.1): obligatorias al crear un registro. Detalles (tablero
 * 5.2): opcionales, con tres opciones guardadas como 2/3/4 (`scale-labels.ts`).
 */
export const PRIMARY_SCALE_FIELDS = ['energy', 'appetite', 'mood', 'activity'] as const satisfies readonly ScaleField[];
export const DETAIL_SCALE_FIELDS = ['sleep', 'vocalization', 'social'] as const satisfies readonly ScaleField[];
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

export type DailyLogFormError =
  | 'empty'
  | 'primary_required'
  | 'notes_too_long'
  | 'unusual_behavior_notes_too_long';

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

/** Columnas de contenido de un registro: una fila de `daily_logs` o el contenido local pendiente. */
export type DailyLogContentSource = Pick<
  DailyLog,
  | 'energy_level'
  | 'appetite_level'
  | 'mood_level'
  | 'activity_level'
  | 'sleep_quality'
  | 'vocalization_level'
  | 'social_interaction_level'
  | 'unusual_behavior'
  | 'unusual_behavior_notes'
  | 'notes'
  | 'tags'
>;

/** Valores del formulario a partir del registro guardado (o vacío si no hay). */
export function toDailyLogFormValues(log: DailyLogContentSource | null): DailyLogFormValues {
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

/**
 * «Todo como siempre»: las 4 escalas principales a 3 (tablero 5.1). Solo cambia el formulario; no
 * guarda ni toca los detalles ni lo opcional.
 */
export function setAllAsUsual(values: DailyLogFormValues): DailyLogFormValues {
  const scales = { ...values.scales };
  for (const field of PRIMARY_SCALE_FIELDS) scales[field] = USUAL_SCALE_VALUE;
  return { ...values, scales };
}

/** Cuántas de las 4 escalas principales están indicadas (progreso «n/4» del tablero 5.1). */
export function answeredPrimaryCount(values: DailyLogFormValues): number {
  return PRIMARY_SCALE_FIELDS.filter((field) => values.scales[field] !== null).length;
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

/**
 * Mismas reglas que la BD (CHECKs), para avisar antes de enviar. Al crear un registro
 * (`requirePrimary`), las 4 escalas principales son obligatorias (regla de producto del diseño v2);
 * al editar uno que ya existe se mantiene «no vacío», sin obligar a rellenar lo que antes no lo era.
 */
export function validateDailyLogForm(
  values: DailyLogFormValues,
  { requirePrimary = false }: { requirePrimary?: boolean } = {}
): DailyLogFormError | null {
  const content = toContent(values);
  if ((content.notes?.length ?? 0) > NOTES_MAX_LENGTH) return 'notes_too_long';
  if ((content.unusualBehaviorNotes?.length ?? 0) > UNUSUAL_BEHAVIOR_NOTES_MAX_LENGTH) {
    return 'unusual_behavior_notes_too_long';
  }
  if (requirePrimary && answeredPrimaryCount(values) < PRIMARY_SCALE_FIELDS.length) return 'primary_required';
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
 * Registro completo del día que resulta del formulario (lo que se guarda en local y se envía).
 * Nunca incluye `id`, `logged_by`, `last_edited_by` ni timestamps: los pone la BD.
 */
export function toDailyLogContent(values: DailyLogFormValues): DailyLogContent {
  const content = toContent(values);
  return {
    energy_level: values.scales.energy,
    appetite_level: values.scales.appetite,
    mood_level: values.scales.mood,
    activity_level: values.scales.activity,
    sleep_quality: values.scales.sleep,
    vocalization_level: values.scales.vocalization,
    social_interaction_level: values.scales.social,
    unusual_behavior: values.unusualBehavior,
    unusual_behavior_notes: content.unusualBehaviorNotes,
    notes: content.notes,
    tags: values.tags.filter(isDailyLogTag),
  };
}

/** Argumentos de `save_daily_log` (sin precondición): el registro completo del día. */
export function toSaveDailyLogArgs(
  petId: string,
  logDate: string,
  values: DailyLogFormValues
): SaveDailyLogArgs {
  return contentToSaveArgs(petId, logDate, toDailyLogContent(values));
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

/** ¿Hay algún dato de los detalles (tablero 5.2)? Para el resumen de «Añadir detalles». */
export function hasDetailValues(values: DailyLogFormValues): boolean {
  return (
    DETAIL_SCALE_FIELDS.some((field) => values.scales[field] !== null) ||
    values.unusualBehavior ||
    values.notes.trim() !== '' ||
    values.tags.length > 0
  );
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
  /** El usuario cambió algún campo desde que se abrió, cargó o guardó el formulario. */
  dirty: boolean;
};

export type DailyLogEditorAction =
  | { type: 'edit'; update: (values: DailyLogFormValues) => DailyLogFormValues }
  /** Cargar otra versión del registro (p. ej. la del servidor que llegó tarde), sin cambios del usuario. */
  | { type: 'load'; log: DailyLogContentSource | null }
  | { type: 'invalid'; error: DailyLogFormError }
  | { type: 'saveStarted' }
  /** Guardado (en este dispositivo): `log` es el contenido tal como quedó guardado. */
  | { type: 'saveSucceeded'; log: DailyLogContentSource }
  | { type: 'saveFailed'; error: DailyLogErrorCode };

export function initialDailyLogEditorState(log: DailyLogContentSource | null): DailyLogEditorState {
  return { values: toDailyLogFormValues(log), status: 'idle', error: null, dirty: false };
}

export function dailyLogEditorReducer(
  state: DailyLogEditorState,
  action: DailyLogEditorAction
): DailyLogEditorState {
  switch (action.type) {
    case 'edit':
      // Mientras se guarda el formulario está bloqueado: la respuesta sustituirá los valores.
      if (state.status === 'saving') return state;
      return { values: action.update(state.values), status: 'idle', error: null, dirty: true };
    case 'load':
      return initialDailyLogEditorState(action.log);
    case 'invalid':
      return { ...state, status: 'error', error: action.error };
    case 'saveStarted':
      return { ...state, status: 'saving', error: null };
    case 'saveSucceeded':
      // El contenido guardado ya está normalizado (texto recortado, tags ordenados).
      return { values: toDailyLogFormValues(action.log), status: 'saved', error: null, dirty: false };
    case 'saveFailed':
      // Se conservan los valores introducidos para poder reintentar.
      return { ...state, status: 'error', error: action.error };
  }
}

/** Con qué versión del registro está trabajando el formulario: contenido y fila base (precondición). */
export type DailyLogEditorSource = {
  content: DailyLogContentSource | null;
  baseRow: DailyLog | null;
};

/**
 * Qué hacer cuando la pantalla trae otra versión del registro (llega la respuesta del servidor,
 * se confirma un guardado o se resuelve un conflicto) con el formulario ya abierto:
 * - `none`: es la misma versión (cambios de caché o renders irrelevantes): nada.
 * - `adopt`: mismo contenido que el formulario o que la versión abierta; solo avanza la base. Los
 *   valores (y lo que el usuario esté escribiendo) no cambian.
 * - `reload`: contenido distinto y el usuario no ha tocado nada: se cargan los valores nuevos.
 * - `keep`: contenido distinto y el usuario ya editó: no se sustituye nada; la base sigue siendo la
 *   abierta, así que al guardar la precondición detecta el cambio concurrente. La pantalla avisa.
 * Si había cambios locales pendientes, la vista ya muestra ese contenido (no el del servidor), así que
 * una respuesta remota no produce ningún cambio aquí.
 */
export type DailyLogSourceChange = 'none' | 'adopt' | 'reload' | 'keep';

const contentOf = (source: DailyLogContentSource | null): DailyLogContent =>
  toDailyLogContent(toDailyLogFormValues(source));

export function decideSourceChange(
  opened: DailyLogEditorSource,
  next: DailyLogEditorSource,
  editor: Pick<DailyLogEditorState, 'values' | 'status' | 'dirty'>
): DailyLogSourceChange {
  const nextContent = contentOf(next.content);
  const sameBase =
    (opened.baseRow?.id ?? null) === (next.baseRow?.id ?? null) &&
    (opened.baseRow?.updated_at ?? null) === (next.baseRow?.updated_at ?? null);
  const sameContent = sameDailyLogContent(contentOf(opened.content), nextContent);
  if (sameBase && sameContent) return 'none';
  if (sameDailyLogContent(toDailyLogContent(editor.values), nextContent) || sameContent) return 'adopt';
  return editor.dirty || editor.status === 'saving' ? 'keep' : 'reload';
}
