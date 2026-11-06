// Motor de la agenda sin conexión (`reminder-sync-engine.ts`, `npm test`) con un servidor falso y almacenes en memoria
// que hacen de disco (sobreviven a «reiniciar»). Los números son los casos del encargo de la fase 14.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { createLocalStore } from '../../../lib/local-store/local-store.ts';
import { createMemoryStorage } from '../../../lib/local-store/memory-storage.ts';
import { createFakeReminderServer } from './fake-reminder-server.mjs';
import { createReminderCacheRepository, petScope } from './reminder-cache-repository.ts';
import { createReminderOperationRepository } from './reminder-operation-repository.ts';
import { isLocalReminderId, reminderUnsyncedTotal, summarizeReminderOperations } from './reminder-operation.ts';
import { createReminderSyncEngine, ReminderEditRejectedError, SYNCED_RETENTION_MS } from './reminder-sync-engine.ts';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const PET = '33333333-3333-4333-8333-333333333333';
const PET_2 = '44444444-4444-4444-8444-444444444444';

const content = (overrides = {}) => ({
  type: 'vaccine',
  title: 'Rabia',
  description: null,
  due_at: '2026-12-01T10:00:00.000Z',
  recurrence_rule: null,
  snooze_until: null,
  status: 'pending',
  completed_at: null,
  is_active: true,
  ...overrides,
});

/** Una instalación: disco compartido entre «reinicios» y un motor por usuario. */
function device(server, { disk = new Map(), userId = USER_A, online = { value: true }, petState, now = { value: Date.parse('2026-11-05T12:00:00Z') } } = {}) {
  const storage = createMemoryStorage(disk);
  const store = createLocalStore(storage, userId);
  const operations = createReminderOperationRepository(store);
  const cache = createReminderCacheRepository(store);
  const engine = createReminderSyncEngine({
    operations,
    cache,
    remote: server.remoteFor(userId),
    isOnline: () => online.value,
    now: () => now.value,
    createOperationId: randomUUID,
    random: () => 0,
    petState,
  });
  engine.start();
  engine.setSessionUserId(userId);
  return { disk, operations, cache, engine, online, now, userId };
}

function setup(options = {}) {
  const server = createFakeReminderServer();
  server.addEditor(PET, USER_A);
  return { server, dev: device(server, options) };
}

const writes = (server) => server.calls.filter((call) => ['create', 'update', 'delete'].includes(call.op));

