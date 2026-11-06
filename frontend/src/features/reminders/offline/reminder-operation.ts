import type { Reminder } from '@/features/reminders/reminder-model';
import type { LocalCollection } from '@/lib/local-store/local-store';

import { compareVersions, parseVersion } from '../../daily-logs/offline/daily-log-version.ts';
import { MAX_SYNC_ATTEMPTS, nextAttemptAt, type BackoffOptions } from '../../daily-logs/offline/sync-backoff.ts';
import type { SyncErrorInfo } from '../../daily-logs/offline/sync-errors.ts';

/**
 * Altas, ediciones y eliminaciones de recordatorios guardadas en el dispositivo hasta que el servidor las
 * confirma (agenda sin conexión, fase 14). Módulo puro: se prueba con `npm test`. Contrato:
 * `docs/FRONTEND_ARCHITECTURE.md` §5 «Agenda sin conexión (fase 14)». Mismo modelo que Pets (fases 8 y 10):
 *
 * Una operación por recordatorio (`kitom:v1:<userId>:reminder-ops:<localId>`), siempre con usuario y mascota:
 * - Alta: `localId` = `local-<uuid>`. Se envía con `operationId` como `client_request_id` (migración
 *   `20261105093545`): reenviarla nunca duplica. Confirmada queda `synced` con `reminderId` (mapeo).
 * - Edición: `localId` = id del servidor, con la fila sobre la que se editó (`baseRow`) como precondición.
 *   Activar, desactivar, «Hecho» y posponer son ediciones: se consolidan en la misma operación.
 * - Eliminación: sustituye a la operación y guarda lo que vuelve al deshacerla (`restore`). Confirmada queda
 *   `synced` (lápida). Un alta incierta se busca por su clave antes de decidir.
 *
 * Estados: `pending` (`inFlightSince` ≠ null = enviada sin saber el resultado), `conflict`, `failed`,
 * `forbidden` y `synced`. Nada se marca `synced` sin la fila del servidor.
 */

/** Columnas que escribe la app. Nunca `id`, `pet_id` (al editar), `created_by`, `created_at` ni `updated_at`. */
export type ReminderContent = Pick<
  Reminder,
  'type' | 'title' | 'description' | 'due_at' | 'recurrence_rule' | 'snooze_until' | 'status' | 'completed_at' | 'is_active'
>;

export type ReminderOperationKind = 'create' | 'update' | 'delete';
export type ReminderDeleteRestore = 'none' | 'update' | 'create';
export type ReminderOperationStatus = 'pending' | 'conflict' | 'failed' | 'forbidden' | 'synced';
export type ReminderOperationError = { kind: SyncErrorInfo['kind']; reason: string; at: number };

export type LocalReminderOperation = {
  userId: string;
  petId: string;
  /** Alta: `local-<uuid>`. Edición: el id del servidor. Eliminación: el de su operación. */
  localId: string;
  /** Id en el servidor (edición: siempre; alta: al confirmarse; eliminación de un alta: al comprobarla). */
  reminderId: string | null;
  kind: ReminderOperationKind;
  content: ReminderContent;
  baseRow: Reminder | null;
  restore: ReminderDeleteRestore | null;
  operationId: string;
  status: ReminderOperationStatus;
  attempts: number;
  nextAttemptAt: number | null;
  lastError: ReminderOperationError | null;
  inFlightSince: number | null;
  conflictRemote: Reminder | null;
  createdAt: number;
  editedAt: number;
  syncedAt: number | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LOCAL_ID = /^local-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const isReminderUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

/** ¿Es un recordatorio creado en este dispositivo y aún sin id del servidor? Nunca se pide al servidor. */
export function isLocalReminderId(value: unknown): value is string {
  return typeof value === 'string' && LOCAL_ID.test(value);
}

export function localReminderIdFor(operationId: string): string {
  return `local-${operationId}`;
}

// ---------------------------------------------------------------------------------------------
// Contenido
// ---------------------------------------------------------------------------------------------

/** Campos que se comparan y se deciden juntos. */
export const REMINDER_FIELD_GROUPS = [
  { key: 'content', fields: ['type', 'title', 'description'] },
  { key: 'date', fields: ['due_at', 'recurrence_rule', 'snooze_until'] },
  { key: 'status', fields: ['status', 'completed_at'] },
  { key: 'active', fields: ['is_active'] },
] as const satisfies readonly { key: string; fields: readonly (keyof ReminderContent)[] }[];

export type ReminderFieldGroup = (typeof REMINDER_FIELD_GROUPS)[number]['key'];

const CONTENT_FIELDS = REMINDER_FIELD_GROUPS.flatMap((group) => group.fields) as (keyof ReminderContent)[];
const INSTANT_FIELDS: readonly (keyof ReminderContent)[] = ['due_at', 'snooze_until', 'completed_at'];

/** Mismo instante aunque el texto difiera: el cliente envía `…000Z` y el servidor devuelve `…+00:00`. */
function sameField(field: keyof ReminderContent, a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!INSTANT_FIELDS.includes(field) || typeof a !== 'string' || typeof b !== 'string') return false;
  return Date.parse(a) === Date.parse(b);
}

