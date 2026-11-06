// Copia local, vistas y modelo de la agenda sin conexión (`npm test`). Los números son los casos del encargo de la fase 14.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { createLocalStore } from '../../../lib/local-store/local-store.ts';
import { createMemoryStorage } from '../../../lib/local-store/memory-storage.ts';
import {
  diffSchedule,
  MAX_OFFLINE_REMINDERS,
  planNotifications,
} from '../../notifications/notification-plan.ts';
import { effectiveDueAt, nextOccurrence, planCompletion } from '../reminder-model.ts';
import { createReminderCacheRepository, petScope } from './reminder-cache-repository.ts';
import {
  chooseReminderContent,
  contentOf,
  createReminderOperation,
  mergeReminderContent,
  parseLocalReminderOperation,
  reconcileEdit,
  reminderSyncDisplay,
  requestReminderDelete,
  sameReminderContent,
  summarizeReminderOperations,
  toCachedReminder,
} from './reminder-operation.ts';
import { resolveReminderDetailView, resolveReminderListView, resolveReminderPermission, unsyncedReminderItems, withLocalOperations } from './reminder-view.ts';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const PET = '33333333-3333-4333-8333-333333333333';
const noError = { status: 'pending', data: undefined, error: null };
const isOffline = (error) => error?.offline === true;

const row = (overrides = {}) => ({
  id: randomUUID(),
  pet_id: PET,
  type: 'vaccine',
  title: 'Rabia',
  description: null,
  due_at: '2026-12-01T10:00:00+00:00',
  snooze_until: null,
  recurrence_rule: null,
  status: 'pending',
  is_active: true,
  completed_at: null,
  attachment_path: null,
  created_by: USER,
  created_at: '2026-11-01T09:00:00.000001+00:00',
  updated_at: '2026-11-01T09:00:00.000001+00:00',
  ...overrides,
});
const at = (seconds) => `2026-11-01T09:00:${String(seconds).padStart(2, '0')}.000001+00:00`;

function cacheOn(disk = new Map(), userId = USER, storageOverride) {
  return createReminderCacheRepository(createLocalStore(storageOverride ?? createMemoryStorage(disk), userId));
}

const pendingCreate = (overrides = {}) =>
  createReminderOperation({ userId: USER, petId: PET, operationId: randomUUID(), content: contentOf(row({ title: 'Nuevo', ...overrides })) }, { now: 1000 });