describe('agenda sin conexión: guardar y sincronizar', () => {
  it('4. crear sin conexión: queda en el dispositivo y al volver la red se crea una sola vez', async () => {
    const online = { value: false };
    const { server, dev } = setup({ online });
    const saved = await dev.engine.saveCreate(PET, content());
    await dev.engine.idle();
    assert.ok(isLocalReminderId(saved.localId));
    assert.equal(server.rows.size, 0);
    assert.equal((await dev.operations.read(saved.localId)).status, 'pending');

    online.value = true;
    await dev.engine.requestSync();
    await dev.engine.requestSync();
    assert.equal(server.rows.size, 1, 'una sola fila');
    const op = await dev.operations.read(saved.localId);
    assert.equal(op.status, 'synced');
    assert.equal(server.rowOf(op.reminderId).title, 'Rabia');
    assert.equal(writes(server).length, 1);
  });

  it('5. editar sin conexión: se envía con precondición y la copia recibe la fila', async () => {
    const online = { value: false };
    const { server, dev } = setup({ online });
    const row = server.insertElsewhere(PET, content());
    await dev.engine.saveEdit(row.id, { title: 'Rabia 2' }, row);
    await dev.engine.saveEdit(row.id, { description: 'Consolidada' }, row);
    await dev.engine.idle();
    online.value = true;
    await dev.engine.requestSync();
    const [update] = writes(server);
    assert.equal(writes(server).length, 1, 'las dos ediciones se consolidan en un envío');
    assert.equal(update.baseUpdatedAt, row.updated_at);
    assert.equal(server.rowOf(row.id).title, 'Rabia 2');
    assert.equal(server.rowOf(row.id).description, 'Consolidada');
    assert.equal(await dev.operations.read(row.id), null, 'confirmada: se borra');
    assert.equal((await dev.cache.readReminder(row.id)).reminder.title, 'Rabia 2');
  });

  it('6. activar y desactivar sin conexión: consolidado y, si vuelve a lo de la base, nada que enviar', async () => {
    const online = { value: false };
    const { server, dev } = setup({ online });
    const row = server.insertElsewhere(PET, content());
    await dev.engine.saveEdit(row.id, { is_active: false }, row);
    assert.equal((await dev.operations.read(row.id)).content.is_active, false);
    await dev.engine.saveEdit(row.id, { is_active: true }, row);
    assert.equal(await dev.operations.read(row.id), null, 'volvió a la base');

    await dev.engine.saveEdit(row.id, { is_active: false }, row);
    online.value = true;
    await dev.engine.requestSync();
    assert.equal(server.rowOf(row.id).is_active, false);
    assert.equal(writes(server).length, 1);
  });

  it('7. eliminar sin conexión: se puede deshacer; confirmada, queda la lápida y sale de la copia', async () => {
    const online = { value: false };
    const { server, dev } = setup({ online });
    const row = server.insertElsewhere(PET, content());
    await dev.cache.applyReminder(dev.cache.beginRead(), row.id, row);

    assert.equal((await dev.engine.requestDelete(row.id, row)).result, 'saved');
    assert.equal(await dev.engine.undoDelete(row.id), 'restored');
    assert.equal(await dev.operations.read(row.id), null);

    await dev.engine.requestDelete(row.id, row);
    online.value = true;
    await dev.engine.requestSync();
    assert.equal(server.rowOf(row.id), null);
    assert.equal((await dev.operations.read(row.id)).status, 'synced');
    assert.equal(await dev.cache.readReminder(row.id), null);
    assert.equal(await dev.engine.undoDelete(row.id), 'confirmed');
  });

  it('eliminar un alta que nunca salió la quita sin enviar nada', async () => {
    const online = { value: false };
    const { server, dev } = setup({ online });
    const saved = await dev.engine.saveCreate(PET, content());
    assert.equal((await dev.engine.requestDelete(saved.localId, null)).result, 'cancelled');
    assert.equal(await dev.operations.read(saved.localId), null);
    online.value = true;
    await dev.engine.requestSync();
    assert.equal(writes(server).length, 0);
  });

  it('8. respuesta perdida tras crear: el reenvío da 23505, se lee por su clave y no se duplica', async () => {
    const { server, dev } = setup();
    server.loseNextResponse();
    const saved = await dev.engine.saveCreate(PET, content());
    await dev.engine.idle();
    let op = await dev.operations.read(saved.localId);
    assert.equal(op.status, 'pending');
    assert.notEqual(op.inFlightSince, null, 'resultado incierto');
    assert.equal(server.rows.size, 1, 'el servidor sí la creó');

    dev.now.value += 10 * 60_000;
    await dev.engine.requestSync();
    op = await dev.operations.read(saved.localId);
    assert.equal(op.status, 'synced');
    assert.equal(server.rows.size, 1, 'no se duplica');
    assert.ok(server.calls.some((call) => call.op === 'findByRequestId'));
  });

  it('14. reinicio con una operación incierta: otra instancia la reenvía sin duplicar y no se puede descartar', async () => {
    const { server, dev } = setup();
    server.loseNextResponse();
    const saved = await dev.engine.saveCreate(PET, content());
    await dev.engine.idle();

    dev.engine.stop();
    // Al reiniciar ya pasó la espera del reintento (la respuesta perdida cuenta como un corte de red).
    const restarted = device(server, { disk: dev.disk, now: { value: dev.now.value + 10 * 60_000 } });
    assert.equal(await restarted.engine.discard(saved.localId), 'not_discardable');
    assert.equal(summarizeReminderOperations(await restarted.operations.list()).uncertain, 1);
    await restarted.engine.requestSync();
    assert.equal((await restarted.operations.read(saved.localId)).status, 'synced');
    assert.equal(server.rows.size, 1);
  });

  it('edición con la respuesta perdida: el mismo contenido en el servidor es «confirmada»', async () => {
    const { server, dev } = setup();
    const row = server.insertElsewhere(PET, content());
    server.loseNextResponse();
    await dev.engine.saveEdit(row.id, { title: 'Nueva' }, row);
    await dev.engine.idle();
    dev.now.value += 10 * 60_000;
    await dev.engine.requestSync();
    assert.equal(await dev.operations.read(row.id), null);
    assert.equal(server.rowOf(row.id).title, 'Nueva');
  });

  it('editar un alta en vuelo: lo nuevo se envía después como edición', async () => {
    const { server, dev } = setup();
    const release = server.holdNext();
    const saved = await dev.engine.saveCreate(PET, content());
    await new Promise((resolve) => setImmediate(resolve));
    await dev.engine.saveEdit(saved.localId, { title: 'Cambiada en vuelo' }, null);
    release();
    await dev.engine.idle();
    await dev.engine.requestSync();
    const op = await dev.operations.read(saved.localId);
    assert.equal(op.status, 'synced');
    assert.equal(server.rowOf(op.reminderId).title, 'Cambiada en vuelo');
    assert.equal(server.rows.size, 1);
  });

  it('un 401 para el envío hasta que la sesión cambia, y no cuenta como intento', async () => {
    const { server, dev } = setup();
    const remote = server.remoteFor(USER_A);
    const realCreate = remote.create;
    let calls = 0;
    const engine = createReminderSyncEngine({
      operations: dev.operations,
      cache: dev.cache,
      remote: { ...remote, create: (...args) => (calls++ === 0 ? { ok: false, error: { code: 'PGRST301' }, status: 401 } : realCreate(...args)) },
      isOnline: () => true,
      now: () => dev.now.value,
      createOperationId: randomUUID,
    });
    engine.start();
    engine.setSessionUserId(USER_A);
    const saved = await engine.saveCreate(PET, content());
    await engine.idle();
    let op = await dev.operations.read(saved.localId);
    assert.equal(op.attempts, 0);
    assert.equal(op.status, 'pending');
    await engine.requestSync();
    assert.equal(calls, 1, 'no se reenvía con la misma sesión');
    engine.setSessionUserId(USER_A);
    await engine.requestSync();
    op = await dev.operations.read(saved.localId);
    assert.equal(op.status, 'synced');
  });

  it('datos rechazados (23514): pasa a fallido, sin perder nada, y se reintenta a mano', async () => {
    const { server, dev } = setup();
    const remote = server.remoteFor(USER_A);
    const realCreate = remote.create;
    let rejecting = true;
    const engine = createReminderSyncEngine({
      operations: dev.operations,
      cache: dev.cache,
      remote: { ...remote, create: (...args) => (rejecting ? { ok: false, error: { code: '23514' }, status: 400 } : realCreate(...args)) },
      isOnline: () => true,
      now: () => dev.now.value,
      createOperationId: randomUUID,
    });
    engine.start();
    engine.setSessionUserId(USER_A);
    const saved = await engine.saveCreate(PET, content());
    await engine.idle();
    assert.equal((await dev.operations.read(saved.localId)).status, 'failed');
    rejecting = false;
    await engine.retry(saved.localId);
    assert.equal((await dev.operations.read(saved.localId)).status, 'synced');
  });
});

