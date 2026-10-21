import type { Pet, PetFields } from '@/features/pets/types';
import type { LocalCollection } from '@/lib/local-store/local-store';

import { compareVersions } from '../../daily-logs/offline/daily-log-version.ts';
import { MAX_SYNC_ATTEMPTS, nextAttemptAt, type BackoffOptions } from '../../daily-logs/offline/sync-backoff.ts';
import type { SyncErrorInfo } from '../../daily-logs/offline/sync-errors.ts';
import { isPetId, toCachedPet } from './pet-snapshot.ts';

/**
 * Altas y ediciones de mascotas guardadas en el dispositivo hasta que el servidor las confirma (Pets
 * offline, fase 8). Módulo puro: se prueba con `npm test`. Contrato: `docs/FRONTEND_ARCHITECTURE.md` §5
 * «Pets: altas y ediciones sin conexión (fase 8)».
 *
 * Una operación por mascota (`kitom:v1:<userId>:pet-ops:<localId>`):
 * - Alta: `localId` = `local-<uuid>` (nunca con forma de id del servidor: no se inventa el id remoto).
 *   Se envía con `operationId` como `client_request_id`: reenviarla nunca duplica (índice único por
 *   propietario, migración `20261020135440`). Al confirmarse queda `synced` con `petId`: es el mapeo
 *   persistente `localId → petId`.
 * - Edición: `localId` = `petId`. Guarda la fila del servidor sobre la que se editó (`baseRow`, con su
 *   `updated_at` exacto) y se envía con esa precondición (`update … eq('updated_at', base)`). Varias
 *   ediciones se consolidan en la misma operación (contenido nuevo, la misma base). Confirmada, se borra:
 *   la copia de la mascota (`pet-cache-repository.ts`) recibe la fila del servidor.
 *
 * Estados: `pending` (se enviará; `inFlightSince` ≠ null = se envió y no se sabe el resultado), `conflict`
 * (el servidor cambió los mismos datos: decide el usuario), `failed` (el servidor la rechazó o agotó
 * los reintentos: datos intactos), `forbidden` (sin permiso, o la mascota ya no se ve) y `synced` (solo
 * altas, como mapeo). Nada se marca `synced` sin la fila que devuelve el servidor.
 */

export type PetOperationKind = 'create' | 'update';
export type PetOperationStatus = 'pending' | 'conflict' | 'failed' | 'forbidden' | 'synced';

export type PetOperationError = { kind: SyncErrorInfo['kind']; reason: string; at: number };

export type LocalPetOperation = {
  userId: string;
  /** Alta: `local-<uuid>`. Edición: el id de la mascota en el servidor. */
  localId: string;
  /** Id en el servidor (edición: siempre; alta: al confirmarse). */
  petId: string | null;
  kind: PetOperationKind;
  /** Columnas editables validadas (nunca `owner_id`, `id`, `photo_path` ni `is_active`). */
  content: PetFields;
  /** Edición: la fila del servidor sobre la que se editó. Alta: `null`. */
  baseRow: Pet | null;
  /** UUID v4 estable de la operación (en un alta, su `client_request_id`). */
  operationId: string;
  status: PetOperationStatus;
  /** Fallos con respuesta del servidor (no de red): con `MAX_SYNC_ATTEMPTS` pasa a `failed`. */
  attempts: number;
  nextAttemptAt: number | null;
  lastError: PetOperationError | null;
  /** Se envió y no se sabe si el servidor la aplicó (p. ej. la app se cerró o se cortó la red). */
  inFlightSince: number | null;
  /** Conflicto: la fila del servidor con la que choca (`null` = no se pudo leer todavía). */
  conflictRemote: Pet | null;
  createdAt: number;
  editedAt: number;
  syncedAt: number | null;
};

const LOCAL_ID = /^local-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** ¿Es el id de una mascota creada en este dispositivo y aún sin id del servidor? */
export function isLocalPetId(value: unknown): value is string {
  return typeof value === 'string' && LOCAL_ID.test(value);
}