describe('copia local de la agenda', () => {
  it('1. primera carga: lo devuelto se guarda y sobrevive a un reinicio', async () => {
    const disk = new Map();
    const cache = cacheOn(disk);
    const rows = [row(), row({ title: 'Baño' })];
    await cache.applyScope(cache.beginRead(), petScope(PET), rows, { complete: true });
    const restarted = await cacheOn(disk).readScope(petScope(PET));
    assert.equal(restarted.status, 'loaded');
    assert.deepEqual(restarted.reminders.map((item) => item.title), ['Rabia', 'Baño']);
  });

  it('3. nunca descargada no es lo mismo que vacía confirmada', async () => {
    const cache = cacheOn();
    assert.deepEqual(await cache.readScope(petScope(PET)), { status: 'never_loaded' });
    await cache.applyScope(cache.beginRead(), petScope(PET), [], { complete: true });
    const read = await cache.readScope(petScope(PET));
    assert.equal(read.status, 'loaded');
    assert.deepEqual(read.reminders, []);
    assert.equal(read.complete, true);
  });

  it('una respuesta tardía no deshace una posterior ni los datos retroceden', async () => {
    const cache = cacheOn();
    const old = row({ updated_at: at(1) });
    const fresh = { ...old, title: 'Nueva', updated_at: at(2) };
    const firstMark = cache.beginRead();
    const secondMark = cache.beginRead();
    await cache.applyScope(secondMark, petScope(PET), [fresh], { complete: true });
    const shown = await cache.applyScope(firstMark, petScope(PET), [old, row({ title: 'Borrada ya' })], { complete: true });
    assert.equal(shown.find((item) => item.id === old.id).title, 'Nueva', 'lo más nuevo gana');
    const read = await cache.readScope(petScope(PET));
    assert.deepEqual(read.reminders.map((item) => item.title), ['Nueva'], 'la lista tardía no sustituye');
  });

  it('una consulta que llega al tope no da por desaparecido lo que no vino', async () => {
    const cache = cacheOn();
    const [a, b] = [row({ title: 'A' }), row({ title: 'B' })];
    await cache.applyScope(cache.beginRead(), 'pending', [a, b], { complete: true });
    await cache.applyScope(cache.beginRead(), 'pending', [a], { complete: false });
    const partial = await cache.readScope('pending');
    assert.equal(partial.complete, false);
    assert.deepEqual(partial.reminders.map((item) => item.title).sort(), ['A', 'B']);
    await cache.applyScope(cache.beginRead(), 'pending', [a], { complete: true });
    assert.deepEqual((await cache.readScope('pending')).reminders.map((item) => item.title), ['A']);
  });

  it('una fila que sale de un alcance sigue si otro la usa; si ninguno, se olvida', async () => {
    const cache = cacheOn();
    const shared = row();
    await cache.applyScope(cache.beginRead(), 'pending', [shared], { complete: true });
    await cache.applyScope(cache.beginRead(), petScope(PET), [shared], { complete: true });
    await cache.applyScope(cache.beginRead(), 'pending', [], { complete: true });
    assert.ok(await cache.readReminder(shared.id));
    await cache.applyScope(cache.beginRead(), petScope(PET), [], { complete: true });
    assert.equal(await cache.readReminder(shared.id), null);
  });

  it('13. una lista corrupta es un error de lectura, no una lista vacía; la siguiente respuesta la sustituye', async () => {
    const disk = new Map();
    const cache = cacheOn(disk);
    await cache.applyScope(cache.beginRead(), 'pending', [row()], { complete: true });
    const key = [...disk.keys()].find((item) => item.includes('reminder-scopes'));
    disk.set(key, '{no json');
    await assert.rejects(cacheOn(disk).readScope('pending'), /invalid_data/);
    const fresh = cacheOn(disk);
    await fresh.applyScope(fresh.beginRead(), 'pending', [row({ title: 'Nueva' })], { complete: true });
    assert.equal((await cacheOn(disk).readScope('pending')).reminders[0].title, 'Nueva');
  });

  it('13. si el dispositivo no puede escribir, lo aceptado sigue en memoria y no lanza', async () => {
    const storage = createMemoryStorage(new Map());
    const failing = { ...storage, setItem: async () => Promise.reject(new Error('disk full')) };
    const cache = cacheOn(undefined, USER, failing);
    const shown = await cache.applyScope(cache.beginRead(), 'pending', [row()], { complete: true });
    assert.equal(shown.length, 1);
  });

  it('18. las copias van por usuario', async () => {
    const disk = new Map();
    const cache = cacheOn(disk, USER);
    await cache.applyScope(cache.beginRead(), 'pending', [row()], { complete: true });
    assert.deepEqual(await cacheOn(disk, OTHER).readScope('pending'), { status: 'never_loaded' });
  });

  it('no guarda URLs ni tokens: solo las columnas de la fila', () => {
    const parsed = toCachedReminder({ ...row(), signed_url: 'https://x', access_token: 'secreto' });
    assert.equal('signed_url' in parsed, false);
    assert.equal('access_token' in parsed, false);
    assert.equal(toCachedReminder({ ...row(), attachment_path: 'https://x/y.jpg' }), null);
  });

  it('el permiso guardado: `true`, `false` o desconocido', async () => {
    const disk = new Map();
    const cache = cacheOn(disk);
    assert.equal(await cache.readPermission(PET), null);
    await cache.applyPermission(PET, true);
    assert.equal(await cacheOn(disk).readPermission(PET), true);
    await cache.applyPermission(PET, false);
    assert.equal(await cacheOn(disk).readPermission(PET), false);
    assert.equal(await cacheOn(disk, OTHER).readPermission(PET), null, 'por usuario');
  });
});