describe('agenda sin conexión: conflictos', () => {
  it('9. dos sesiones cambian lo mismo: conflicto, sin pisar; decidir con lo mío lo envía', async () => {
    const online = { value: false };
    const { server, dev } = setup({ online });
    const row = server.insertElsewhere(PET, content());
    await dev.engine.saveEdit(row.id, { title: 'Mío' }, row);
    server.editElsewhere(row.id, { title: 'Suyo' });
    online.value = true;
    await dev.engine.requestSync();
    const op = await dev.operations.read(row.id);
    assert.equal(op.status, 'conflict');
    assert.equal(op.conflictRemote.title, 'Suyo');
    assert.equal(server.rowOf(row.id).title, 'Suyo', 'nada se sobrescribe sin decidirlo');
    assert.equal((await dev.engine.saveEdit(row.id, { title: 'Otro' }, row).catch((error) => error)) instanceof ReminderEditRejectedError, true);

    assert.equal(await dev.engine.resolveConflict(row.id, { choice: 'local', shownRemote: op.conflictRemote }), 'synced');
    assert.equal(server.rowOf(row.id).title, 'Mío');
  });

  it('conflicto: decidir con lo del servidor no envía nada', async () => {
    const online = { value: false };
    const { server, dev } = setup({ online });
    const row = server.insertElsewhere(PET, content());
    await dev.engine.saveEdit(row.id, { title: 'Mío' }, row);
    server.editElsewhere(row.id, { title: 'Suyo' });
    online.value = true;
    await dev.engine.requestSync();
    const op = await dev.operations.read(row.id);
    const before = writes(server).length;
    assert.equal(await dev.engine.resolveConflict(row.id, { choice: 'remote', shownRemote: op.conflictRemote }), 'synced');
    assert.equal(writes(server).length, before);
    assert.equal(server.rowOf(row.id).title, 'Suyo');
  });

  it('si cambió otra cosa no hay conflicto: se aplica sobre la versión nueva y se conservan los dos cambios', async () => {
    const online = { value: false };
    const { server, dev } = setup({ online });
    const row = server.insertElsewhere(PET, content());
    await dev.engine.saveEdit(row.id, { is_active: false }, row);
    server.editElsewhere(row.id, { title: 'Otro título' });
    online.value = true;
    await dev.engine.requestSync();
    assert.equal(await dev.operations.read(row.id), null);
    assert.equal(server.rowOf(row.id).title, 'Otro título');
    assert.equal(server.rowOf(row.id).is_active, false);
  });

  it('«Hecho» en un lado y fecha en el otro son grupos distintos: se fusionan', async () => {
    const online = { value: false };
    const { server, dev } = setup({ online });
    const row = server.insertElsewhere(PET, content());
    await dev.engine.saveEdit(row.id, { status: 'completed', completed_at: '2026-11-05T09:00:00.000Z' }, row);
    server.editElsewhere(row.id, { due_at: '2026-12-02T10:00:00+00:00' });
    online.value = true;
    await dev.engine.requestSync();
    const final = server.rowOf(row.id);
    assert.equal(final.status, 'completed');
    assert.equal(final.completed_at, '2026-11-05T09:00:00.000Z', 'conserva la hora real');
    assert.equal(final.due_at, '2026-12-02T10:00:00+00:00');
  });

  it('el mismo instante con otro formato no es un conflicto ni un cambio', async () => {
    const online = { value: false };
    const { server, dev } = setup({ online });
    const row = server.insertElsewhere(PET, content({ due_at: '2026-12-01T10:00:00+00:00' }));
    assert.equal(await dev.engine.saveEdit(row.id, { due_at: '2026-12-01T10:00:00.000Z' }, row), null);
    assert.equal(await dev.operations.read(row.id), null);
  });

  it('eliminar algo que cambió en otro sitio: conflicto; nunca se borra lo que no se vio', async () => {
    const online = { value: false };
    const { server, dev } = setup({ online });
    const row = server.insertElsewhere(PET, content());
    await dev.engine.requestDelete(row.id, row);
    server.editElsewhere(row.id, { title: 'Cambiado' });
    online.value = true;
    await dev.engine.requestSync();
    assert.ok(server.rowOf(row.id), 'no se borra');
    const op = await dev.operations.read(row.id);
    assert.equal(op.status, 'conflict');
    assert.equal(await dev.engine.resolveDeleteConflict(row.id, { decision: 'delete', shownRemote: op.conflictRemote }), 'synced');
    assert.equal(server.rowOf(row.id), null);
  });

  it('eliminar algo que ya no está: se cierra sin error', async () => {
    const online = { value: false };
    const { server, dev } = setup({ online });
    const row = server.insertElsewhere(PET, content());
    await dev.engine.requestDelete(row.id, row);
    server.deleteElsewhere(row.id);
    online.value = true;
    await dev.engine.requestSync();
    assert.equal(await dev.operations.read(row.id), null);
  });
});