export function contentOf(row: Pick<Reminder, keyof ReminderContent>): ReminderContent {
  return Object.fromEntries(CONTENT_FIELDS.map((field) => [field, row[field]])) as ReminderContent;
}

export function sameGroup(a: ReminderContent, b: ReminderContent, group: ReminderFieldGroup): boolean {
  const fields = REMINDER_FIELD_GROUPS.find((item) => item.key === group)!.fields as readonly (keyof ReminderContent)[];
  return fields.every((field) => sameField(field, a[field], b[field]));
}

export function sameReminderContent(a: ReminderContent, b: ReminderContent): boolean {
  return REMINDER_FIELD_GROUPS.every((group) => sameGroup(a, b, group.key));
}

/**
 * Fusión a tres bandas por grupo: cambiado solo en un lado → ese valor; en los dos con el mismo valor → ese;
 * en los dos con valores distintos → `conflicts` (decide el usuario).
 */
export function mergeReminderContent(
  base: ReminderContent,
  local: ReminderContent,
  remote: ReminderContent
): { merged: ReminderContent; conflicts: ReminderFieldGroup[] } {
  const merged = { ...remote };
  const conflicts: ReminderFieldGroup[] = [];
  for (const group of REMINDER_FIELD_GROUPS) {
    const localChanged = !sameGroup(local, base, group.key);
    const remoteChanged = !sameGroup(remote, base, group.key);
    if (localChanged && remoteChanged && !sameGroup(local, remote, group.key)) conflicts.push(group.key);
    if (localChanged) for (const field of group.fields) (merged as Record<string, unknown>)[field] = local[field];
  }
  return { merged, conflicts };
}

/** Grupos en los que chocan lo del dispositivo y lo del servidor (para enseñarlos). */
export function conflictGroups(op: LocalReminderOperation): ReminderFieldGroup[] {
  if (!op.baseRow || !op.conflictRemote) return [];
  return mergeReminderContent(contentOf(op.baseRow), op.content, contentOf(op.conflictRemote)).conflicts;
}

/** Decisión global sobre un conflicto: lo que no choca se fusiona; lo que choca, del lado elegido. */
export function chooseReminderContent(op: LocalReminderOperation, shownRemote: Reminder, choice: 'local' | 'remote'): ReminderContent {
  const remote = contentOf(shownRemote);
  if (!op.baseRow) return choice === 'local' ? op.content : remote;
  const { merged, conflicts } = mergeReminderContent(contentOf(op.baseRow), op.content, remote);
  const chosen = { ...merged };
  for (const group of REMINDER_FIELD_GROUPS) {
    if (!conflicts.includes(group.key)) continue;
    const source = choice === 'local' ? op.content : remote;
    for (const field of group.fields) (chosen as Record<string, unknown>)[field] = source[field];
  }
  return chosen;
}

// ---------------------------------------------------------------------------------------------
// Validación al leer
// ---------------------------------------------------------------------------------------------