describe('permiso sin conexión (decisión del 2026-11-05)', () => {
  const resolve = (remote, stored, remoteLoading = false) => resolveReminderPermission({ remote, remoteLoading, stored, storedLoading: false });

  it('`true` permite encolar, `false` lo bloquea y sin valor conocido, solo lectura', () => {
    assert.equal(resolve(undefined, true), 'editable');
    assert.equal(resolve(undefined, false), 'read_only');
    assert.equal(resolve(undefined, null), 'unknown');
  });

  it('el servidor manda sobre lo guardado', () => {
    assert.equal(resolve(false, true), 'read_only');
    assert.equal(resolve(true, false), 'editable');
  });

  it('con servidor y sin respuesta todavía, espera', () => {
    assert.equal(resolve(undefined, true, true), 'loading');
  });
});

describe('vista de la agenda', () => {
  const list = (input) =>
    resolveReminderListView({
      remote: noError,
      local: noError,
      ops: [],
      serverUsable: true,
      isOfflineError: isOffline,
      includeCreate: () => true,
      ...input,
    });

  it('2. reinicio sin conexión con copia: se ve la copia, marcada como posiblemente vieja', () => {
    const view = list({ serverUsable: false, local: { status: 'success', data: { status: 'loaded', savedAt: 'x', complete: true, reminders: [row()] }, error: null } });
    assert.equal(view.state, 'ready');
    assert.equal(view.source, 'device');
    assert.equal(view.stale, true);
  });

  it('3. sin conexión y sin copia: «no disponible», nunca «no hay recordatorios»', () => {
    assert.equal(list({ serverUsable: false, local: { status: 'success', data: { status: 'never_loaded' }, error: null } }).state, 'offline_unavailable');
  });

  it('3. un alta apuntada aquí se enseña aunque la agenda nunca se descargara, sin decir que no hay más', () => {
    const view = list({ serverUsable: false, ops: [pendingCreate()], local: { status: 'success', data: { status: 'never_loaded' }, error: null } });
    assert.equal(view.state, 'ready');
    assert.equal(view.partial, true);
    assert.equal(view.reminders.length, 1);
  });

  it('un fallo de red nunca borra la copia; otro error del servidor sí es un error', () => {
    const local = { status: 'success', data: { status: 'loaded', savedAt: 'x', complete: true, reminders: [row()] }, error: null };
    assert.equal(list({ remote: { status: 'error', data: undefined, error: { offline: true } }, local }).state, 'ready');
    assert.equal(list({ remote: { status: 'error', data: undefined, error: { code: '500' } }, local }).state, 'error');
    assert.equal(list({ remote: { status: 'error', data: undefined, error: { offline: true } }, local: { status: 'error', data: undefined, error: new Error('x') } }).state, 'local_error');
  });

  it('una lista vacía del servidor es «vacía»; con datos en memoria y sin red, siguen ahí', () => {
    const empty = list({ remote: { status: 'success', data: [], error: null } });
    assert.equal(empty.state, 'ready');
    assert.deepEqual(empty.reminders, []);
    assert.equal(empty.partial, false);
  });

  it('las operaciones van encima: edición aplicada, eliminación fuera y alta añadida', () => {
    const edited = row({ title: 'Original' });
    const deleted = row({ title: 'Se borra' });
    const update = { ...pendingCreate(), kind: 'update', localId: edited.id, reminderId: edited.id, baseRow: edited, content: contentOf({ ...edited, title: 'Editado' }) };
    const removal = { ...pendingCreate(), kind: 'delete', localId: deleted.id, reminderId: deleted.id, baseRow: deleted, restore: 'none', content: contentOf(deleted) };
    const created = pendingCreate();
    const shown = withLocalOperations([edited, deleted], [update, removal, created], () => true);
    assert.deepEqual(shown.map((item) => item.title).sort(), ['Editado', 'Nuevo']);
  });

  it('19. un alta incierta que ya viene en la lista se enseña una vez', () => {
    const op = { ...pendingCreate(), inFlightSince: 5 };
    const fromServer = row({ title: op.content.title, due_at: op.content.due_at });
    assert.equal(withLocalOperations([fromServer], [op], () => true).length, 1);
  });

  it('en «pendientes», lo marcado hecho aquí ya no sale', () => {
    const base = row();
    const done = { ...pendingCreate(), kind: 'update', localId: base.id, reminderId: base.id, baseRow: base, content: contentOf({ ...base, status: 'completed' }) };
    const view = list({ remote: { status: 'success', data: [base], error: null }, ops: [done], filter: (item) => item.status === 'pending' });
    assert.deepEqual(view.reminders, []);
  });
});