export function localPetIdFor(operationId: string): string {
  return `local-${operationId}`;
}

// ---------------------------------------------------------------------------------------------
// Contenido
// ---------------------------------------------------------------------------------------------

/** Campos que se comparan y se deciden juntos (la raza depende de la especie). */
export const PET_FIELD_GROUPS = [
  { key: 'name', fields: ['name'] },
  { key: 'species', fields: ['species_id', 'breed_status', 'breed_id', 'breed'] },
  { key: 'sex', fields: ['sex'] },
  { key: 'birth_date', fields: ['birth_date'] },
  { key: 'weight_kg', fields: ['weight_kg'] },
  { key: 'sterilized', fields: ['sterilized'] },
  { key: 'known_conditions', fields: ['known_conditions'] },
  { key: 'allergies', fields: ['allergies'] },
  { key: 'temperament_notes', fields: ['temperament_notes'] },
] as const satisfies readonly { key: string; fields: readonly (keyof PetFields)[] }[];

export type PetFieldGroup = (typeof PET_FIELD_GROUPS)[number]['key'];

const EDITABLE_FIELDS = PET_FIELD_GROUPS.flatMap((group) => group.fields) as (keyof PetFields)[];

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    // `NULL` y `{}` en una lista son «sin datos» para el formulario: no es un cambio.
    const left = (a as unknown[] | null) ?? [];
    const right = (b as unknown[] | null) ?? [];
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((v, i) => v === right[i]);
  }
  return a === b;
}

/** Las columnas editables de una fila del servidor. */
export function contentOf(row: Pick<Pet, keyof PetFields>): PetFields {
  return Object.fromEntries(EDITABLE_FIELDS.map((field) => [field, row[field]])) as PetFields;
}

export function sameGroup(a: PetFields, b: PetFields, group: PetFieldGroup): boolean {
  const fields = PET_FIELD_GROUPS.find((item) => item.key === group)!.fields as readonly (keyof PetFields)[];
  return fields.every((field) => sameValue(a[field], b[field]));
}

export function samePetContent(a: PetFields, b: PetFields): boolean {
  return PET_FIELD_GROUPS.every((group) => sameGroup(a, b, group.key));
}

/** Grupos que difieren entre dos contenidos. */
export function changedGroups(from: PetFields, to: PetFields): PetFieldGroup[] {
  return PET_FIELD_GROUPS.filter((group) => !sameGroup(from, to, group.key)).map((group) => group.key);
}

/**
 * Fusión a tres bandas (base · local · servidor), por grupo de campos:
 * - cambiado solo en el dispositivo → el local; solo en el servidor → el del servidor;
 * - en los dos con el mismo valor → ese valor;
 * - en los dos con valores distintos → `conflicts` (decide el usuario; nunca se unen textos).
 */
export function mergePetContent(
  base: PetFields,
  local: PetFields,
  remote: PetFields
): { merged: PetFields; conflicts: PetFieldGroup[] } {
  const merged = { ...remote };
  const conflicts: PetFieldGroup[] = [];
  for (const group of PET_FIELD_GROUPS) {
    const localChanged = !sameGroup(local, base, group.key);
    const remoteChanged = !sameGroup(remote, base, group.key);
    if (localChanged && remoteChanged && !sameGroup(local, remote, group.key)) conflicts.push(group.key);
    if (localChanged) for (const field of group.fields) (merged as Record<string, unknown>)[field] = local[field];
  }
  return { merged, conflicts };
}

/**
 * Contenido elegido por el usuario en un conflicto: la fusión de lo que no choca (`merged`, de
 * `mergePetContent`) y, en cada grupo en conflicto, el valor del dispositivo o el del servidor. Un grupo
 * sin elección se queda como en `merged` (quien llama exige elegir todos antes de guardar).
 */
