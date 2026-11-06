import type { Reminder } from '@/features/reminders/reminder-model';

import type { LocalReminderScope } from './reminder-cache-repository.ts';
import {
  isLocalReminderId,
  operationFor,
  reminderSyncDisplay,
  reminderWithLocalContent,
  type LocalReminderOperation,
  type ReminderSyncDisplay,
} from './reminder-operation.ts';

/**
 * Lo que enseñan las pantallas de la agenda: servidor + copia del dispositivo + operaciones locales. Módulo
 * puro (`npm test`). Estados distintos a propósito (fase 14):
 * - `ready` con `source: 'device'`: copia guardada; `partial`: la consulta llegó a su tope.
 * - `offline_unavailable`: sin conexión y nunca descargada. Nunca se dice «no hay recordatorios»: solo una
 *   lista **confirmada** por el servidor puede estar vacía.
 * - `local_error`: la copia no se pudo leer. `error`: error del servidor que no es de conexión.
 * Un fallo de red nunca borra lo que hay.
 */

type RemoteQuery<T> = { status: 'pending' | 'success' | 'error'; data: T | undefined; error: unknown };
type LocalQuery<T> = { status: 'pending' | 'success' | 'error'; data: T | undefined; error: unknown };

export type ReminderListView =
  | { state: 'loading' }
  | { state: 'ready'; reminders: Reminder[]; source: 'server' | 'device'; stale: boolean; partial: boolean; savedAt: string | null }
  | { state: 'error'; error: unknown }
  | { state: 'offline_unavailable' }
  | { state: 'local_error'; error: unknown };

/** Las filas con las operaciones encima: ediciones aplicadas, eliminaciones fuera y altas añadidas. */
export function withLocalOperations(
  rows: readonly Reminder[],
  ops: readonly LocalReminderOperation[] | undefined,
  includeCreate: (op: LocalReminderOperation) => boolean
): Reminder[] {
  if (!ops || ops.length === 0) return [...rows];
  const byReminder = new Map(ops.filter((op) => op.reminderId !== null).map((op) => [op.reminderId as string, op]));
  const shown: Reminder[] = [];
  for (const row of rows) {
    const op = byReminder.get(row.id);
    if (op?.kind === 'delete') continue;
    shown.push(op?.kind === 'update' ? reminderWithLocalContent(op, row) : row);
  }
  for (const op of ops) {
    if (op.kind !== 'create' || op.status === 'synced' || !includeCreate(op)) continue;
    // Enviada sin respuesta: puede que ya exista y venga en la lista (las lecturas no traen la clave). Se enseña una vez.
    const shownAlready =
      op.inFlightSince !== null &&
      rows.some(
        (row) =>
          row.pet_id === op.petId &&
          row.title === op.content.title &&
          Date.parse(row.due_at) === Date.parse(op.content.due_at) &&
          !byReminder.has(row.id)
      );
    if (!shownAlready) shown.push(reminderWithLocalContent(op, null));
  }
  return shown;
}

export function resolveReminderListView({
  remote,
  local,
  ops,
  serverUsable,
  isOfflineError,
  includeCreate,
  filter = () => true,
}: {
  remote: RemoteQuery<Reminder[]> & { partial?: boolean };
  local: LocalQuery<LocalReminderScope>;
  ops: readonly LocalReminderOperation[] | undefined;
  serverUsable: boolean;
  isOfflineError: (error: unknown) => boolean;
  includeCreate: (op: LocalReminderOperation) => boolean;
  /** Tras aplicar lo local (p. ej. en «pendientes», uno marcado hecho aquí ya no sale). */
  filter?: (reminder: Reminder) => boolean;
}): ReminderListView {
  const overlay = (rows: readonly Reminder[]) => withLocalOperations(rows, ops, includeCreate).filter(filter);
  if (remote.data !== undefined) {
    const stale = !serverUsable || (remote.status === 'error' && isOfflineError(remote.error));
    return { state: 'ready', reminders: overlay(remote.data), source: 'server', stale, partial: remote.partial ?? false, savedAt: null };
  }
  if (remote.status === 'error' && !isOfflineError(remote.error)) return { state: 'error', error: remote.error };
  if (remote.status !== 'error' && serverUsable) return { state: 'loading' };

  if (local.status === 'error') return { state: 'local_error', error: local.error };
  if (local.status === 'pending' || local.data === undefined) return { state: 'loading' };
  if (local.data.status === 'never_loaded') {
    const created = overlay([]);
    // Lo apuntado aquí se enseña, pero sin decir que no hay nada más.
    if (created.length > 0) return { state: 'ready', reminders: created, source: 'device', stale: true, partial: true, savedAt: null };
    return { state: 'offline_unavailable' };
  }
  return {
    state: 'ready',
    reminders: overlay(local.data.reminders),
    source: 'device',
    stale: true,
    partial: !local.data.complete,
    savedAt: local.data.savedAt,
  };
}