describe('vista del detalle', () => {
  const detail = (input) =>
    resolveReminderDetailView({
      id: input.id,
      remote: noError,
      local: noError,
      ops: [],
      opsError: null,
      syncingKey: null,
      serverUsable: true,
      isOfflineError: isOffline,
      ...input,
    });

  it('un id local nunca espera al servidor: alta, y al confirmarse redirige', () => {
    const op = pendingCreate();
    const ready = detail({ id: op.localId, ops: [op] });
    assert.equal(ready.state, 'ready');
    assert.equal(ready.server, null);
    assert.equal(ready.display, 'pending');
    const id = randomUUID();
    assert.deepEqual(detail({ id: op.localId, ops: [{ ...op, status: 'synced', reminderId: id, syncedAt: 1 }] }), { state: 'redirect', reminderId: id });
    assert.equal(detail({ id: op.localId, ops: [] }).state, 'not_found');
  });

  it('sin conexión: copia, «no disponible» si no hay, y lápida como «ya no está»', () => {
    const base = row();
    assert.equal(detail({ id: base.id, serverUsable: false, local: { status: 'success', data: { reminder: base }, error: null } }).state, 'ready');
    assert.equal(detail({ id: base.id, serverUsable: false, local: { status: 'success', data: null, error: null } }).state, 'offline_unavailable');
    const tomb = { ...pendingCreate(), kind: 'delete', localId: base.id, reminderId: base.id, baseRow: base, restore: 'none', content: contentOf(base), status: 'synced', syncedAt: 1 };
    assert.equal(detail({ id: base.id, ops: [tomb], remote: { status: 'success', data: base, error: null } }).state, 'not_found');
  });

  it('una edición guardada se ve encima, con su base', () => {
    const base = row();
    const op = { ...pendingCreate(), kind: 'update', localId: base.id, reminderId: base.id, baseRow: base, content: contentOf({ ...base, title: 'Editado' }) };
    const view = detail({ id: base.id, ops: [op], serverUsable: false, local: { status: 'success', data: null, error: null } });
    assert.equal(view.reminder.title, 'Editado');
    assert.equal(view.server.title, 'Rabia');
  });

  it('la lista de cambios sin sincronizar saca todo lo que no está confirmado', () => {
    const synced = { ...pendingCreate(), status: 'synced', reminderId: randomUUID(), syncedAt: 1 };
    const items = unsyncedReminderItems([pendingCreate(), synced], null);
    assert.equal(items.length, 1);
    assert.equal(items[0].display, 'pending');
  });
});