const TYPES = ['vaccine', 'medication', 'appointment', 'bath', 'deworming', 'other'];
const REMINDER_STATUSES = ['pending', 'completed', 'skipped'];
const STATUSES: ReminderOperationStatus[] = ['pending', 'conflict', 'failed', 'forbidden', 'synced'];
const RESTORES: ReminderDeleteRestore[] = ['none', 'update', 'create'];
const ERROR_KINDS = ['network', 'server', 'auth', 'permission', 'validation', 'conflict', 'unknown'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isTime = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const isInstant = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const nullable = (check: (value: unknown) => boolean) => (value: unknown) => value === null || check(value);
const isText = (value: unknown) => typeof value === 'string';

const CONTENT_CHECKS: Record<keyof ReminderContent, (value: unknown) => boolean> = {
  type: (value) => TYPES.includes(value as string),
  title: (value) => typeof value === 'string' && value.trim() !== '',
  description: nullable(isText),
  due_at: isInstant,
  recurrence_rule: nullable((value) => typeof value === 'string' && /^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)/.test(value)),
  snooze_until: nullable(isInstant),
  status: (value) => REMINDER_STATUSES.includes(value as string),
  completed_at: nullable(isInstant),
  is_active: (value) => typeof value === 'boolean',
};

/** Solo las columnas que escribe la app, validadas (`null` si falta alguna o no tiene el tipo esperado). */
export function parseReminderContent(value: unknown): ReminderContent | null {
  if (!isRecord(value)) return null;
  const content: Record<string, unknown> = {};
  for (const field of CONTENT_FIELDS) {
    if (!(field in value) || !CONTENT_CHECKS[field](value[field])) return null;
    content[field] = value[field];
  }
  return content as ReminderContent;
}

/** Fila de `reminders` validada: exactamente las columnas de `REMINDER_COLUMNS`. Nunca URLs ni tokens. */
export function toCachedReminder(value: unknown): Reminder | null {
  if (!isRecord(value)) return null;
  const content = parseReminderContent(value);
  if (!content) return null;
  const { id, pet_id: petId, created_by: createdBy, created_at: createdAt, updated_at: updatedAt, attachment_path: attachment } = value;
  if (!isReminderUuid(id) || !isReminderUuid(petId)) return null;
  if (createdBy !== null && !isReminderUuid(createdBy)) return null;
  if (typeof createdAt !== 'string' || typeof updatedAt !== 'string' || parseVersion(updatedAt) === null) return null;
  if (attachment !== null && (typeof attachment !== 'string' || attachment.includes('://'))) return null;
  return {
    ...content,
    id,
    pet_id: petId,
    created_by: createdBy as string | null,
    created_at: createdAt,
    updated_at: updatedAt,
    attachment_path: attachment as string | null,
  };
}

function parseError(value: unknown): ReminderOperationError | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !ERROR_KINDS.includes(value.kind as string) || typeof value.reason !== 'string' || !isTime(value.at)) {
    return undefined;
  }
  return { kind: value.kind as ReminderOperationError['kind'], reason: value.reason, at: value.at as number };
}

export function parseLocalReminderOperation(data: unknown): LocalReminderOperation | null {
  if (!isRecord(data)) return null;
  const { userId, petId, localId, reminderId, kind, status, operationId } = data;
  if (!isReminderUuid(userId) || !isReminderUuid(petId) || typeof operationId !== 'string' || !UUID_V4.test(operationId)) return null;
  if (kind !== 'create' && kind !== 'update' && kind !== 'delete') return null;
  if (!STATUSES.includes(status as ReminderOperationStatus)) return null;
  const content = parseReminderContent(data.content);
  if (!content) return null;
  const restore = data.restore;

  if (kind === 'create') {
    if (localId !== localReminderIdFor(operationId) || data.baseRow !== null || restore !== null) return null;
    if (status === 'synced' ? !isReminderUuid(reminderId) : reminderId !== null) return null;
  } else if (kind === 'update') {
    if (!isReminderUuid(localId) || reminderId !== localId || status === 'synced' || restore !== null) return null;
  } else {
    if (!RESTORES.includes(restore as ReminderDeleteRestore)) return null;
    const fromCreate = restore === 'create';
    if (fromCreate ? localId !== localReminderIdFor(operationId) : !isReminderUuid(localId) || reminderId !== localId) return null;
    if (reminderId !== null && !isReminderUuid(reminderId)) return null;
    if ((status === 'synced' || !fromCreate) && reminderId === null) return null;
  }
  const baseRow = data.baseRow === null ? null : toCachedReminder(data.baseRow);
  if (data.baseRow !== null && !baseRow) return null;
  if (kind === 'update' && (!baseRow || baseRow.id !== localId)) return null;
  if (kind === 'delete' && (reminderId === null ? baseRow !== null : !baseRow || baseRow.id !== reminderId)) return null;
  const conflictRemote = data.conflictRemote === null ? null : toCachedReminder(data.conflictRemote);
  if (data.conflictRemote !== null && !conflictRemote) return null;
  const lastError = parseError(data.lastError);
  if (lastError === undefined) return null;
  if (!Number.isInteger(data.attempts) || (data.attempts as number) < 0) return null;
  for (const field of ['nextAttemptAt', 'inFlightSince', 'syncedAt'] as const) {
    if (data[field] !== null && !isTime(data[field])) return null;
  }
  if (!isTime(data.createdAt) || !isTime(data.editedAt)) return null;

  return {
    userId,
    petId,
    localId: localId as string,
    reminderId: (reminderId as string | null) ?? null,
    kind,
    content,
    baseRow,
    restore: restore as ReminderDeleteRestore | null,
    operationId,
    status: status as ReminderOperationStatus,
    attempts: data.attempts as number,
    nextAttemptAt: data.nextAttemptAt as number | null,
    lastError,
    inFlightSince: data.inFlightSince as number | null,
    conflictRemote,
    createdAt: data.createdAt as number,
    editedAt: data.editedAt as number,
    syncedAt: data.syncedAt as number | null,
  };
}

