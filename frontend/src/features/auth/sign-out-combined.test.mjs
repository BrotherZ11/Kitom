// Cierre de sesión con registros diarios Y mascotas pendientes a la vez (fase 8.5, `npm test`): el flujo
// real de la app (`createAppSignOutFlow`) con los dos motores, sus servidores falsos y un mismo disco.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { createLocalStore } from '../../lib/local-store/local-store.ts';
import { createMemoryStorage } from '../../lib/local-store/memory-storage.ts';
import { device as dailyDevice, serverWithPet, saves, USER, OTHER_USER } from '../daily-logs/offline/sync-test-helpers.mjs';
import { createPetCacheRepository } from '../pets/offline/pet-cache-repository.ts';
import { createPetOperationRepository } from '../pets/offline/pet-operation-repository.ts';
import { contentOf } from '../pets/offline/pet-operation.ts';
import { createPetSyncEngine } from '../pets/offline/pet-sync-engine.ts';
import { createFakePetServer } from '../pets/offline/fake-pet-server.mjs';
import { SPECIES } from '../pets/offline/pet-test-helpers.mjs';
import { createAppSignOutFlow } from './unsynced-changes.ts';

const petContent = (overrides = {}) => ({
  name: 'Luna',
  species_id: SPECIES,
  sex: 'female',
  breed: null,
  breed_id: null,
  breed_status: null,
  birth_date: null,
  weight_kg: null,
  sterilized: null,
  known_conditions: [],
  allergies: [],
  temperament_notes: null,
  ...overrides,
});

/** Motor de mascotas de `userId` sobre el disco compartido, arrancado con su sesión. */
function petDevice(server, { userId = USER, disk, online }) {
  const storage = createMemoryStorage(disk);
  const operations = createPetOperationRepository(createLocalStore(storage, userId));
  const cache = createPetCacheRepository(createLocalStore(storage, userId));
  const engine = createPetSyncEngine({
    operations,
    cache,
    remote: server.remoteFor(userId),
    isOnline: () => online.value,
    now: Date.now,
    createOperationId: randomUUID,
    random: () => 0,
  });
  engine.start();
  engine.setSessionUserId(userId);
  return { operations, cache, engine };
}

/**
 * La cuenta `USER` con un registro diario pendiente y una alta de mascota pendiente, sin conexión; y el
 * flujo de cierre de sesión tal como lo monta la app.
 */
async function withBothPending({ disk = new Map() } = {}) {
  const dailyServer = serverWithPet();
  const petServer = createFakePetServer({ owner: USER });
  const online = { value: false };
  const daily = dailyDevice(dailyServer, { disk, online: false });
  const pets = petDevice(petServer, { disk, online });
  dailyServer.setOnline(true);
  await daily.save({ notes: 'sin red' });
  const draft = await pets.engine.saveCreate(petContent({ name: 'Borrador' }));
  await pets.engine.idle();
  const signOuts = [];
  const flow = createAppSignOutFlow({
    dailyLogs: daily,
    pets,
    signOut: async () => {
      signOuts.push(USER);
      return { error: null };
    },
    timeoutMs: 2_000,
  });
  const goOnline = () => {
    daily.net.online = true;
    online.value = true;
  };
  return { disk, dailyServer, petServer, daily, pets, draft, flow, signOuts, online, goOnline };
}