export function chooseContent(
  merged: PetFields,
  local: PetFields,
  remote: PetFields,
  choices: Partial<Record<PetFieldGroup, 'local' | 'remote'>>
): PetFields {
  const chosen = { ...merged };
  for (const group of PET_FIELD_GROUPS) {
    const choice = choices[group.key];
    if (!choice) continue;
    const source = choice === 'local' ? local : remote;
    for (const field of group.fields) (chosen as Record<string, unknown>)[field] = source[field];
  }
  return chosen;
}

// ---------------------------------------------------------------------------------------------
// Validación al leer
// ---------------------------------------------------------------------------------------------

const SEX = ['male', 'female', 'unknown'];
const BREED_STATUS = ['known', 'mixed', 'unknown'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES: PetOperationStatus[] = ['pending', 'conflict', 'failed', 'forbidden', 'synced'];
const ERROR_KINDS = ['network', 'server', 'auth', 'permission', 'validation', 'conflict', 'unknown'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const nullable = (check: (value: unknown) => boolean) => (value: unknown) => value === null || check(value);
const isString = (value: unknown) => typeof value === 'string';
const isStringList = (value: unknown) => Array.isArray(value) && value.every((item) => typeof item === 'string');
const isTime = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

const CONTENT_FIELDS: Record<keyof PetFields, (value: unknown) => boolean> = {
  name: (value) => typeof value === 'string' && value.trim() !== '',
  species_id: isPetId,
  sex: nullable((value) => SEX.includes(value as string)),
  breed: nullable(isString),
  breed_id: nullable(isPetId),
  breed_status: nullable((value) => BREED_STATUS.includes(value as string)),
  birth_date: nullable((value) => typeof value === 'string' && ISO_DATE.test(value)),
  weight_kg: nullable((value) => typeof value === 'number' && Number.isFinite(value) && value > 0),
  sterilized: nullable((value) => typeof value === 'boolean'),
  known_conditions: nullable(isStringList),
  allergies: nullable(isStringList),
  temperament_notes: nullable(isString),
};

/** Solo las columnas editables, validadas (`null` si falta alguna o no tiene el tipo esperado). */
export function parsePetFields(value: unknown): PetFields | null {
  if (!isRecord(value)) return null;
  const content: Record<string, unknown> = {};
  for (const field of EDITABLE_FIELDS) {
    if (!(field in value) || !CONTENT_FIELDS[field](value[field])) return null;
    const item = value[field];
    content[field] = Array.isArray(item) ? [...item] : item;
  }
  return content as PetFields;
}

function parseError(value: unknown): PetOperationError | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !ERROR_KINDS.includes(value.kind as string) || typeof value.reason !== 'string' || !isTime(value.at)) {
    return undefined;
  }
  return { kind: value.kind as PetOperationError['kind'], reason: value.reason, at: value.at as number };
}