export const REMINDER_OPERATIONS: LocalCollection<LocalReminderOperation> = {
  name: 'reminder-ops',
  version: 1,
  parse: parseLocalReminderOperation,
  matchesKey: (value, key) => key.id.length === 1 && value.localId === key.id[0] && value.userId === key.userId,
};

// ---------------------------------------------------------------------------------------------
// Transiciones
// ---------------------------------------------------------------------------------------------

type Clock = { now: number };

const READY = { status: 'pending' as const, attempts: 0, nextAttemptAt: null, lastError: null };

export function createReminderOperation(
  input: { userId: string; petId: string; content: ReminderContent; operationId: string },
  { now }: Clock
): LocalReminderOperation {
  return {
    userId: input.userId,
    petId: input.petId,
    localId: localReminderIdFor(input.operationId),
    reminderId: null,
    kind: 'create',
    content: input.content,
    baseRow: null,
    restore: null,
    operationId: input.operationId,
    ...READY,
    inFlightSince: null,
    conflictRemote: null,
    createdAt: now,
    editedAt: now,
    syncedAt: null,
  };
}

export type ReminderEditRejection = 'not_editable' | 'synced_create' | 'pending_delete';

/**
 * Edición guardada en el dispositivo. Con una operación pendiente o fallida se consolida (mismo id y misma
 * base, contenido nuevo). En conflicto o sin permiso no se edita: primero se decide qué hacer con ella.
 * `null` = el contenido ya es el de la base (nada que enviar).
 */
export function applyReminderEdit(
  current: LocalReminderOperation | null,
  input: { userId: string; localId: string; patch: Partial<ReminderContent>; baseRow: Reminder | null; operationId: string },
  { now }: Clock
): LocalReminderOperation | null | { rejected: ReminderEditRejection } {
  if (current?.kind === 'delete') return { rejected: 'pending_delete' };
  if (current && (current.status === 'conflict' || current.status === 'forbidden')) return { rejected: 'not_editable' };
  if (current?.kind === 'create') {
    if (current.status === 'synced') return { rejected: 'synced_create' };
    return { ...current, content: { ...current.content, ...input.patch }, ...READY, editedAt: now };
  }
  const baseRow = current?.baseRow ?? input.baseRow;
  if (!baseRow) return { rejected: 'not_editable' };
  const content = { ...(current?.content ?? contentOf(baseRow)), ...input.patch };
  if (sameReminderContent(content, contentOf(baseRow))) return null;
  if (current) return { ...current, content, ...READY, editedAt: now };
  return {
    userId: input.userId,
    petId: baseRow.pet_id,
    localId: input.localId,
    reminderId: input.localId,
    kind: 'update',
    content,
    baseRow,
    restore: null,
    operationId: input.operationId,
    ...READY,
    inFlightSince: null,
    conflictRemote: null,
    createdAt: now,
    editedAt: now,
    syncedAt: null,
  };
}

