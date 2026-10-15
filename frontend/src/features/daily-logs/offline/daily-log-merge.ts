import { NOTES_MAX_LENGTH, UNUSUAL_BEHAVIOR_NOTES_MAX_LENGTH } from '../daily-log-form.ts';
import {
  LEVEL_COLUMNS,
  isEmptyDailyLogContent,
  normalizeDailyLogContent,
  normalizeTags,
  sameDailyLogContent,
  type DailyLogContent,
  type LevelColumn,
} from './daily-log-content.ts';

/**
 * Fusión a tres bandas de un registro diario: `base` (la fila que se editó), `local` (lo pendiente
 * en este dispositivo) y `remote` (la fila actual del servidor). Módulo puro (`npm test`).
 *
 * Regla general, por unidad: si solo cambió un lado respecto a `base`, gana ese lado; si los dos
 * cambiaron a lo mismo, no hay conflicto; si cambiaron a valores distintos, **conflicto**: no se
 * elige ninguno y lo decide el usuario. Nunca se pisa en silencio un cambio.
 *
 * Unidades:
 * - Cada nivel (`*_level`, `sleep_quality`) por separado.
 * - `unusual_behavior` + `unusual_behavior_notes` juntos: la nota solo tiene sentido con el
 *   interruptor activado, así que no se mezcla el interruptor de un lado con la nota del otro.
 * - `notes`: texto libre. Dos ediciones distintas son siempre conflicto; nunca se concatenan solas.
 *   Combinarlas es una resolución explícita (`combineNotes`).
 * - `tags`: conjunto. Se fusiona etiqueta a etiqueta (añadida o quitada por cada lado), así que
 *   nunca hay conflicto; el resultado va sin duplicados y ordenado, como en la RPC.
 *
 * Sin `base` (registro creado sin conexión que ya existía en el servidor) se compara con un
 * registro vacío. Casos sin estrategia definida, que quedan pendientes de decisión del usuario:
 * fila remota borrada (`remote_deleted`; decisión 2026-10-10: no se recrea sola) y fusión que deja
 * el registro vacío (`empty_result`; el servidor lo rechazaría).
 */

export type MergeUnit = LevelColumn | 'unusual_behavior' | 'notes';

type ContentColumn = keyof DailyLogContent;

const UNIT_COLUMNS: Record<MergeUnit, readonly ContentColumn[]> = {
  energy_level: ['energy_level'],
  appetite_level: ['appetite_level'],
  mood_level: ['mood_level'],
  activity_level: ['activity_level'],
  sleep_quality: ['sleep_quality'],
  vocalization_level: ['vocalization_level'],
  social_interaction_level: ['social_interaction_level'],
  unusual_behavior: ['unusual_behavior', 'unusual_behavior_notes'],
  notes: ['notes'],
};

export const MERGE_UNITS: readonly MergeUnit[] = [...LEVEL_COLUMNS, 'unusual_behavior', 'notes'];

const EMPTY_CONTENT: DailyLogContent = {
  energy_level: null,
  appetite_level: null,
  mood_level: null,
  activity_level: null,
  sleep_quality: null,
  vocalization_level: null,
  social_interaction_level: null,
  unusual_behavior: false,
  unusual_behavior_notes: null,
  notes: null,
  tags: [],
};

/** Las columnas de la unidad en cada versión. */
export type DailyLogMergeConflict = {
  unit: MergeUnit;
  base: Partial<DailyLogContent>;
  local: Partial<DailyLogContent>;
  remote: Partial<DailyLogContent>;
};

type DailyLogMergeOutcome =
  /** Fusión completa. Si `differsFromRemote` es `false`, el servidor ya tiene este contenido. */
  | { status: 'merged'; content: DailyLogContent; differsFromRemote: boolean }
  /** Sin estrategia definida: lo decide el usuario. */
  | { status: 'unresolved'; reason: 'remote_deleted' | 'empty_result' };

export type DailyLogMergeResult =
  | DailyLogMergeOutcome
  /** `merged`: lo ya resuelto (incluidas las etiquetas); faltan las unidades de `conflicts`. */
  | { status: 'conflict'; conflicts: DailyLogMergeConflict[]; merged: Partial<DailyLogContent> };

function pick(content: DailyLogContent, unit: MergeUnit): Partial<DailyLogContent> {
  const picked: Partial<DailyLogContent> = {};
  for (const column of UNIT_COLUMNS[unit]) Object.assign(picked, { [column]: content[column] });
  return picked;
}

function sameUnit(a: DailyLogContent, b: DailyLogContent, unit: MergeUnit): boolean {
  return UNIT_COLUMNS[unit].every((column) => a[column] === b[column]);
}

/** Cada lado añade o quita etiquetas respecto a `base`; lo que no tocó, queda como en el otro. */
export function mergeTags(
  base: readonly string[],
  local: readonly string[],
  remote: readonly string[]
): string[] {
  return normalizeTags([...base, ...local, ...remote]).filter((tag) => {
    const inLocal = local.includes(tag);
    return inLocal !== base.includes(tag) ? inLocal : remote.includes(tag);
  });
}