describe('agenda sin conexión: permisos', () => {
  it('10. alta con el permiso revocado: RLS la rechaza, queda `forbidden`, se conserva y no se reintenta sola', async () => {
    const online = { value: false };
    const { server, dev } = setup({ online });
    const saved = await dev.engine.saveCreate(PET, content());
    server.demote(PET, USER_A);
    online.value = true;
    await dev.engine.requestSync();
    let op = await dev.operations.read(saved.localId);
    assert.equal(op.status, 'forbidden');
    assert.equal(op.content.title, 'Rabia', 'no se pierde');
    assert.equal(server.rows.size, 0);
    const sends = writes(server).length;
    await dev.engine.requestSync();
    assert.equal(writes(server).length, sends);
    op = await dev.operations.read(saved.localId);
    assert.equal(op.status, 'forbidden');
    assert.equal(await dev.engine.discard(saved.localId), 'discarded', 'solo se descarta si lo pide el usuario');
  });

  it('10. edición con el permiso revocado (misma versión): `forbidden`, datos intactos', async () => {
    const online = { value: false };
    const { server, dev } = setup({ online });
    const row = server.insertElsewhere(PET, content());
    await dev.engine.saveEdit(row.id, { title: 'Sin permiso' }, row);
    server.demote(PET, USER_A);
    online.value = true;
    await dev.engine.requestSync();
    const op = await dev.operations.read(row.id);
    assert.equal(op.status, 'forbidden');
    assert.equal(op.content.title, 'Sin permiso');
    assert.equal(server.rowOf(row.id).title, 'Rabia');
  });

  it('10. permiso revocado y otra versión: se pregunta `can_edit_pet` y no se pide resolver un conflicto', async () => {
    const online = { value: false };
    const { server, dev } = setup({ online });
    const row = server.insertElsewhere(PET, content());
    await dev.engine.saveEdit(row.id, { title: 'Mío' }, row);
    server.editElsewhere(row.id, { title: 'Suyo' });
    server.demote(PET, USER_A);
    online.value = true;
    await dev.engine.requestSync();
    assert.equal((await dev.operations.read(row.id)).status, 'forbidden');
    assert.ok(server.calls.some((call) => call.op === 'canEdit'));
  });

  it('10. expulsado: la fila ya no se ve, `forbidden`', async () => {
    const online = { value: false };
    const { server, dev } = setup({ online });
    const row = server.insertElsewhere(PET, content());
    await dev.engine.saveEdit(row.id, { title: 'Mío' }, row);
    server.remove(PET, USER_A);
    online.value = true;
    await dev.engine.requestSync();
    assert.equal((await dev.operations.read(row.id)).status, 'forbidden');
  });

  it('alta perdida y expulsado antes del reenvío: no duplica ni la da por creada', async () => {
    const { server, dev } = setup();
    server.loseNextResponse();
    const saved = await dev.engine.saveCreate(PET, content());
    await dev.engine.idle();
    server.remove(PET, USER_A);
    dev.now.value += 10 * 60_000;
    await dev.engine.requestSync();
    assert.equal((await dev.operations.read(saved.localId)).status, 'forbidden');
    assert.equal(server.rows.size, 1);
  });
});