export function markSent(op: LocalReminderOperation, { now }: Clock): LocalReminderOperation {
  return { ...op, inFlightSince: now };
}

export function applyCreateConfirmed(op: LocalReminderOperation, row: Reminder, { now }: Clock): LocalReminderOperation {
  return { ...op, reminderId: row.id, status: 'synced', inFlightSince: null, lastError: null, nextAttemptAt: null, syncedAt: now };
}

/** Fallo al enviar: red y sesión no cuentan como intento; sin permiso → `forbidden`; rechazo → `failed`. */
export function applyReminderSyncFailure(
  op: LocalReminderOperation,
  failure: SyncErrorInfo,
  { now, backoff }: Clock & { backoff?: BackoffOptions }
): LocalReminderOperation {
  const lastError = { kind: failure.kind, reason: failure.reason, at: now };
  const noResponse = failure.kind === 'network';
  const inFlightSince = noResponse ? op.inFlightSince : null;
  if (failure.policy === 'wait_for_auth' || noResponse) {
    return { ...op, status: 'pending', lastError, inFlightSince, nextAttemptAt: noResponse ? nextAttemptAt(1, now, backoff) : null };
  }
  if (failure.kind === 'permission') return { ...op, status: 'forbidden', lastError, inFlightSince, nextAttemptAt: null };
  if (failure.policy === 'give_up') return { ...op, status: 'failed', lastError, inFlightSince, nextAttemptAt: null };
  const attempts = op.attempts + 1;
  if (attempts >= MAX_SYNC_ATTEMPTS) return { ...op, status: 'failed', attempts, lastError, inFlightSince, nextAttemptAt: null };
  return { ...op, status: 'pending', attempts, lastError, inFlightSince, nextAttemptAt: nextAttemptAt(attempts, now, backoff) };
}

export function toForbidden(op: LocalReminderOperation, reason: string, { now }: Clock): LocalReminderOperation {
  return { ...op, status: 'forbidden', inFlightSince: null, nextAttemptAt: null, conflictRemote: null, lastError: { kind: 'permission', reason, at: now } };
}

export type ReminderEditReconcile =
  | { result: 'synced'; row: Reminder }
  | { result: 'forbidden' | 'rebase' | 'conflict'; op: LocalReminderOperation };

/**
 * La edición tocó 0 filas y se leyó la actual: no existe o no se ve (`forbidden`); mismo contenido
 * (`synced`, respuesta perdida); misma versión (`forbidden`, lo filtró RLS); otros campos (`rebase`); los
 * mismos campos con otro valor o una versión no comparable (`conflict`).
 */
export function reconcileEdit(op: LocalReminderOperation, row: Reminder | null, clock: Clock): ReminderEditReconcile {
  if (!row) return { result: 'forbidden', op: toForbidden(op, 'not_visible', clock) };
  if (sameReminderContent(contentOf(row), op.content)) return { result: 'synced', row };
  const base = op.baseRow!;
  const order = compareVersions(row.updated_at, base.updated_at);
  if (order === 0) return { result: 'forbidden', op: toForbidden(op, 'not_editable', clock) };
  const conflict = (): ReminderEditReconcile => ({
    result: 'conflict',
    op: { ...op, status: 'conflict', conflictRemote: row, inFlightSince: null, nextAttemptAt: null },
  });
  if (order !== 1) return conflict();
  const { merged, conflicts } = mergeReminderContent(contentOf(base), op.content, contentOf(row));
  if (conflicts.length > 0) return conflict();
  return { result: 'rebase', op: { ...op, content: merged, baseRow: row, ...READY, inFlightSince: null, attempts: op.attempts } };
}

/** Decisión del usuario sobre un conflicto, viendo `shownRemote`. `null` = ya coincide: nada que enviar. */
export function resolveReminderConflict(op: LocalReminderOperation, shownRemote: Reminder, content: ReminderContent): LocalReminderOperation | null {
  if (sameReminderContent(content, contentOf(shownRemote))) return null;
  return { ...op, content, baseRow: shownRemote, ...READY, conflictRemote: null };
}

