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

/** Unidades (y `tags`) en las que dos versiones del registro son distintas, en el orden de pantalla. */
export function differingUnits(a: DailyLogContent, b: DailyLogContent): (MergeUnit | 'tags')[] {
  const left = normalizeDailyLogContent(a);
  const right = normalizeDailyLogContent(b);
  const units: (MergeUnit | 'tags')[] = MERGE_UNITS.filter((unit) => !sameUnit(left, right, unit));
  const sameTags = left.tags.length === right.tags.length && left.tags.every((tag, i) => tag === right.tags[i]);
  return sameTags ? units : [...units, 'tags'];
}

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

/**
 * Propuesta para «conservar ambas» en dos textos en conflicto: sin duplicar (si son iguales o uno
 * contiene al otro, el más completo; si no, el remoto y debajo el local). Es solo una propuesta: la
 * interfaz la muestra en un campo editable y lo que se guarda es lo que el usuario confirma. Nunca
 * se aplica sola.
 */
export function suggestCombinedText(local: string | null, remote: string | null): string | null {
  const mine = local ?? '';
  const theirs = remote ?? '';
  const value = mine.includes(theirs) ? mine : theirs.includes(mine) ? theirs : `${theirs}\n\n${mine}`;
  return value === '' ? null : value;
}

export type CombinedNotes = { ok: true; value: string | null } | { ok: false; reason: 'too_long' };

/** `suggestCombinedText` con el límite de la columna (sin recortar: si no cabe, hay que editar). */
export function combineNotes(local: string | null, remote: string | null, maxLength: number): CombinedNotes {
  const value = suggestCombinedText(local, remote);
  if ((value?.length ?? 0) > maxLength) return { ok: false, reason: 'too_long' };
  return { ok: true, value };
}

/**
 * Decisión del usuario para una unidad en conflicto: su versión, la del servidor, o un texto que ha
 * revisado y editado (solo `notes` y `unusual_behavior`; parte de `suggestCombinedText`).
 */
export type MergeResolution = 'local' | 'remote' | { text: string };

export type DailyLogResolutionResult =
  | DailyLogMergeOutcome
  /** Falta elegir alguna unidad en conflicto. */
  | { status: 'incomplete'; missing: MergeUnit[] }
  /** La resolución elegida no se puede aplicar a esa unidad. */
  | { status: 'invalid'; unit: MergeUnit; reason: 'too_long' | 'cannot_combine' };

const TEXT_LIMITS: Partial<Record<MergeUnit, number>> = {
  notes: NOTES_MAX_LENGTH,
  unusual_behavior: UNUSUAL_BEHAVIOR_NOTES_MAX_LENGTH,
};

/**
 * Aplica la decisión del usuario a cada unidad en conflicto; lo que no estaba en conflicto queda
 * como lo dejó la fusión. Un texto editado en `unusual_behavior` deja el interruptor activado si lo
 * estaba en cualquiera de los dos lados o si el texto no está vacío.
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
    if (resolution === 'local' || resolution === 'remote') {
      Object.assign(content, resolution === 'local' ? conflict.local : conflict.remote);
      continue;
    }
    const limit = TEXT_LIMITS[conflict.unit];
    if (!resolution || limit === undefined) {
      return { status: 'invalid', unit: conflict.unit, reason: 'cannot_combine' };
    }
    const text = resolution.text.trim();
    if (text.length > limit) return { status: 'invalid', unit: conflict.unit, reason: 'too_long' };
    if (conflict.unit === 'notes') {
      content.notes = text === '' ? null : text;
    } else {
      content.unusual_behavior = Boolean(
        text !== '' || conflict.local.unusual_behavior || conflict.remote.unusual_behavior
      );
      content.unusual_behavior_notes = text === '' ? null : text;
    }
  }

  return finish(normalizeDailyLogContent(content as DailyLogContent), normalizeDailyLogContent(remote));
}

/** Cómo cambió cada dato entre la base, tu versión y la del servidor. */
export type UnitChange =
  /** Tu versión y la del servidor coinciden. */
  | 'same'
  /** Solo lo cambiaste tú: se puede conservar. */
  | 'local_only'
  /** Solo cambió en el servidor: se puede aceptar. */
  | 'remote_only'
  /** Cambió en los dos lados con valores distintos: requiere decisión. */
  | 'conflict'
  /** Etiquetas cambiadas en los dos lados: se combinan como conjunto. */
  | 'merged';

export type UnitComparison = {
  unit: MergeUnit | 'tags';
  change: UnitChange;
  local: Partial<DailyLogContent>;
  remote: Partial<DailyLogContent>;
};

/** Comparación por unidad para la pantalla de conflictos (en el orden de pantalla). */
export function compareDailyLogVersions(versions: {
  base: DailyLogContent | null;
  local: DailyLogContent;
  remote: DailyLogContent;
}): UnitComparison[] {
  const base = normalizeDailyLogContent(versions.base ?? EMPTY_CONTENT);
  const local = normalizeDailyLogContent(versions.local);
  const remote = normalizeDailyLogContent(versions.remote);
  const changeOf = (
    same: (a: DailyLogContent, b: DailyLogContent) => boolean,
    bothChanged: UnitChange
  ): UnitChange =>
    same(local, remote) ? 'same' : same(local, base) ? 'remote_only' : same(remote, base) ? 'local_only' : bothChanged;

  const units: UnitComparison[] = MERGE_UNITS.map((unit) => ({
    unit,
    change: changeOf((a, b) => sameUnit(a, b, unit), 'conflict'),
    local: pick(local, unit),
    remote: pick(remote, unit),
  }));
  const sameTags = (a: DailyLogContent, b: DailyLogContent) =>
    a.tags.length === b.tags.length && a.tags.every((tag, index) => tag === b.tags[index]);
  units.push({
    unit: 'tags',
    change: changeOf(sameTags, 'merged'),
    local: { tags: local.tags },
    remote: { tags: remote.tags },
  });
  return units;
}

export type ResolutionStrategy = 'local' | 'remote' | 'combine';

/**
 * Contenido final según la estrategia elegida en la pantalla de conflictos:
 * - `local`: tu versión completa; `remote`: la del servidor completa.
 * - `combine`: lo cambiado por un solo lado se conserva o se acepta, las etiquetas se unen como
 *   conjunto y cada unidad en conflicto usa la decisión explícita de `resolutions`.
 * Sin fila remota (se borró) solo cabe `local` (volver a crearla); descartar es otra acción.
 */
export function buildResolvedContent(
  versions: { base: DailyLogContent | null; local: DailyLogContent; remote: DailyLogContent | null },
  strategy: ResolutionStrategy,
  resolutions: Partial<Record<MergeUnit, MergeResolution>> = {}
): DailyLogResolutionResult {
  const local = normalizeDailyLogContent(versions.local);
  if (versions.remote === null) {
    if (strategy !== 'local') return { status: 'unresolved', reason: 'remote_deleted' };
    return isEmptyDailyLogContent(local)
      ? { status: 'unresolved', reason: 'empty_result' }
      : { status: 'merged', content: local, differsFromRemote: true };
  }
  const remote = normalizeDailyLogContent(versions.remote);
  if (strategy === 'local') return finish(local, remote);
  if (strategy === 'remote') return finish(remote, remote);

  const merge = mergeDailyLogContent({ base: versions.base, local, remote });
  return merge.status === 'conflict' ? resolveDailyLogConflicts(merge, resolutions, remote) : merge;
}