export function mergeDailyLogContent(versions: {
  base: DailyLogContent | null;
  local: DailyLogContent;
  remote: DailyLogContent | null;
}): DailyLogMergeResult {
  if (versions.remote === null) return { status: 'unresolved', reason: 'remote_deleted' };

  const base = normalizeDailyLogContent(versions.base ?? EMPTY_CONTENT);
  const local = normalizeDailyLogContent(versions.local);
  const remote = normalizeDailyLogContent(versions.remote);

  const merged: Partial<DailyLogContent> = { tags: mergeTags(base.tags, local.tags, remote.tags) };
  const conflicts: DailyLogMergeConflict[] = [];

  for (const unit of MERGE_UNITS) {
    if (sameUnit(local, base, unit) || sameUnit(local, remote, unit)) {
      Object.assign(merged, pick(remote, unit));
    } else if (sameUnit(remote, base, unit)) {
      Object.assign(merged, pick(local, unit));
    } else {
      conflicts.push({ unit, base: pick(base, unit), local: pick(local, unit), remote: pick(remote, unit) });
    }
  }

  if (conflicts.length > 0) return { status: 'conflict', conflicts, merged };
  return finish(merged as DailyLogContent, remote);
}

function finish(content: DailyLogContent, remote: DailyLogContent): DailyLogMergeOutcome {
  if (isEmptyDailyLogContent(content)) return { status: 'unresolved', reason: 'empty_result' };
  return { status: 'merged', content, differsFromRemote: !sameDailyLogContent(content, remote) };
}

export type CombinedNotes = { ok: true; value: string | null } | { ok: false; reason: 'too_long' };

/**
 * Resolución «conservar ambas» de dos textos en conflicto. Sin duplicar: si son iguales o uno
 * contiene al otro, queda el más completo; si no, el remoto (ya guardado) y debajo el local. Si el
 * resultado supera el límite de la columna no se recorta: hay que elegir o editar.
 */
export function combineNotes(local: string | null, remote: string | null, maxLength: number): CombinedNotes {
  const mine = local ?? '';
  const theirs = remote ?? '';
  const value = mine.includes(theirs) ? mine : theirs.includes(mine) ? theirs : `${theirs}\n\n${mine}`;
  if (value.length > maxLength) return { ok: false, reason: 'too_long' };
  return { ok: true, value: value === '' ? null : value };
}

/** `combine` solo existe para las unidades con texto: `notes` y `unusual_behavior`. */
export type MergeResolution = 'local' | 'remote' | 'combine';

export type DailyLogResolutionResult =
  | DailyLogMergeOutcome
  /** Falta elegir alguna unidad en conflicto. */
  | { status: 'incomplete'; missing: MergeUnit[] }
  /** La resolución elegida no se puede aplicar a esa unidad. */
  | { status: 'invalid'; unit: MergeUnit; reason: 'too_long' | 'cannot_combine' };

/**
 * Aplica la decisión del usuario a cada unidad en conflicto. `combine` en `unusual_behavior` deja
 * el interruptor activado si lo estaba en cualquiera de los dos lados y combina las notas.
 */
export function resolveDailyLogConflicts(
  result: Extract<DailyLogMergeResult, { status: 'conflict' }>,
  resolutions: Partial<Record<MergeUnit, MergeResolution>>,
  remote: DailyLogContent
): DailyLogResolutionResult {
  const missing = result.conflicts.filter(({ unit }) => !resolutions[unit]).map(({ unit }) => unit);
  if (missing.length > 0) return { status: 'incomplete', missing };

  const content: Partial<DailyLogContent> = { ...result.merged };
  for (const conflict of result.conflicts) {
    const resolution = resolutions[conflict.unit];
    if (resolution !== 'combine') {
      Object.assign(content, resolution === 'local' ? conflict.local : conflict.remote);
      continue;
    }
    if (conflict.unit === 'notes') {
      const notes = combineNotes(conflict.local.notes ?? null, conflict.remote.notes ?? null, NOTES_MAX_LENGTH);
      if (!notes.ok) return { status: 'invalid', unit: conflict.unit, reason: notes.reason };
      content.notes = notes.value;
    } else if (conflict.unit === 'unusual_behavior') {
      const notes = combineNotes(
        conflict.local.unusual_behavior_notes ?? null,
        conflict.remote.unusual_behavior_notes ?? null,
        UNUSUAL_BEHAVIOR_NOTES_MAX_LENGTH
      );
      if (!notes.ok) return { status: 'invalid', unit: conflict.unit, reason: notes.reason };
      content.unusual_behavior = Boolean(conflict.local.unusual_behavior || conflict.remote.unusual_behavior);
      content.unusual_behavior_notes = notes.value;
    } else {
      return { status: 'invalid', unit: conflict.unit, reason: 'cannot_combine' };
    }
  }

  return finish(normalizeDailyLogContent(content as DailyLogContent), normalizeDailyLogContent(remote));
}