export function retryReminderOperation(op: LocalReminderOperation): LocalReminderOperation {
  if (op.status === 'synced') return op;
  if (op.status === 'conflict') return { ...op, conflictRemote: null };
  return { ...op, ...READY };
}

export function isReminderOperationDue(op: LocalReminderOperation, now: number): boolean {
  if (op.status !== 'pending') return false;
  return op.nextAttemptAt === null || now >= op.nextAttemptAt || op.nextAttemptAt - now > 5 * 60_000;
}

/** Se descarta solo por decisión del usuario. Lo enviado sin respuesta no: podría estar ya aplicado. */
export function canDiscardReminderOperation(op: LocalReminderOperation): boolean {
  return op.status !== 'synced' && op.inFlightSince === null && op.kind !== 'delete';
}

export type ReminderDeleteRequest =
  | { result: 'cancelled' }
  | { result: 'saved'; op: LocalReminderOperation }
  | { result: 'rejected'; reason: 'no_base' | 'synced_create' | 'not_deletable' };

export function requestReminderDelete(
  current: LocalReminderOperation | null,
  input: { userId: string; localId: string; baseRow: Reminder | null; operationId: string },
  { now }: Clock
): ReminderDeleteRequest {
  if (current?.kind === 'delete') return { result: 'saved', op: current };
  const pending = { ...READY, conflictRemote: null, syncedAt: null };
  if (current?.kind === 'create') {
    if (current.status === 'synced') return { result: 'rejected', reason: 'synced_create' };
    if (current.status === 'forbidden') return { result: 'rejected', reason: 'not_deletable' };
    if (current.inFlightSince === null) return { result: 'cancelled' };
    return {
      result: 'saved',
      op: { ...current, ...pending, kind: 'delete', reminderId: null, baseRow: null, restore: 'create', inFlightSince: null, editedAt: now },
    };
  }
  if (isLocalReminderId(input.localId)) return { result: 'cancelled' };
  const base = current?.kind === 'update' ? current.baseRow : input.baseRow;
  if (!base || base.id !== input.localId) return { result: 'rejected', reason: 'no_base' };
  return {
    result: 'saved',
    op: {
      userId: input.userId,
      petId: base.pet_id,
      localId: input.localId,
      reminderId: input.localId,
      kind: 'delete',
      content: current?.kind === 'update' ? current.content : contentOf(base),
      baseRow: base,
      restore: current?.kind === 'update' ? 'update' : 'none',
      operationId: input.operationId,
      ...pending,
      inFlightSince: null,
      createdAt: now,
      editedAt: now,
    },
  };
}

export function undoReminderDelete(
  op: LocalReminderOperation,
  { now }: Clock
): LocalReminderOperation | null | { rejected: 'not_delete' | 'confirmed' | 'in_flight' } {
  if (op.kind !== 'delete') return { rejected: 'not_delete' };
  if (op.status === 'synced') return { rejected: 'confirmed' };
  if (op.inFlightSince !== null) return { rejected: 'in_flight' };
  const reset = { ...READY, conflictRemote: null, restore: null, editedAt: now };
  if (op.restore === 'none') return null;
  if (op.restore === 'update') return { ...op, ...reset, kind: 'update', inFlightSince: null };
  if (op.reminderId !== null) return { ...op, ...reset, kind: 'create', baseRow: null, status: 'synced', inFlightSince: null, syncedAt: now };
  // Vuelve como incierta: reenviarla es seguro (su clave) y no se puede descartar como si nunca hubiera salido.
  return { ...op, ...reset, kind: 'create', baseRow: null, inFlightSince: now };
}

export function resolveCreatedForDelete(
  op: LocalReminderOperation,
  row: Reminder | null
): { result: 'cancelled' } | { result: 'resolved' | 'conflict'; op: LocalReminderOperation } {
  if (!row) return { result: 'cancelled' };
  const known = { ...op, reminderId: row.id, baseRow: row, inFlightSince: null };
  if (sameReminderContent(contentOf(row), op.content)) return { result: 'resolved', op: known };
  return { result: 'conflict', op: { ...known, status: 'conflict', conflictRemote: row, nextAttemptAt: null } };
}

export function applyDeleteConfirmed(op: LocalReminderOperation, { now }: Clock): LocalReminderOperation {
  return { ...op, status: 'synced', inFlightSince: null, lastError: null, nextAttemptAt: null, conflictRemote: null, syncedAt: now };
}