describe('modelo de operaciones', () => {
  it('fusión por grupos: fecha y estado no chocan; el mismo campo con otro valor, sí', () => {
    const base = contentOf(row());
    const local = { ...base, status: 'completed', completed_at: '2026-11-05T09:00:00.000Z' };
    const remote = { ...base, due_at: '2026-12-09T10:00:00+00:00' };
    const merged = mergeReminderContent(base, local, remote);
    assert.deepEqual(merged.conflicts, []);
    assert.equal(merged.merged.status, 'completed');
    assert.equal(merged.merged.due_at, '2026-12-09T10:00:00+00:00');
    assert.deepEqual(mergeReminderContent(base, { ...base, title: 'A' }, { ...base, title: 'B' }).conflicts, ['content']);
  });

  it('elegir en un conflicto: lo que no choca se conserva', () => {
    const base = row();
    const op = { ...pendingCreate(), baseRow: base, content: { ...contentOf(base), title: 'Mío', is_active: false } };
    const remote = { ...base, title: 'Suyo', due_at: '2026-12-09T10:00:00+00:00' };
    const mine = chooseReminderContent(op, remote, 'local');
    assert.deepEqual([mine.title, mine.is_active, mine.due_at], ['Mío', false, '2026-12-09T10:00:00+00:00']);
    const theirs = chooseReminderContent(op, remote, 'remote');
    assert.deepEqual([theirs.title, theirs.is_active], ['Suyo', false]);
  });

  it('una operación mal formada no se lee', () => {
    const op = pendingCreate();
    assert.deepEqual(parseLocalReminderOperation(JSON.parse(JSON.stringify(op))), op);
    assert.equal(parseLocalReminderOperation({ ...op, userId: 'no' }), null);
    assert.equal(parseLocalReminderOperation({ ...op, content: { ...op.content, title: ' ' } }), null);
    assert.equal(parseLocalReminderOperation({ ...op, content: { ...op.content, recurrence_rule: 'NOPE' } }), null);
    assert.equal(parseLocalReminderOperation({ ...op, localId: 'local-otro' }), null);
    assert.equal(parseLocalReminderOperation({ ...op, status: 'synced' }), null, 'sin id del servidor no hay confirmación');
  });

  it('reconcilia con una versión no comparable como conflicto, nunca a ciegas', () => {
    const base = row();
    const op = { ...pendingCreate(), kind: 'update', localId: base.id, reminderId: base.id, baseRow: base, content: { ...contentOf(base), title: 'Mío' } };
    assert.equal(reconcileEdit(op, { ...base, updated_at: 'no-es-fecha', title: 'Suyo' }, { now: 1 }).result, 'conflict');
    assert.equal(reconcileEdit(op, null, { now: 1 }).result, 'forbidden');
  });

  it('un alta incierta no se cancela al borrarla: hay que comprobarla', () => {
    const op = { ...pendingCreate(), inFlightSince: 5 };
    const request = requestReminderDelete(op, { userId: USER, localId: op.localId, baseRow: null, operationId: randomUUID() }, { now: 9 });
    assert.equal(request.result, 'saved');
    assert.equal(request.op.reminderId, null);
    assert.equal(request.op.restore, 'create');
  });

  it('el resumen y lo que se enseña', () => {
    const summary = summarizeReminderOperations([pendingCreate(), { ...pendingCreate(), inFlightSince: 3 }, { ...pendingCreate(), status: 'forbidden' }], 2);
    assert.deepEqual([summary.pendingCreate, summary.uncertain, summary.forbidden, summary.unreadable], [1, 1, 1, 2]);
    assert.equal(reminderSyncDisplay(pendingCreate(), true), 'syncing');
    assert.equal(reminderSyncDisplay({ ...pendingCreate(), status: 'synced' }, false), null);
  });
});

