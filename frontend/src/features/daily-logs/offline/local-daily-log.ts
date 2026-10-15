import type { DailyLog } from '@/features/daily-logs/types';
import type { LocalCollection } from '@/lib/local-store/local-store';

import { isOperationId } from '../../../lib/operation-id.ts';
import {
  contentFromRow,
  isLogDate,
  isUuid,
  normalizeDailyLogContent,
  parseDailyLogContent,
  parseDailyLogRow,
  sameDailyLogContent,
  type DailyLogContent,
} from './daily-log-content.ts';
import { MAX_SYNC_ATTEMPTS, isAttemptDue, nextAttemptAt, type BackoffOptions } from './sync-backoff.ts';
import type { DailyLogConflictDetail, SyncErrorInfo, SyncErrorKind } from './sync-errors.ts';

/**
 * Registro diario tal como se guarda en el dispositivo: la última fila confirmada por el servidor
 * y, si hay cambios sin enviar, **una** operación pendiente. Módulo puro (`npm test`): tipos,
 * validación y transiciones de estado. No lee ni escribe en ningún sitio y no envía nada.
 *
 * Identidad: (`userId`, `petId`, `logDate`), una clave del almacén local por registro. `logDate`
 * se fija al crear el registro local y ninguna transición la cambia.
 *
 * Versión base: `baseVersion` es el `updated_at` de `serverRow`, la cadena exacta que devolvió
 * PostgREST (microsegundos). Es la precondición del siguiente envío (`toSyncPrecondition`); nunca
 * pasa por `Date`. Los instantes locales (`editedAt`, `nextAttemptAt`…) son ms del reloj del
 * dispositivo y no se envían al servidor.
 */

export const LOCAL_DAILY_LOG_VERSION = 1;

/**
 * - `synced`: sin cambios locales; `serverRow` es lo que hay.
 * - `pending`: hay una operación por enviar (o por reintentar: ver `attempts` y `nextAttemptAt`).
 * - `failed`: el servidor la rechazó y reintentar no lo arregla; el contenido local se conserva.
 * - `conflict`: el servidor tiene otra versión; hay que fusionar antes de volver a enviar.
 */
export type LocalDailyLogSyncStatus = 'synced' | 'pending' | 'failed' | 'conflict';

export type LocalDailyLogPending = {
  /**
   * UUID v4 (`lib/operation-id.ts`). Identifica la operación mientras exista: ni las ediciones
   * sucesivas ni los reintentos generan otro.
   */
  operationId: string;
  /** Ediciones fundidas en la operación (1 = la primera). Distingue qué contenido se envió. */
  revision: number;
  /** Registro completo a guardar, en forma canónica. */
  content: DailyLogContent;
  /** Envíos fallidos del contenido actual (todos los reintentables). Marca la espera del backoff. */
  attempts: number;
  /**
   * De esos, los que cuentan para `MAX_SYNC_ATTEMPTS`: aquellos en los que el servidor respondió.
   * Los fallos de red no cuentan: estar sin conexión nunca agota una operación.
   */
  countedAttempts: number;
  /** Cuándo reintentar; `null` = cuanto antes. */
  nextAttemptAt: number | null;
  editedAt: number;
};

/** Último error de sincronización. `reason` es un código, nunca un mensaje ni contenido. */
export type LocalDailyLogSyncError = { kind: SyncErrorKind; reason: string; at: number };

export type LocalDailyLogConflict = {
  detail: DailyLogConflictDetail | null;
  /** Fila actual del servidor: sin leer todavía, borrada, o la fila. */
  remote: { status: 'not_fetched' } | { status: 'absent' } | { status: 'present'; row: DailyLog };
  detectedAt: number;
};

export type LocalDailyLog = {
  userId: string;
  petId: string;
  /** `YYYY-MM-DD`, fijada al crear el registro local. */
  logDate: string;
  /** Última fila confirmada por el servidor; `null` si el registro todavía no existe allí. */
  serverRow: DailyLog | null;
  /** `serverRow.updated_at` tal cual; `null` = se espera que el registro no exista. */
  baseVersion: string | null;
  status: LocalDailyLogSyncStatus;
  pending: LocalDailyLogPending | null;
  error: LocalDailyLogSyncError | null;
  conflict: LocalDailyLogConflict | null;
};