describe('agenda sin conexión: mascotas', () => {
  it('16. mascota con eliminación pendiente: sus operaciones se retienen; al deshacerla siguen', async () => {
    const state = { value: 'held' };
    const { server, dev } = setup({ petState: async () => state.value });
    const saved = await dev.engine.saveCreate(PET, content());
    await dev.engine.idle();
    assert.equal(writes(server).length, 0, 'no se envía');
    assert.equal((await dev.operations.read(saved.localId)).status, 'pending');
    state.value = 'normal';
    await dev.engine.requestSync();
    assert.equal(server.rows.size, 1);
  });

  it('16. mascota con la eliminación confirmada: sus operaciones se cierran sin enviar', async () => {
    const { server, dev } = setup({ petState: async () => 'deleted' });
    const row = server.insertElsewhere(PET, content());
    await dev.cache.applyReminder(dev.cache.beginRead(), row.id, row);
    await dev.engine.saveEdit(row.id, { title: 'Da igual' }, row);
    await dev.engine.idle();
    assert.equal(await dev.operations.read(row.id), null);
    assert.equal(writes(server).length, 0);
    assert.equal(await dev.cache.readReminder(row.id), null);
  });
});

describe('agenda sin conexión: aislamiento y concurrencia', () => {
  it('11 y 18. cuentas distintas: cada una ve y envía lo suyo, con su sesión', async () => {
    const disk = new Map();
    const server = createFakeReminderServer();
    server.addEditor(PET, USER_A);
    server.addEditor(PET_2, USER_B);
    const a = device(server, { disk, userId: USER_A });
    const onlineB = { value: false };
    const b = device(server, { disk, userId: USER_B, online: onlineB });
    await b.engine.saveCreate(PET_2, content({ title: 'De B' }));
    a.engine.setSessionUserId(null);
    await a.engine.saveCreate(PET, content({ title: 'De A' }));
    await a.engine.idle();
    assert.equal(server.rows.size, 0, 'A sin sesión no envía');
    assert.equal((await a.operations.list()).length, 1);
    assert.equal((await b.operations.list()).length, 1);
    assert.equal((await b.operations.list())[0].content.title, 'De B');

    a.engine.setSessionUserId(USER_B);
    await a.engine.requestSync();
    assert.equal(server.rows.size, 0, 'la operación de A nunca sale con la sesión de B');

    a.engine.setSessionUserId(USER_A);
    await a.engine.requestSync();
    onlineB.value = true;
    await b.engine.requestSync();
    const creators = [...server.rows.values()].map((row) => [row.title, row.created_by]).sort();
    assert.deepEqual(creators, [['De A', USER_A], ['De B', USER_B]]);
  });

  it('18. la misma clave de operación bajo otro usuario no se lee (matchesKey)', async () => {
    const { dev } = setup();
    const saved = await dev.engine.saveCreate(PET, content());
    const other = createReminderOperationRepository(createLocalStore(createMemoryStorage(dev.disk), USER_B));
    assert.equal(await other.read(saved.localId), null);
    assert.deepEqual(await other.list(), []);
  });

  it('19. sincronización simultánea y dos motores sobre el mismo disco: una sola fila', async () => {
    const { server, dev } = setup();
    const release = server.holdNext();
    const saved = await dev.engine.saveCreate(PET, content());
    const second = device(server, { disk: dev.disk });
    const runs = [dev.engine.requestSync(), dev.engine.requestSync(), second.engine.requestSync()];
    await new Promise((resolve) => setImmediate(resolve));
    release();
    await Promise.all(runs);
    await dev.engine.requestSync();
    await second.engine.requestSync();
    assert.equal(server.rows.size, 1, 'el segundo envío da 23505 y se resuelve por la clave');
    assert.equal((await dev.operations.read(saved.localId)).status, 'synced');
  });

  it('20. volver la conexión: una petición nueva lo envía; sin red, no sale nada', async () => {
    const online = { value: false };
    const { server, dev } = setup({ online });
    await dev.engine.saveCreate(PET, content());
    await dev.engine.requestSync();
    assert.equal(server.calls.length, 0);
    online.value = true;
    await dev.engine.requestSync();
    assert.equal(server.rows.size, 1);
  });
});