describe('cerrar sesión con registros diarios y mascotas pendientes', () => {
  it('pedir cerrar sesión: no cierra y cuenta las dos fuentes', async () => {
    const { flow, signOuts } = await withBothPending();
    const outcome = await flow.request();
    assert.equal(outcome.status, 'needs_decision');
    assert.deepEqual(outcome.summary.dailyLogs, { pending: 1, failed: 0, conflict: 0 });
    assert.deepEqual(outcome.summary.pets, {
      pendingCreate: 1,
      pendingUpdate: 0,
      pendingDelete: 0,
      uncertain: 0,
      conflict: 0,
      failed: 0,
      forbidden: 0,
      unreadable: 0,
    });
    assert.deepEqual(signOuts, []);
  });

  it('defecto corregido: con solo mascotas pendientes (ningún registro diario) tampoco cierra sin preguntar', async () => {
    const petServer = createFakePetServer({ owner: USER });
    const disk = new Map();
    const online = { value: false };
    const daily = dailyDevice(serverWithPet(), { disk, online: false });
    const pets = petDevice(petServer, { disk, online });
    const base = petServer.insertElsewhere({ id: randomUUID(), owner_id: USER, ...petContent() });
    await pets.engine.saveEdit(base.id, { ...contentOf(base), name: 'Editada' }, base);
    const signOuts = [];
    const flow = createAppSignOutFlow({ dailyLogs: daily, pets, signOut: async () => (signOuts.push(1), { error: null }), timeoutMs: 1_000 });
    const outcome = await flow.request();
    assert.equal(outcome.status, 'needs_decision');
    assert.deepEqual(outcome.summary.dailyLogs, { pending: 0, failed: 0, conflict: 0 });
    assert.equal(outcome.summary.pets.pendingUpdate, 1);
    assert.deepEqual(signOuts, []);
  });

  it('sincronizar y cerrar (A): con conexión envía las dos y cierra solo cuando no queda nada', async () => {
    const { flow, signOuts, goOnline, dailyServer, petServer, pets, draft } = await withBothPending();
    goOnline();
    assert.deepEqual(await flow.syncAndSignOut(), { status: 'signed_out', error: null });
    assert.deepEqual(signOuts, [USER]);
    assert.equal(saves(dailyServer).length, 1);
    assert.equal(petServer.pets.size, 1);
    assert.equal((await pets.operations.read(draft.localId)).status, 'synced', 'queda solo el mapeo');
  });

  it('A sin conexión: no cierra, dice por qué y no toca nada', async () => {
    const { flow, signOuts, daily, pets } = await withBothPending();
    const outcome = await flow.syncAndSignOut();
    assert.equal(outcome.status, 'needs_decision');
    assert.equal(outcome.attempt, 'offline');
    assert.deepEqual(signOuts, []);
    assert.equal((await daily.repository.list()).length, 1);
    assert.equal((await pets.operations.list()).length, 1);
  });

  it('A con un alta de resultado incierto: no cierra (podría no estar creada)', async () => {
    const { flow, signOuts, goOnline, petServer } = await withBothPending();
    goOnline();
    petServer.loseNextResponse();
    const outcome = await flow.syncAndSignOut();
    assert.equal(outcome.status, 'needs_decision');
    assert.equal(outcome.summary.pets.uncertain, 1);
    assert.deepEqual(signOuts, []);
    // Al volver a intentarlo, se confirma sin duplicar y entonces sí cierra.
    assert.deepEqual(await flow.syncAndSignOut(), { status: 'signed_out', error: null });
    assert.equal(petServer.pets.size, 1);
  });

  it('A con un conflicto de mascota: los registros diarios se envían, la sesión no se cierra', async () => {
    const { flow, signOuts, goOnline, petServer, pets, dailyServer } = await withBothPending();
    const base = petServer.insertElsewhere({ id: randomUUID(), owner_id: USER, ...petContent({ name: 'Base' }) });
    await pets.engine.saveEdit(base.id, { ...contentOf(base), name: 'Mía' }, base);
    petServer.editElsewhere(base.id, { name: 'Suya' });
    goOnline();
    const outcome = await flow.syncAndSignOut();
    assert.equal(outcome.status, 'needs_decision');
    assert.equal(outcome.attempt, 'incomplete');
    assert.equal(outcome.summary.pets.conflict, 1);
    assert.equal(outcome.summary.dailyLogs.pending, 0);
    assert.equal(saves(dailyServer).length, 1);
    assert.deepEqual(signOuts, []);
  });

  it('conservar y cerrar (B): todo sigue en el dispositivo, aislado; otra cuenta no lo ve ni lo envía', async () => {
    const { flow, signOuts, disk, daily, pets, petServer, dailyServer, online, draft } = await withBothPending();
    assert.deepEqual(await flow.keepAndSignOut(), { status: 'signed_out', error: null });
    assert.deepEqual(signOuts, [USER]);
    // La zona autenticada se desmonta: los motores de la cuenta que sale se paran y quedan sin sesión.
    daily.engine.stop();
    daily.engine.setSessionUserId(null);
    pets.engine.stop();
    pets.engine.setSessionUserId(null);

    // Entra otra cuenta en el mismo dispositivo, con conexión.
    online.value = true;
    const other = petDevice(petServer, { userId: OTHER_USER, disk, online });
    const otherDaily = dailyDevice(dailyServer, { userId: OTHER_USER, disk, online: true });
    await other.engine.requestSync();
    await otherDaily.engine.requestSync();
    assert.deepEqual(await other.operations.list(), []);
    assert.deepEqual(await otherDaily.repository.list(), []);
    assert.equal(petServer.calls.length, 0, 'nada de A sale con la cuenta B');
    assert.equal(saves(dailyServer).length, 0);

    // Vuelve el propietario: se recupera y se envía una sola vez.
    other.engine.stop();
    const back = petDevice(petServer, { userId: USER, disk, online });
    await back.engine.requestSync();
    assert.equal((await back.operations.read(draft.localId)).status, 'synced');
    assert.equal(petServer.pets.size, 1);
    assert.equal(petServer.calls.filter((call) => call.op === 'create').length, 1);
  });

  it('cancelar (C): nada cambia; una pasada en curso ya no cierra la sesión al terminar', async () => {
    const { flow, signOuts, goOnline, petServer, pets } = await withBothPending();
    goOnline();
    const release = petServer.holdNext();
    const attempt = flow.syncAndSignOut();
    await new Promise((resolve) => setTimeout(resolve, 20));
    flow.cancel();
    release();
    assert.deepEqual(await attempt, { status: 'cancelled' });
    assert.deepEqual(signOuts, []);
    assert.equal(flow.getState(), 'idle');
    // Lo que estaba en vuelo termina de aplicarse (no se pierde ni se descarta).
    await pets.engine.idle();
    assert.equal((await pets.operations.list())[0].status, 'synced');
  });

  it('el almacén de mascotas no se puede leer: no se supone vacío (pide decisión sin resumen)', async () => {
    const disk = new Map();
    const storage = createMemoryStorage(disk);
    const failing = { ...storage, getAllKeys: async () => Promise.reject(new Error('disk')) };
    const operations = createPetOperationRepository(createLocalStore(failing, USER));
    const daily = dailyDevice(serverWithPet(), { disk, online: true });
    const signOuts = [];
    const flow = createAppSignOutFlow({
      dailyLogs: daily,
      pets: { operations, engine: { syncNow: async () => ({ status: 'completed' }) } },
      signOut: async () => (signOuts.push(1), { error: null }),
      timeoutMs: 1_000,
    });
    assert.deepEqual(await flow.request(), { status: 'needs_decision', summary: null, attempt: null });
    assert.equal((await flow.syncAndSignOut()).status, 'needs_decision');
    assert.deepEqual(signOuts, []);
  });

  it('una operación de mascota ilegible cuenta: «sincronizar y cerrar» no cierra con ella', async () => {
    const { flow, signOuts, goOnline, disk } = await withBothPending();
    disk.set(`kitom:v1:${USER}:pet-ops:local-${randomUUID()}`, '{ilegible');
    goOnline();
    const outcome = await flow.syncAndSignOut();
    assert.equal(outcome.status, 'needs_decision');
    assert.equal(outcome.summary.pets.unreadable, 1);
    assert.equal(outcome.summary.pets.pendingCreate, 0, 'lo legible sí se sincronizó');
    assert.deepEqual(signOuts, []);
  });
});