export type ReminderDetailView =
  | { state: 'loading' }
  /** `server`: versión del servidor o de la copia sin lo local (`null` en un alta sin confirmar). */
  | { state: 'ready'; reminder: Reminder; server: Reminder | null; op: LocalReminderOperation | null; display: ReminderSyncDisplay | null; stale: boolean }
  /** Alta ya confirmada: el recordatorio está en el servidor con este id. */
  | { state: 'redirect'; reminderId: string }
  | { state: 'not_found' }
  | { state: 'error'; error: unknown }
  | { state: 'offline_unavailable' }
  | { state: 'local_error'; error: unknown };

/** Detalle de un recordatorio (también por su id local; la lápida cuenta como «ya no está»). */
export function resolveReminderDetailView({
  id,
  remote,
  local,
  ops,
  opsError,
  syncingKey,
  serverUsable,
  isOfflineError,
}: {
  id: string;
  remote: RemoteQuery<Reminder | null>;
  local: LocalQuery<{ reminder: Reminder } | null>;
  ops: readonly LocalReminderOperation[] | undefined;
  opsError: unknown;
  syncingKey: string | null;
  serverUsable: boolean;
  isOfflineError: (error: unknown) => boolean;
}): ReminderDetailView {
  const op = operationFor(ops, id);
  const display = reminderSyncDisplay(op, syncingKey !== null && syncingKey === op?.localId);

  if (isLocalReminderId(id)) {
    if (ops === undefined) return opsError ? { state: 'local_error', error: opsError } : { state: 'loading' };
    if (!op) return { state: 'not_found' };
    if (op.status === 'synced' && op.reminderId) return op.kind === 'delete' ? { state: 'not_found' } : { state: 'redirect', reminderId: op.reminderId };
    if (op.kind === 'delete' && op.reminderId !== null && op.baseRow) {
      return { state: 'ready', reminder: reminderWithLocalContent(op, op.baseRow), server: op.baseRow, op, display, stale: false };
    }
    return { state: 'ready', reminder: reminderWithLocalContent(op, null), server: null, op, display, stale: false };
  }

  if (op?.kind === 'delete' && op.status === 'synced') return { state: 'not_found' };

  const finish = (row: Reminder | null, stale: boolean): ReminderDetailView => {
    if (row && (!op || op.status === 'synced')) return { state: 'ready', reminder: row, server: row, op: null, display: null, stale };
    if (op && op.status !== 'synced') {
      const server = row ?? op.baseRow;
      return { state: 'ready', reminder: reminderWithLocalContent(op, server), server, op, display, stale };
    }
    return { state: 'not_found' };
  };

  if (remote.data !== undefined) return finish(remote.data, !serverUsable || (remote.status === 'error' && isOfflineError(remote.error)));
  if (remote.status === 'error' && !isOfflineError(remote.error)) return { state: 'error', error: remote.error };
  if (remote.status !== 'error' && serverUsable) return { state: 'loading' };
  if (op && op.status !== 'synced') return finish(local.data?.reminder ?? null, true);
  if (local.status === 'error') return { state: 'local_error', error: local.error };
  if (local.status === 'pending' || local.data === undefined) return { state: 'loading' };
  if (local.data === null) return { state: 'offline_unavailable' };
  return finish(local.data.reminder, true);
}

export type ReminderPermission = 'loading' | 'editable' | 'read_only' | 'unknown';

/**
 * ¿Se ofrecen las acciones? (decisión del 2026-11-05). Solo una indicación de interfaz: `true` permite encolar;
 * `false` lo bloquea; sin valor conocido, solo lectura. Lo decide RLS al sincronizar: si se revocó, la operación
 * queda `forbidden` y se conserva.
 */
export function resolveReminderPermission({
  remote,
  remoteLoading,
  stored,
  storedLoading,
}: {
  remote: boolean | undefined;
  /** El servidor se puede usar y todavía no ha respondido. */
  remoteLoading: boolean;
  stored: boolean | null | undefined;
  storedLoading: boolean;
}): ReminderPermission {
  if (remote !== undefined) return remote ? 'editable' : 'read_only';
  if (remoteLoading) return 'loading';
  if (storedLoading) return 'loading';
  if (stored === true) return 'editable';
  if (stored === false) return 'read_only';
  return 'unknown';
}

export type UnsyncedReminderItem = { key: string; routeId: string; title: string; petId: string; display: ReminderSyncDisplay };

/** Lista de «Cambios sin sincronizar». */
export function unsyncedReminderItems(ops: readonly LocalReminderOperation[] | undefined, syncingKey: string | null): UnsyncedReminderItem[] {
  const items: UnsyncedReminderItem[] = [];
  for (const op of ops ?? []) {
    const display = reminderSyncDisplay(op, syncingKey === op.localId);
    if (!display) continue;
    items.push({ key: op.localId, routeId: op.localId, title: op.content.title, petId: op.petId, display });
  }
  return items.sort((a, b) => (a.title < b.title ? -1 : 1));
}