describe('agenda sin conexión: almacenamiento y cierre de sesión', () => {
  it('13. fallo de escritura al guardar: lanza y no se da por guardado', async () => {
    const server = createFakeReminderServer();
    const disk = new Map();
    const storage = createMemoryStorage(disk);
    const failing = { ...storage, setItem: async () => Promise.reject(new Error('disk full')) };
    const operations = createReminderOperationRepository(createLocalStore(failing, USER_A));
    const engine = createReminderSyncEngine({
      operations,
      cache: createReminderCacheRepository(createLocalStore(failing, USER_A)),
      remote: server.remoteFor(USER_A),
      isOnline: () => true,
      now: Date.now,
      createOperationId: randomUUID,
    });
    await assert.rejects(engine.saveCreate(PET, content()), /storage_failed/);
    assert.equal(disk.size, 0);
  });

  it('13. una operación ilegible no se pierde, no se envía y cuenta como no sincronizada', async () => {
    const { server, dev } = setup();
    const key = `kitom:v1:${USER_A}:reminder-ops:${'a'.repeat(8)}-aaaa-4aaa-8aaa-${'a'.repeat(12)}`;
    dev.disk.set(key, '{"v":1,"data":{"roto":true}}');
    assert.deepEqual(await dev.operations.list(), []);
    assert.equal(await dev.operations.unreadableCount(), 1);
    await dev.engine.requestSync();
    assert.equal(server.calls.length, 0);
    assert.equal(dev.disk.has(key), true, 'se conserva');
    assert.equal(reminderUnsyncedTotal(summarizeReminderOperations([], 1)), 1);
  });

  it('13. leer el almacén falla durante una pasada: se abandona sin perder nada', async () => {
    const server = createFakeReminderServer();
    server.addEditor(PET, USER_A);
    const disk = new Map();
    const storage = createMemoryStorage(disk);
    let failing = false;
    const flaky = { ...storage, getAllKeys: async () => (failing ? Promise.reject(new Error('disk')) : storage.getAllKeys()) };
    const operations = createReminderOperationRepository(createLocalStore(flaky, USER_A));
    const engine = createReminderSyncEngine({
      operations,
      cache: createReminderCacheRepository(createLocalStore(flaky, USER_A)),
      remote: server.remoteFor(USER_A),
      isOnline: () => true,
      now: Date.now,
      createOperationId: randomUUID,
    });
    const online = { value: false };
    void online;
    failing = true;
    engine.start();
    engine.setSessionUserId(USER_A);
    await engine.requestSync();
    failing = false;
    await engine.saveCreate(PET, content());
    await engine.idle();
    assert.equal(server.rows.size, 1);
  });

  it('12. syncNow reintenta lo fallido, no lo `forbidden`, y sin conexión no hace nada', async () => {
    const online = { value: false };
    const { server, dev } = setup({ online });
    await dev.engine.saveCreate(PET, content());
    assert.deepEqual(await dev.engine.syncNow({ timeoutMs: 500 }), { status: 'unavailable', reason: 'offline' });
    online.value = true;
    assert.deepEqual(await dev.engine.syncNow({ timeoutMs: 500 }), { status: 'completed' });
    assert.equal(server.rows.size, 1);
    assert.equal(reminderUnsyncedTotal(summarizeReminderOperations(await dev.operations.list())), 0);
  });

  it('los mapeos y lápidas antiguos se olvidan; los recientes y lo pendiente, no', async () => {
    const { server, dev } = setup();
    const saved = await dev.engine.saveCreate(PET, content());
    await dev.engine.idle();
    await dev.engine.requestSync();
    assert.equal((await dev.operations.read(saved.localId)).status, 'synced');
    dev.now.value += SYNCED_RETENTION_MS + 1;
    await dev.engine.requestSync();
    assert.equal(await dev.operations.read(saved.localId), null);
    assert.equal(server.rows.size, 1);
  });
});

describe('agenda: permiso guardado y copia en la sincronización', () => {
  it('lo confirmado entra en las listas guardadas; lo hecho sale de `pending`', async () => {
    const { server, dev } = setup();
    await dev.cache.applyScope(dev.cache.beginRead(), 'pending', [], { complete: true });
    await dev.cache.applyScope(dev.cache.beginRead(), petScope(PET), [], { complete: true });
    const saved = await dev.engine.saveCreate(PET, content());
    await dev.engine.idle();
    const id = (await dev.operations.read(saved.localId)).reminderId;
    assert.deepEqual((await dev.cache.readScope('pending')).reminders.map((row) => row.id), [id]);
    assert.deepEqual((await dev.cache.readScope(petScope(PET))).reminders.map((row) => row.id), [id]);

    await dev.engine.saveEdit(id, { status: 'completed', completed_at: '2026-11-05T09:00:00.000Z' }, server.rowOf(id));
    await dev.engine.idle();
    assert.deepEqual((await dev.cache.readScope('pending')).reminders, []);
    assert.equal((await dev.cache.readScope(petScope(PET))).reminders[0].status, 'completed');
  });
});