describe('15. avisos durante las transiciones', () => {
  const plan = (reminders, extra = {}) =>
    planNotifications({
      now: new Date('2026-11-05T12:00:00Z'),
      daily: null,
      reminders,
      reminderBody: () => '',
      visiblePetIds: new Set([PET]),
      ...extra,
    });
  const item = (id, atIso = '2026-12-01T10:00:00Z', petId = PET) => ({ id, petId, title: 'Rabia', at: new Date(atIso), petName: null });
  const applied = (desired) => desired.map((notification) => ({ id: notification.id, fingerprint: diffSchedule([], [notification]).schedule[0] && fp(notification) }));
  const fp = (notification) => [notification.date.toISOString(), notification.title, notification.body, notification.url, ''].join('|');

  it('sin conexión, el plan de la agenda no cancela los avisos diarios', () => {
    const scheduled = [{ id: 'daily-log:2026-11-06', fingerprint: 'x' }, { id: 'reminder:viejo', fingerprint: 'y' }];
    const { cancel, schedule } = diffSchedule(scheduled, plan([item('nuevo')]), '', 'reminders');
    assert.deepEqual(cancel, ['reminder:viejo'], 'el diario no se toca');
    assert.deepEqual(schedule.map((entry) => entry.id), ['reminder:nuevo']);
    assert.deepEqual(diffSchedule(scheduled, [], '').cancel.sort(), ['daily-log:2026-11-06', 'reminder:viejo'], 'con el plan completo, sí');
  });

  it('un alta local: al confirmarse se cancela su id local antes de programar el del servidor, sin duplicar', () => {
    const local = plan([item('local-abc')]);
    const after = plan([item('server-1')]);
    const { cancel, schedule } = diffSchedule(applied(local), after, '', 'reminders');
    assert.deepEqual(cancel, ['reminder:local-abc']);
    assert.deepEqual(schedule.map((entry) => entry.id), ['reminder:server-1']);
    assert.equal(after.length, 1);
  });

  it('repetir el mismo plan no cambia nada (reinicios y reconexiones)', () => {
    const desired = plan([item('a'), item('b', '2026-12-02T10:00:00Z')]);
    assert.deepEqual(diffSchedule(applied(desired), desired, '', 'reminders'), { cancel: [], schedule: [] });
  });

  it('desactivar, eliminar o una mascota que se está borrando: fuera del plan, se cancela', () => {
    const before = plan([item('a')]);
    assert.deepEqual(diffSchedule(applied(before), plan([]), '', 'reminders').cancel, ['reminder:a']);
    assert.deepEqual(plan([item('a', '2026-12-01T10:00:00Z', OTHER)]), [], 'mascota no visible');
  });

  it('sin conexión se deja sitio a los diarios ya programados', () => {
    const many = Array.from({ length: 100 }, (_, index) => item(`r${index}`, `2026-12-${String((index % 27) + 1).padStart(2, '0')}T10:00:00Z`));
    assert.equal(plan(many, { max: MAX_OFFLINE_REMINDERS }).length, MAX_OFFLINE_REMINDERS);
  });
});

describe('17. fechas, repeticiones y zona horaria', () => {
  it('el mismo instante en otra zona no es un cambio', () => {
    const base = contentOf(row({ due_at: '2026-12-01T10:00:00+00:00' }));
    assert.equal(sameReminderContent(base, { ...base, due_at: '2026-12-01T11:00:00+01:00' }), true);
    assert.equal(sameReminderContent(base, { ...base, due_at: '2026-12-01T10:00:01+00:00' }), false);
  });

  it('«Hecho» en un mensual del 31 avanza al último día y salta lo pasado', () => {
    const plan = planCompletion({ due_at: new Date(2026, 0, 31, 9, 0).toISOString(), snooze_until: null, recurrence_rule: 'FREQ=MONTHLY' }, new Date(2026, 0, 31, 12, 0));
    assert.equal(plan.kind, 'advance');
    assert.equal(plan.next.getMonth(), 1);
    assert.equal(plan.next.getDate(), new Date(2026, 2, 0).getDate());
    assert.equal(nextOccurrence(new Date(2024, 1, 29, 8), 'YEARLY').getDate(), 28);
  });

  it('el aplazamiento manda sobre la fecha prevista, en los instantes del servidor', () => {
    const snoozed = effectiveDueAt({ due_at: '2026-12-01T10:00:00+00:00', snooze_until: '2026-12-01T12:00:00.000Z' });
    assert.equal(snoozed.toISOString(), '2026-12-01T12:00:00.000Z');
  });
});