export function parseLocalPetOperation(data: unknown): LocalPetOperation | null {
  if (!isRecord(data)) return null;
  const { userId, localId, petId, kind, status, operationId } = data;
  if (!isPetId(userId) || typeof operationId !== 'string' || !UUID_V4.test(operationId)) return null;
  if (kind !== 'create' && kind !== 'update') return null;
  if (!STATUSES.includes(status as PetOperationStatus)) return null;
  const content = parsePetFields(data.content);
  if (!content) return null;

  if (kind === 'create') {
    if (localId !== localPetIdFor(operationId) || data.baseRow !== null) return null;
    if (status === 'synced' ? !isPetId(petId) : petId !== null) return null;
  } else {
    if (!isPetId(localId) || petId !== localId || status === 'synced') return null;
  }
  const baseRow = data.baseRow === null ? null : toCachedPet(data.baseRow);
  if (kind === 'update' && (!baseRow || baseRow.id !== localId)) return null;
  const conflictRemote = data.conflictRemote === null ? null : toCachedPet(data.conflictRemote);
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
    localId: localId as string,
    petId: (petId as string | null) ?? null,
    kind,
    content,
    baseRow,
    operationId,
    status: status as PetOperationStatus,
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

export const PET_OPERATIONS: LocalCollection<LocalPetOperation> = {
  name: 'pet-ops',
  version: 1,
  parse: parseLocalPetOperation,
  // Una operación solo vale bajo la clave de su usuario y su id local.
  matchesKey: (value, key) => key.id.length === 1 && value.localId === key.id[0] && value.userId === key.userId,
};

// ---------------------------------------------------------------------------------------------
// Transiciones
// ---------------------------------------------------------------------------------------------

type Clock = { now: number };

/** Alta nueva guardada en el dispositivo. */
export function createPetOperation(
  input: { userId: string; content: PetFields; operationId: string },
  { now }: Clock
): LocalPetOperation {
  return {
    userId: input.userId,
    localId: localPetIdFor(input.operationId),
    petId: null,
    kind: 'create',
    content: input.content,
    baseRow: null,
    operationId: input.operationId,
    status: 'pending',
    attempts: 0,
    nextAttemptAt: null,
    lastError: null,
    inFlightSince: null,
    conflictRemote: null,
    createdAt: now,
    editedAt: now,
    syncedAt: null,
  };
}

export type EditRejection = 'not_editable' | 'synced_create';

/**
 * Edición guardada en el dispositivo. Con una operación ya pendiente (o fallida) se consolida: mismo
 * id de operación y misma base (la versión del servidor sobre la que empezó a editarse), contenido
 * nuevo. Una operación en conflicto o sin permiso no se edita: primero se decide qué hacer con ella.
 * Devuelve `null` si el contenido ya es el de la base (nada que enviar).
 */
export function applyPetEdit(
  current: LocalPetOperation | null,
  input: { userId: string; petId: string; content: PetFields; baseRow: Pet; operationId: string },
  { now }: Clock
): LocalPetOperation | null | { rejected: EditRejection } {
  if (current && (current.status === 'conflict' || current.status === 'forbidden')) return { rejected: 'not_editable' };
  if (current?.kind === 'create') {
    if (current.status === 'synced') return { rejected: 'synced_create' };
    // Alta aún sin enviar o sin confirmar: se cambia lo que se va a crear (misma clave de alta).
    return { ...current, content: input.content, status: 'pending', attempts: 0, nextAttemptAt: null, lastError: null, editedAt: now };
  }
  const baseRow = current?.baseRow ?? input.baseRow;
  if (samePetContent(input.content, contentOf(baseRow))) return null;
  if (current) {
    return { ...current, content: input.content, status: 'pending', attempts: 0, nextAttemptAt: null, lastError: null, editedAt: now };
  }
  return {
    userId: input.userId,
    localId: input.petId,
    petId: input.petId,
    kind: 'update',
    content: input.content,
    baseRow,
    operationId: input.operationId,
    status: 'pending',
    attempts: 0,
    nextAttemptAt: null,
    lastError: null,
    inFlightSince: null,
    conflictRemote: null,
    createdAt: now,
    editedAt: now,
    syncedAt: null,
  };
}

/** Se va a enviar: si la app se cierra antes del resultado, queda «resultado incierto». */
export function markSent(op: LocalPetOperation, { now }: Clock): LocalPetOperation {
  return { ...op, inFlightSince: now };
}

/** Alta confirmada (respuesta del servidor o leída por su clave tras un 23505): mapeo `localId → petId`. */
export function applyCreateConfirmed(op: LocalPetOperation, row: Pet, { now }: Clock): LocalPetOperation {
  return { ...op, petId: row.id, status: 'synced', inFlightSince: null, lastError: null, nextAttemptAt: null, syncedAt: now };
}

/**
 * Fallo al enviar o al comprobar. Red y sesión no cuentan como intento (se espera a que vuelvan);
 * `inFlightSince` se conserva si no hubo respuesta (no se sabe si se aplicó). Sin permiso → `forbidden`;
 * datos rechazados → `failed`; fallos del servidor, con backoff hasta `MAX_SYNC_ATTEMPTS`.
 */
export function applyPetSyncFailure(
  op: LocalPetOperation,
  failure: SyncErrorInfo,
  { now, backoff }: Clock & { backoff?: BackoffOptions }
): LocalPetOperation {
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

/**
 * La edición no se aplicó (0 filas) y se leyó la fila actual. Decide sin enviar nada:
 * - `synced`: el servidor ya tiene exactamente el contenido local (respuesta perdida o mismo cambio).
 * - `forbidden`: no existe o ya no se ve; o la versión es la de la base (lo filtró RLS: sin permiso).
 * - `rebase`: cambió otra cosa; lo local se aplica sobre la versión nueva (se reenvía con esa base).
 * - `conflict`: los dos cambiaron lo mismo con valores distintos (decide el usuario).
 */
export type EditReconcile =
  | { result: 'synced'; row: Pet }
  | { result: 'forbidden'; op: LocalPetOperation }
  | { result: 'rebase'; op: LocalPetOperation }
  | { result: 'conflict'; op: LocalPetOperation };

export function reconcileEdit(op: LocalPetOperation, row: Pet | null, { now }: Clock): EditReconcile {
  const failed = (reason: string): EditReconcile => ({
    result: 'forbidden',
    op: { ...op, status: 'forbidden', inFlightSince: null, nextAttemptAt: null, lastError: { kind: 'permission', reason, at: now } },
  });
  if (!row) return failed('not_visible');
  if (samePetContent(contentOf(row), op.content)) return { result: 'synced', row };
  const base = op.baseRow!;
  const order = compareVersions(row.updated_at, base.updated_at);
  if (order === 0) return failed('not_editable');
  // Una versión del servidor anterior o no comparable: no se puede demostrar qué es lo actual.
  if (order !== 1) {
    return { result: 'conflict', op: { ...op, status: 'conflict', conflictRemote: row, inFlightSince: null, nextAttemptAt: null } };
  }
  const { merged, conflicts } = mergePetContent(contentOf(base), op.content, contentOf(row));
  if (conflicts.length > 0) {
    return { result: 'conflict', op: { ...op, status: 'conflict', conflictRemote: row, inFlightSince: null, nextAttemptAt: null } };
  }
  return {
    result: 'rebase',
    op: { ...op, content: merged, baseRow: row, status: 'pending', inFlightSince: null, nextAttemptAt: null, lastError: null },
  };
}

/**
 * Decisión del usuario sobre un conflicto, tomada viendo `shownRemote`: el contenido elegido pasa a
 * editarse sobre esa versión del servidor. Si ya coincide con ella, no hay nada que enviar (`null`).
 */
export function resolvePetConflict(op: LocalPetOperation, shownRemote: Pet, content: PetFields): LocalPetOperation | null {
  if (samePetContent(content, contentOf(shownRemote))) return null;
  return { ...op, content, baseRow: shownRemote, status: 'pending', attempts: 0, nextAttemptAt: null, lastError: null, conflictRemote: null };
}

/** Reintento pedido por el usuario: vuelve a pendiente y sin espera (un conflicto se vuelve a leer). */
export function retryPetOperation(op: LocalPetOperation): LocalPetOperation {
  if (op.status === 'synced') return op;
  if (op.status === 'conflict') return { ...op, conflictRemote: null };
  return { ...op, status: 'pending', attempts: 0, nextAttemptAt: null };
}

/** ¿Toca enviarla ya? */
export function isPetOperationDue(op: LocalPetOperation, now: number): boolean {
  if (op.status !== 'pending') return false;
  return op.nextAttemptAt === null || now >= op.nextAttemptAt || op.nextAttemptAt - now > 5 * 60_000;
}

/**
 * ¿Se puede descartar (solo en el dispositivo)? Altas sin confirmar y ediciones fallidas, en conflicto
 * o sin permiso. Una edición pendiente sin enviar también (el usuario se arrepiente). Lo que está en
 * vuelo con resultado desconocido no: podría estar ya aplicado.
 */
export function canDiscardPetOperation(op: LocalPetOperation): boolean {
  if (op.status === 'synced') return false;
  if (op.inFlightSince !== null) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------
// Cierre de sesión
// ---------------------------------------------------------------------------------------------

/**
 * Operaciones de mascotas que solo existen en el dispositivo, por tipo (para decidir al cerrar sesión).
 * `uncertain`: se enviaron y no se sabe si el servidor las aplicó. `unreadable`: guardadas pero ilegibles
 * (se conservan, no se envían): cuentan como no sincronizadas, nunca como «nada».
 */
export type PetUnsyncedSummary = {
  pendingCreate: number;
  pendingUpdate: number;
  uncertain: number;
  conflict: number;
  failed: number;
  forbidden: number;
  unreadable: number;
};

export function summarizePetOperations(ops: readonly LocalPetOperation[], unreadable = 0): PetUnsyncedSummary {
  const summary: PetUnsyncedSummary = {
    pendingCreate: 0,
    pendingUpdate: 0,
    uncertain: 0,
    conflict: 0,
    failed: 0,
    forbidden: 0,
    unreadable,
  };
  for (const op of ops) {
    if (op.status === 'synced') continue;
    if (op.status === 'pending') {
      if (op.inFlightSince !== null) summary.uncertain += 1;
      else if (op.kind === 'create') summary.pendingCreate += 1;
      else summary.pendingUpdate += 1;
    } else {
      summary[op.status] += 1;
    }
  }
  return summary;
}

export function petUnsyncedTotal(summary: PetUnsyncedSummary): number {
  return (
    summary.pendingCreate +
    summary.pendingUpdate +
    summary.uncertain +
    summary.conflict +
    summary.failed +
    summary.forbidden +
    summary.unreadable
  );
}

// ---------------------------------------------------------------------------------------------
// Presentación
// ---------------------------------------------------------------------------------------------

export type PetSyncDisplay =
  | 'pending_create'
  | 'pending_update'
  | 'syncing'
  | 'uncertain'
  | 'conflict'
  | 'failed'
  | 'forbidden';

/** Estado que se enseña (sin operación, o `synced`: «sincronizada», `null`). */
export function petSyncDisplay(op: LocalPetOperation | null | undefined, syncing: boolean): PetSyncDisplay | null {
  if (!op || op.status === 'synced') return null;
  if (syncing) return 'syncing';
  if (op.status === 'pending') {
    if (op.inFlightSince !== null) return 'uncertain';
    return op.kind === 'create' ? 'pending_create' : 'pending_update';
  }
  return op.status;
}

/**
 * La mascota tal como se ve en el dispositivo: los datos del servidor (o de la base) con el contenido
 * local encima. Un alta sin id del servidor se muestra con su `localId`; los campos que solo pone el
 * servidor (`created_at`, `updated_at`…) son los de la operación y no se envían nunca.
 */
export function petWithLocalContent(op: LocalPetOperation, server: Pet | null): Pet {
  const base: Pet =
    server ??
    op.baseRow ?? {
      id: op.localId,
      owner_id: op.userId,
      name: op.content.name,
      species_id: op.content.species_id,
      sex: null,
      breed: null,
      breed_id: null,
      breed_status: null,
      birth_date: null,
      weight_kg: null,
      sterilized: null,
      known_conditions: null,
      allergies: null,
      temperament_notes: null,
      photo_path: null,
      is_active: true,
      created_at: new Date(op.createdAt).toISOString(),
      updated_at: new Date(op.editedAt).toISOString(),
    };
  return { ...base, ...op.content };
}