export type ReminderDeleteReconcile = { result: 'gone' } | { result: 'rebase' | 'forbidden' | 'conflict'; op: LocalReminderOperation };

/** El borrado tocó 0 filas: ya no está; misma versión (sin permiso); mi edición recién llegada; o cambió. */
export function reconcileDelete(op: LocalReminderOperation, row: Reminder | null, clock: Clock): ReminderDeleteReconcile {
  if (!row) return { result: 'gone' };
  const order = compareVersions(row.updated_at, op.baseRow!.updated_at);
  if (order === 0) return { result: 'forbidden', op: toForbidden(op, 'not_editable', clock) };
  if (order === 1 && op.restore === 'update' && sameReminderContent(contentOf(row), op.content)) {
    return { result: 'rebase', op: { ...op, baseRow: row, status: 'pending', inFlightSince: null, nextAttemptAt: null, lastError: null } };
  }
  return { result: 'conflict', op: { ...op, status: 'conflict', conflictRemote: row, inFlightSince: null, nextAttemptAt: null } };
}

export function resolveDeleteConflict(op: LocalReminderOperation, shownRemote: Reminder): LocalReminderOperation {
  return { ...op, reminderId: shownRemote.id, baseRow: shownRemote, ...READY, conflictRemote: null };
}

// ---------------------------------------------------------------------------------------------
// Resumen y presentación
// ---------------------------------------------------------------------------------------------

export type ReminderUnsyncedSummary = {
  pendingCreate: number;
  pendingUpdate: number;
  pendingDelete: number;
  uncertain: number;
  conflict: number;
  failed: number;
  forbidden: number;
  unreadable: number;
};

export const NO_REMINDER_CHANGES: ReminderUnsyncedSummary = {
  pendingCreate: 0,
  pendingUpdate: 0,
  pendingDelete: 0,
  uncertain: 0,
  conflict: 0,
  failed: 0,
  forbidden: 0,
  unreadable: 0,
};

export function summarizeReminderOperations(ops: readonly LocalReminderOperation[], unreadable = 0): ReminderUnsyncedSummary {
  const summary = { ...NO_REMINDER_CHANGES, unreadable };
  for (const op of ops) {
    if (op.status === 'synced') continue;
    if (op.status === 'pending') {
      if (op.inFlightSince !== null) summary.uncertain += 1;
      else if (op.kind === 'create') summary.pendingCreate += 1;
      else if (op.kind === 'delete') summary.pendingDelete += 1;
      else summary.pendingUpdate += 1;
    } else {
      summary[op.status] += 1;
    }
  }
  return summary;
}

export function reminderUnsyncedTotal(summary: ReminderUnsyncedSummary): number {
  return Object.values(summary).reduce((total, value) => total + value, 0);
}

export type ReminderSyncDisplay = 'pending' | 'pending_delete' | 'syncing' | 'uncertain' | 'conflict' | 'failed' | 'forbidden';

export function reminderSyncDisplay(op: LocalReminderOperation | null | undefined, syncing: boolean): ReminderSyncDisplay | null {
  if (!op || op.status === 'synced') return null;
  if (syncing) return 'syncing';
  if (op.status === 'pending') {
    if (op.inFlightSince !== null) return 'uncertain';
    return op.kind === 'delete' ? 'pending_delete' : 'pending';
  }
  return op.status;
}

/** El recordatorio tal como se ve en el dispositivo: los datos del servidor con el contenido local encima. */
export function reminderWithLocalContent(op: LocalReminderOperation, server: Reminder | null): Reminder {
  const created = new Date(op.createdAt).toISOString();
  const base: Reminder = server ??
    op.baseRow ?? {
      id: op.localId,
      pet_id: op.petId,
      attachment_path: null,
      created_by: op.userId,
      created_at: created,
      updated_at: new Date(op.editedAt).toISOString(),
      ...op.content,
    };
  return { ...base, ...op.content };
}

/** Operación de un recordatorio por su id local o del servidor (también la lápida o el mapeo). */
export function operationFor(ops: readonly LocalReminderOperation[] | undefined, id: string): LocalReminderOperation | null {
  return ops?.find((op) => op.localId === id || op.reminderId === id) ?? null;
}