const SYNC_STATUSES: readonly string[] = ['synced', 'pending', 'failed', 'conflict'];
const ERROR_KINDS: readonly string[] = ['network', 'server', 'auth', 'permission', 'validation', 'conflict', 'unknown'];
const CONFLICT_DETAILS: readonly string[] = ['version_mismatch', 'row_missing', 'row_exists'];
const CODE_MAX_LENGTH = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInstant(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isCode(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && value.length <= CODE_MAX_LENGTH;
}

function parsePending(data: unknown): LocalDailyLogPending | null {
  if (!isRecord(data)) return null;
  const content = parseDailyLogContent(data.content);
  if (content === null || !isOperationId(data.operationId)) return null;
  if (!Number.isInteger(data.revision) || (data.revision as number) < 1) return null;
  if (!Number.isInteger(data.attempts) || (data.attempts as number) < 0) return null;
  if (!Number.isInteger(data.countedAttempts) || (data.countedAttempts as number) < 0) return null;
  if ((data.countedAttempts as number) > (data.attempts as number)) return null;
  if (data.nextAttemptAt !== null && !isInstant(data.nextAttemptAt)) return null;
  if (!isInstant(data.editedAt)) return null;
  return {
    operationId: data.operationId,
    revision: data.revision as number,
    content,
    attempts: data.attempts as number,
    countedAttempts: data.countedAttempts as number,
    nextAttemptAt: data.nextAttemptAt,
    editedAt: data.editedAt,
  };
}

function parseSyncError(data: unknown): LocalDailyLogSyncError | null {
  if (!isRecord(data)) return null;
  if (typeof data.kind !== 'string' || !ERROR_KINDS.includes(data.kind)) return null;
  if (!isCode(data.reason) || !isInstant(data.at)) return null;
  return { kind: data.kind as SyncErrorKind, reason: data.reason, at: data.at };
}

function parseConflict(data: unknown): LocalDailyLogConflict | null {
  if (!isRecord(data) || !isRecord(data.remote) || !isInstant(data.detectedAt)) return null;
  if (data.detail !== null && (typeof data.detail !== 'string' || !CONFLICT_DETAILS.includes(data.detail))) {
    return null;
  }
  const detail = data.detail as DailyLogConflictDetail | null;
  const { status } = data.remote;
  if (status === 'not_fetched' || status === 'absent') {
    return { detail, remote: { status }, detectedAt: data.detectedAt };
  }
  const row = status === 'present' ? parseDailyLogRow(data.remote.row) : null;
  return row === null ? null : { detail, remote: { status: 'present', row }, detectedAt: data.detectedAt };
}

/**
 * Valida un registro local (leído del almacén o recién construido): forma de cada campo y
 * coherencia entre ellos. `null` si no es válido; nunca se devuelve un registro a medias.
 */
export function parseLocalDailyLog(data: unknown): LocalDailyLog | null {
  if (!isRecord(data)) return null;
  const { userId, petId, logDate, status } = data;
  if (!isUuid(userId) || !isUuid(petId) || !isLogDate(logDate)) return null;
  if (typeof status !== 'string' || !SYNC_STATUSES.includes(status)) return null;

  const belongsHere = (row: DailyLog) => row.pet_id === petId && row.log_date === logDate;

  const serverRow = data.serverRow === null ? null : parseDailyLogRow(data.serverRow);
  if (data.serverRow !== null && (serverRow === null || !belongsHere(serverRow))) return null;
  // La versión base es siempre la de la fila confirmada, con la cadena exacta.
  if (data.baseVersion !== (serverRow?.updated_at ?? null)) return null;

  const pending = data.pending === null ? null : parsePending(data.pending);
  const error = data.error === null ? null : parseSyncError(data.error);
  const conflict = data.conflict === null ? null : parseConflict(data.conflict);
  if (data.pending !== null && pending === null) return null;
  if (data.error !== null && error === null) return null;
  if (data.conflict !== null && conflict === null) return null;
  if (conflict?.remote.status === 'present' && !belongsHere(conflict.remote.row)) return null;

  // Coherencia entre estado y campos.
  if ((status === 'synced') !== (pending === null)) return null;
  if ((status === 'conflict') !== (conflict !== null)) return null;
  if (status === 'synced' && (serverRow === null || error !== null)) return null;
  if (status === 'failed' && error === null) return null;

  return {
    userId,
    petId,
    logDate,
    serverRow,
    baseVersion: serverRow?.updated_at ?? null,
    status: status as LocalDailyLogSyncStatus,
    pending,
    error,
    conflict,
  };
}

/** Colección del almacén local: una clave por (`petId`, `logDate`) dentro del espacio del usuario. */
export const localDailyLogs: LocalCollection<LocalDailyLog> = {
  name: 'daily-logs',
  version: LOCAL_DAILY_LOG_VERSION,
  parse: parseLocalDailyLog,
  matchesKey: (log, key) =>
    log.userId === key.userId && key.id.length === 2 && log.petId === key.id[0] && log.logDate === key.id[1],
};

export function localDailyLogId(petId: string, logDate: string): [string, string] {
  return [petId, logDate];
}

export type LocalDailyLogStateErrorCode =
  | 'invalid_record'
  | 'identity_mismatch'
  | 'no_pending_operation'
  | 'not_in_conflict';

/** Uso incorrecto de una transición (error de programación, no de datos del usuario). */
export class LocalDailyLogStateError extends Error {
  readonly code: LocalDailyLogStateErrorCode;

  constructor(code: LocalDailyLogStateErrorCode) {
    super(code);
    this.name = 'LocalDailyLogStateError';
    this.code = code;
  }
}

/** Toda transición devuelve un registro que se puede guardar y volver a leer. */
function checked(log: LocalDailyLog): LocalDailyLog {
  const valid = parseLocalDailyLog(log);
  if (valid === null) throw new LocalDailyLogStateError('invalid_record');
  return valid;
}

export type LocalEdit = {
  userId: string;
  petId: string;
  logDate: string;
  /** Registro completo tal como queda tras la edición. */
  content: DailyLogContent;
  /**
   * Fila del servidor sobre la que se editó (la que cargó el formulario); `null` si no existía.
   * Solo se usa al crear la operación: mientras siga pendiente, su base no cambia.
   */
  baseRow: DailyLog | null;
};

/**
 * Guarda una edición local. Sin operación pendiente, crea una sobre `baseRow`. Si ya hay una, la
 * actualiza: mismo `operationId`, contenido sustituido por el nuevo (el formulario siempre trae el
 * registro completo), `revision + 1` e intentos a cero. Nunca hay dos operaciones del mismo registro.
 * Un conflicto sin resolver se mantiene. `logDate` es la del registro existente.
 */
export function applyLocalEdit(
  current: LocalDailyLog | null,
  edit: LocalEdit,
  env: { now: number; createOperationId: () => string }
): LocalDailyLog {
  if (
    current !== null &&
    (current.userId !== edit.userId || current.petId !== edit.petId || current.logDate !== edit.logDate)
  ) {
    throw new LocalDailyLogStateError('identity_mismatch');
  }
  const content = normalizeDailyLogContent(edit.content);

  if (current?.pending) {
    const inConflict = current.status === 'conflict';
    return checked({
      ...current,
      status: inConflict ? 'conflict' : 'pending',
      pending: {
        ...current.pending,
        revision: current.pending.revision + 1,
        content,
        attempts: 0,
        countedAttempts: 0,
        nextAttemptAt: null,
        editedAt: env.now,
      },
      error: inConflict ? current.error : null,
    });
  }

  const identity = { userId: edit.userId, petId: edit.petId, logDate: edit.logDate };
  const base = { serverRow: edit.baseRow, baseVersion: edit.baseRow?.updated_at ?? null };
  // Sin cambios respecto a la fila del servidor: no hay nada que enviar.
  if (edit.baseRow !== null && sameDailyLogContent(content, contentFromRow(edit.baseRow))) {
    return checked({ ...identity, ...base, status: 'synced', pending: null, error: null, conflict: null });
  }
  return checked({
    ...identity,
    ...base,
    status: 'pending',
    pending: {
      operationId: env.createOperationId(),
      revision: 1,
      content,
      attempts: 0,
      countedAttempts: 0,
      nextAttemptAt: null,
      editedAt: env.now,
    },
    error: null,
    conflict: null,
  });
}

/** Qué operación (y qué contenido) se envió: se captura antes de llamar al servidor. */
export type SentOperation = Pick<LocalDailyLogPending, 'operationId' | 'revision'>;

export function toSentOperation(log: LocalDailyLog): SentOperation {
  if (log.pending === null) throw new LocalDailyLogStateError('no_pending_operation');
  return { operationId: log.pending.operationId, revision: log.pending.revision };
}

/**
 * Precondición de `save_daily_log` para la operación pendiente: editar exactamente la versión
 * leída o crear solo si no existe. La sincronización nunca llama a la RPC sin una de las dos.
 */
export function toSyncPrecondition(
  log: LocalDailyLog
): { p_expected_updated_at: string } | { p_expect_absent: true } {
  return log.baseVersion === null ? { p_expect_absent: true } : { p_expected_updated_at: log.baseVersion };
}

/** ¿Se puede enviar ahora? Solo operaciones `pending` cuya espera ha terminado. */
export function isSyncDue(log: LocalDailyLog, now: number): boolean {
  return log.status === 'pending' && log.pending !== null && isAttemptDue(log.pending.nextAttemptAt, now);
}

function isSent(log: LocalDailyLog, sent: SentOperation): log is LocalDailyLog & { pending: LocalDailyLogPending } {
  return log.pending !== null && log.pending.operationId === sent.operationId;
}

/**
 * El servidor guardó lo enviado y devolvió `row`, que pasa a ser la base. Si mientras tanto hubo
 * otra edición local (otra `revision`), esa edición sigue pendiente, ahora sobre la fila nueva.
 */
export function applySyncSuccess(log: LocalDailyLog, sent: SentOperation, row: DailyLog): LocalDailyLog {
  const base = { serverRow: row, baseVersion: row.updated_at, error: null, conflict: null };
  const wasSent = isSent(log, sent) && log.pending.revision === sent.revision;
  if (log.pending === null || wasSent) {
    return checked({ ...log, ...base, status: 'synced', pending: null });
  }
  // Lo pendiente no es lo que se envió: no se descarta.
  return checked({
    ...log,
    ...base,
    status: 'pending',
    pending: { ...log.pending, attempts: 0, countedAttempts: 0, nextAttemptAt: null },
  });
}

/**
 * El envío falló. Según la clasificación (`classifySyncError`):
 * - `resolve_conflict`: pasa a `conflict` (fila remota sin leer todavía). No se reintenta: hay que
 *   reconciliar.
 * - `give_up` (permisos, validación): pasa a `failed` al primer fallo, sin reintento automático.
 * - `wait_for_auth`: sigue `pending` sin contar el intento. Quien sincronice debe esperar a tener
 *   sesión antes de volver a enviar (aquí no se programa ninguna espera).
 * - `retry`: cuenta el intento y programa el siguiente con backoff. Los fallos de red nunca agotan
 *   los intentos; los demás pasan a `failed` al llegar a `MAX_SYNC_ATTEMPTS`.
 * En ningún caso se descarta la operación: `failed` conserva `pending` (contenido incluido) y el
 * error, y se puede reintentar (`retryFailedSync`) o editar (`applyLocalEdit`).
 * Si el contenido cambió durante el envío (otra `revision`), el fallo era del contenido anterior:
 * salvo conflicto, solo se anota el error y la edición nueva se intenta cuanto antes.
 */
export function applySyncFailure(
  log: LocalDailyLog,
  sent: SentOperation,
  failure: SyncErrorInfo,
  env: { now: number; backoff?: BackoffOptions }
): LocalDailyLog {
  if (!isSent(log, sent)) return log;
  const error: LocalDailyLogSyncError = { kind: failure.kind, reason: failure.reason, at: env.now };

  if (failure.policy === 'resolve_conflict') {
    return checked({
      ...log,
      status: 'conflict',
      pending: { ...log.pending, nextAttemptAt: null },
      error,
      conflict: { detail: failure.conflict, remote: { status: 'not_fetched' }, detectedAt: env.now },
    });
  }
  if (log.status === 'conflict') return log;
  if (log.pending.revision !== sent.revision || failure.policy === 'wait_for_auth') {
    return checked({ ...log, error });
  }
  if (failure.policy === 'give_up') {
    return checked({ ...log, status: 'failed', pending: { ...log.pending, nextAttemptAt: null }, error });
  }

  const attempts = log.pending.attempts + 1;
  const countedAttempts = log.pending.countedAttempts + (failure.kind === 'network' ? 0 : 1);
  if (countedAttempts >= MAX_SYNC_ATTEMPTS) {
    return checked({
      ...log,
      status: 'failed',
      pending: { ...log.pending, attempts, countedAttempts, nextAttemptAt: null },
      error,
    });
  }
  return checked({
    ...log,
    status: 'pending',
    pending: {
      ...log.pending,
      attempts,
      countedAttempts,
      nextAttemptAt: nextAttemptAt(attempts, env.now, env.backoff),
    },
    error,
  });
}

/**
 * Reintento pedido por el usuario de una operación `failed`: vuelve a `pending` con los intentos a
 * cero. Es la misma operación (mismo `operationId` y contenido); el último error sigue anotado
 * hasta que un envío lo sustituya. En cualquier otro estado no cambia nada.
 */
export function retryFailedSync(log: LocalDailyLog): LocalDailyLog {
  if (log.status !== 'failed' || log.pending === null) return log;
  return checked({
    ...log,
    status: 'pending',
    pending: { ...log.pending, attempts: 0, countedAttempts: 0, nextAttemptAt: null },
  });
}

/** Guarda la fila remota leída tras un conflicto (`null` = ya no existe), para poder mostrarlo. */
export function setConflictRemote(log: LocalDailyLog, remoteRow: DailyLog | null): LocalDailyLog {
  if (log.conflict === null) throw new LocalDailyLogStateError('not_in_conflict');
  const remote: LocalDailyLogConflict['remote'] =
    remoteRow === null ? { status: 'absent' } : { status: 'present', row: remoteRow };
  return checked({ ...log, conflict: { ...log.conflict, remote } });
}

/**
 * Cierra un conflicto con el contenido ya fusionado o elegido (`daily-log-merge.ts`): la fila
 * remota pasa a ser la base y `content` queda pendiente sobre ella. Si `content` es lo que ya tiene
 * el servidor (p. ej. se perdió la respuesta de un envío anterior), queda `synced` sin enviar nada.
 */
export function resolveConflict(
  log: LocalDailyLog,
  resolution: { remoteRow: DailyLog | null; content: DailyLogContent },
  env: { now: number }
): LocalDailyLog {
  if (log.conflict === null || log.pending === null) throw new LocalDailyLogStateError('not_in_conflict');
  const { remoteRow } = resolution;
  const content = normalizeDailyLogContent(resolution.content);
  const base = { serverRow: remoteRow, baseVersion: remoteRow?.updated_at ?? null, error: null, conflict: null };

  if (remoteRow !== null && sameDailyLogContent(content, contentFromRow(remoteRow))) {
    return checked({ ...log, ...base, status: 'synced', pending: null });
  }
  return checked({
    ...log,
    ...base,
    status: 'pending',
    pending: {
      ...log.pending,
      revision: log.pending.revision + 1,
      content,
      attempts: 0,
      countedAttempts: 0,
      nextAttemptAt: null,
      editedAt: env.now,
    },
  });
}
