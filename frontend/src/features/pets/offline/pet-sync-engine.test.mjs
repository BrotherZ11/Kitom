// Pruebas del motor de altas y ediciones de mascotas (`pet-sync-engine.ts`, `npm test`) con un servidor
// falso (`fake-pet-server.mjs`) y almacenes en memoria que hacen de disco (sobreviven a «reiniciar»).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { createLocalStore } from '../../../lib/local-store/local-store.ts';
import { createMemoryStorage } from '../../../lib/local-store/memory-storage.ts';
import { editableColumns } from '../api/pet-writes-remote.ts';
import { createPetCacheRepository } from './pet-cache-repository.ts';
import { createPetOperationRepository } from './pet-operation-repository.ts';
import { contentOf, isLocalPetId } from './pet-operation.ts';
import { isPetId } from './pet-snapshot.ts';
import { createPetSyncEngine } from './pet-sync-engine.ts';
import { createFakePetServer } from './fake-pet-server.mjs';
import { SPECIES, USER_A, USER_B } from './pet-test-helpers.mjs';

const content = (overrides = {}) => ({
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

/** Un dispositivo: disco compartido, almacenes y motor por usuario (como el proveedor). */
function device({ disk = new Map(), server, online = { value: true } } = {}) {
  const make = (userId, remote) => {
    const storage = createMemoryStorage(disk);
    const operations = createPetOperationRepository(createLocalStore(storage, userId));
    const cache = createPetCacheRepository(createLocalStore(storage, userId));
    const engine = createPetSyncEngine({
      operations,
      cache,
      remote: remote ?? server.remoteFor(userId),
      isOnline: () => online.value,
      now: Date.now,
      createOperationId: randomUUID,
      random: () => 0,
    });
    return { operations, cache, engine };
  };
  return { disk, online, make };
}

/** Sesión activa del usuario: arranca el motor y le da la sesión. */
function signIn(session, userId) {
  session.engine.start();
  session.engine.setSessionUserId(userId);
  return session;
}

describe('altas sin conexión', () => {
  it('1. se guarda en el dispositivo con un id local (no un UUID del servidor) y no envía nada', async () => {
    const server = createFakePetServer({ owner: USER_A });
    const { make, online } = device({ server });
    online.value = false;
    const a = signIn(make(USER_A), USER_A);
    const op = await a.engine.saveCreate(content());
    await a.engine.idle();

    assert.equal(isLocalPetId(op.localId), true);
    assert.equal(isPetId(op.localId), false);
    assert.equal(op.petId, null);
    assert.equal(op.status, 'pending');
    assert.deepEqual((await a.operations.list()).map((item) => item.localId), [op.localId]);
    assert.equal(server.calls.length, 0);
  });

  it('2. reiniciar la app: el borrador sigue en el dispositivo', async () => {
    const server = createFakePetServer({ owner: USER_A });
    const { make, online, disk } = device({ server });
    online.value = false;
    const first = signIn(make(USER_A), USER_A);
    const op = await first.engine.saveCreate(content({ name: 'Kira' }));
    first.engine.stop();

    const restarted = device({ disk, server, online }).make(USER_A);
    const [recovered] = await restarted.operations.list();
    assert.equal(recovered.localId, op.localId);
    assert.equal(recovered.content.name, 'Kira');
  });

  it('3. cambio de cuenta: el borrador de A no se ve ni se envía desde B', async () => {
    const server = createFakePetServer({ owner: USER_A });
    const { make, online } = device({ server });
    online.value = false;
    const a = signIn(make(USER_A), USER_A);
    await a.engine.saveCreate(content());
    a.engine.stop();
    a.engine.setSessionUserId(null);

    online.value = true;
    const b = signIn(make(USER_B), USER_B);
    await b.engine.requestSync();
    assert.deepEqual(await b.operations.list(), []);
    assert.equal(server.calls.length, 0, 'B no envía el alta de A');
    assert.equal((await a.operations.list()).length, 1, 'el borrador de A sigue en su almacén');
  });

  it('4. al sincronizar: id del servidor, mapeo persistente local → remoto y copia de la mascota', async () => {
    const server = createFakePetServer({ owner: USER_A });
    const { make } = device({ server });
    const a = make(USER_A);
    a.engine.start();
    const op = await a.engine.saveCreate(content());
    a.engine.setSessionUserId(USER_A);
    await a.engine.requestSync();

    const mapped = await a.operations.read(op.localId);
    assert.equal(mapped.status, 'synced');
    assert.equal(isPetId(mapped.petId), true);
    assert.equal(server.pets.size, 1);
    assert.equal(server.pets.get(mapped.petId).client_request_id, op.operationId);
    assert.equal((await a.cache.readPet(mapped.petId)).pet.name, 'Luna');
  });

  it('5. respuesta perdida tras una alta confirmada: el reenvío no duplica (23505 → se lee por la clave)', async () => {
    const server = createFakePetServer({ owner: USER_A });
    const { make } = device({ server });
    const a = signIn(make(USER_A), USER_A);
    server.loseNextResponse();
    const op = await a.engine.saveCreate(content());
    await a.engine.idle();

    const uncertain = await a.operations.read(op.localId);
    assert.equal(uncertain.status, 'pending');
    assert.notEqual(uncertain.inFlightSince, null, 'resultado incierto');
    assert.equal(server.pets.size, 1, 'el servidor sí la creó');

    await a.engine.retry(op.localId);
    assert.equal(server.pets.size, 1, 'no hay segunda mascota');
    assert.deepEqual(
      server.calls.map((call) => call.op),
      ['create', 'create', 'findByRequestId']
    );
    const mapped = await a.operations.read(op.localId);
    assert.equal(mapped.status, 'synced');
    assert.equal(mapped.petId, [...server.pets.keys()][0]);
  });

  it('editar el borrador mientras se envía: el alta se confirma y lo nuevo queda como edición', async () => {
    const server = createFakePetServer({ owner: USER_A });
    const { make } = device({ server });
    const a = signIn(make(USER_A), USER_A);
    const release = server.holdNext();
    const op = await a.engine.saveCreate(content({ name: 'Primera' }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    await a.engine.saveEdit(op.localId, content({ name: 'Segunda' }), null);
    release();
    await a.engine.idle();
    await a.engine.requestSync();

    const mapped = await a.operations.read(op.localId);
    assert.equal(mapped.status, 'synced');
    assert.equal(server.pets.get(mapped.petId).name, 'Segunda');
    assert.equal(server.pets.size, 1);
  });
});

describe('ediciones sin conexión', () => {
  async function withPet(overrides) {
    const server = createFakePetServer({ owner: USER_A });
    const base = server.insertElsewhere({ id: randomUUID(), owner_id: USER_A, ...content(), ...overrides });
    const dev = device({ server });
    const a = signIn(dev.make(USER_A), USER_A);
    return { server, dev, a, base };
  }

  it('6. varias ediciones sin conexión se consolidan en una operación con la base original', async () => {
    const { server, dev, a, base } = await withPet();
    dev.online.value = false;
    await a.engine.saveEdit(base.id, content({ name: 'Luna 1' }), base);
    await a.engine.saveEdit(base.id, content({ name: 'Luna 2', weight_kg: 4.5 }), base);
    const ops = await a.operations.list();
    assert.equal(ops.length, 1);
    assert.equal(ops[0].content.name, 'Luna 2');
    assert.equal(ops[0].baseRow.updated_at, base.updated_at);
    assert.equal(server.calls.length, 0);

    dev.online.value = true;
    await a.engine.requestSync();
    assert.deepEqual(await a.operations.list(), []);
    assert.equal(server.rowOf(base.id).name, 'Luna 2');
    assert.equal(server.calls.filter((call) => call.op === 'update').length, 1);
    assert.equal((await a.cache.readPet(base.id)).pet.name, 'Luna 2');
  });

  it('no se envía nada fuera de las columnas editables (ni owner_id, ni fotos)', async () => {
    const { server, a, base } = await withPet();
    await a.engine.saveEdit(base.id, { ...content({ name: 'X' }), owner_id: USER_B, photo_path: 'x/y.jpg' }, base);
    await a.engine.idle();
    const update = server.calls.find((call) => call.op === 'update');
    assert.deepEqual(Object.keys(update.payload).sort(), Object.keys(editableColumns(content())).sort());
    assert.equal(server.rowOf(base.id).owner_id, USER_A);
    assert.equal((await a.operations.list()).length, 0);
    // Contenido no válido: ni se guarda ni se envía.
    await assert.rejects(a.engine.saveEdit(base.id, content({ name: '' }), base), { code: 'invalid_content' });
  });

  it('7. conflicto: el servidor cambió el mismo campo → decide el usuario; nada se sobrescribe', async () => {
    const { server, dev, a, base } = await withPet();
    dev.online.value = false;
    await a.engine.saveEdit(base.id, content({ name: 'Mía' }), base);
    server.editElsewhere(base.id, { name: 'Suya' });
    dev.online.value = true;
    await a.engine.requestSync();

    const [op] = await a.operations.list();
    assert.equal(op.status, 'conflict');
    assert.equal(op.conflictRemote.name, 'Suya');
    assert.equal(op.content.name, 'Mía', 'el cambio local se conserva');
    assert.equal(server.rowOf(base.id).name, 'Suya', 'el servidor no se sobrescribe');

    const outcome = await a.engine.resolveConflict(base.id, {
      content: { ...contentOf(op.conflictRemote), name: 'Mía' },
      shownRemote: op.conflictRemote,
    });
    assert.equal(outcome, 'synced');
    assert.equal(server.rowOf(base.id).name, 'Mía');
  });

  it('7b. el servidor cambió otro campo: se aplica lo local sobre la versión nueva, sin conflicto', async () => {
    const { server, dev, a, base } = await withPet();
    dev.online.value = false;
    await a.engine.saveEdit(base.id, content({ name: 'Mía' }), base);
    server.editElsewhere(base.id, { weight_kg: 9 });
    dev.online.value = true;
    await a.engine.requestSync();
    assert.deepEqual(await a.operations.list(), []);
    assert.equal(server.rowOf(base.id).name, 'Mía');
    assert.equal(server.rowOf(base.id).weight_kg, 9, 'lo remoto se conserva');
  });

  it('7d. otro dispositivo cambió solo la foto: se reaplica lo local y el photo_path nuevo se conserva', async () => {
    const { server, dev, a, base } = await withPet();
    dev.online.value = false;
    await a.engine.saveEdit(base.id, content({ name: 'Mía' }), base);
    const newPath = `${base.id}/0b8c2d55-9a11-4f0e-8a51-0d1f3a7c9e10.jpg`;
    server.editElsewhere(base.id, { photo_path: newPath });
    dev.online.value = true;
    await a.engine.requestSync();
    assert.deepEqual(await a.operations.list(), [], 'sin conflicto: la foto no es un dato editable');
    assert.equal(server.rowOf(base.id).name, 'Mía');
    assert.equal(server.rowOf(base.id).photo_path, newPath, 'nunca se envía ni se pisa photo_path');
    const updates = server.calls.filter((call) => call.op === 'update');
    assert.equal(updates.length, 2, 'un intento con la base antigua (0 filas) y otro con la nueva');
    for (const call of updates) assert.equal('photo_path' in call.payload, false);
  });

  it('7c. el servidor cambió el conflicto otra vez mientras se decidía: se vuelve a pedir', async () => {
    const { server, dev, a, base } = await withPet();
    dev.online.value = false;
    await a.engine.saveEdit(base.id, content({ name: 'Mía' }), base);
    server.editElsewhere(base.id, { name: 'Suya' });
    dev.online.value = true;
    await a.engine.requestSync();
    const [op] = await a.operations.list();
    server.editElsewhere(base.id, { name: 'Suya 2' });
    assert.equal(await a.engine.resolveConflict(base.id, { content: op.content, shownRemote: op.conflictRemote }), 'conflict');
    assert.equal((await a.operations.read(base.id)).conflictRemote.name, 'Suya 2');
    assert.equal(server.rowOf(base.id).name, 'Suya 2');
  });

  it('8. sin permiso (co-tutor retirado): se conservan los cambios locales y no se reintenta solo', async () => {
    const server = createFakePetServer({ owner: USER_A });
    const base = server.insertElsewhere({ id: randomUUID(), owner_id: USER_A, ...content() });
    server.addEditor(base.id, USER_B);
    const dev = device({ server });
    const b = signIn(dev.make(USER_B), USER_B);
    dev.online.value = false;
    await b.engine.saveEdit(base.id, content({ name: 'De B' }), base);
    server.removeEditor(base.id, USER_B);
    dev.online.value = true;
    await b.engine.requestSync();

    const [op] = await b.operations.list();
    assert.equal(op.status, 'forbidden');
    assert.equal(op.content.name, 'De B');
    const calls = server.calls.length;
    await b.engine.requestSync();
    assert.equal(server.calls.length, calls, 'sin reintentos automáticos');
    assert.equal(await b.engine.discard(base.id), 'discarded');
    assert.deepEqual(await b.operations.list(), []);
  });

  it('una edición de una mascota borrada en el servidor queda «no disponible» con los datos intactos', async () => {
    const { server, a, dev, base } = await withPet();
    dev.online.value = false;
    await a.engine.saveEdit(base.id, content({ name: 'Mía' }), base);
    server.deleteElsewhere(base.id);
    dev.online.value = true;
    await a.engine.requestSync();
    const [op] = await a.operations.list();
    assert.equal(op.status, 'forbidden');
    assert.equal(op.lastError.reason, 'not_visible');
    assert.equal(op.content.name, 'Mía');
  });

  it('respuesta perdida de una edición aplicada: al reintentar se lee la fila y queda sincronizada', async () => {
    const { server, a, base } = await withPet();
    server.loseNextResponse();
    await a.engine.saveEdit(base.id, content({ name: 'Mía' }), base);
    await a.engine.idle();
    assert.notEqual((await a.operations.read(base.id)).inFlightSince, null);
    await a.engine.retry(base.id);
    assert.deepEqual(await a.operations.list(), []);
    assert.equal(server.rowOf(base.id).name, 'Mía');
  });
});

describe('sesión, propietario y recuperación', () => {
  it('9. respuesta tardía tras cambiar de cuenta: se guarda solo en el almacén de su dueño', async () => {
    const server = createFakePetServer({ owner: USER_A });
    const { make } = device({ server });
    const a = signIn(make(USER_A), USER_A);
    const release = server.holdNext();
    const op = await a.engine.saveCreate(content());
    await new Promise((resolve) => setTimeout(resolve, 10));
    // Cambio de cuenta: el motor de A se para y queda sin sesión (como `sessions.activate(B)`).
    a.engine.stop();
    a.engine.setSessionUserId(null);
    const b = signIn(make(USER_B), USER_B);
    release();
    await a.engine.idle();

    assert.equal((await a.operations.read(op.localId)).status, 'synced');
    assert.deepEqual(await b.operations.list(), []);
    assert.deepEqual(await b.cache.readList(), { status: 'never_loaded' });
    assert.equal(await b.cache.readPet((await a.operations.read(op.localId)).petId), null);
  });

  it('11. sin sesión utilizable o sin conexión no sale ninguna petición', async () => {
    const server = createFakePetServer({ owner: USER_A });
    const { make, online } = device({ server });
    const a = make(USER_A);
    a.engine.start();
    await a.engine.saveCreate(content());
    await a.engine.requestSync();
    assert.equal(server.calls.length, 0, 'sin sesión');
    online.value = false;
    a.engine.setSessionUserId(USER_A);
    await a.engine.requestSync();
    assert.equal(server.calls.length, 0, 'sin conexión');
    a.engine.setSessionUserId(USER_B);
    online.value = true;
    await a.engine.requestSync();
    assert.equal(server.calls.length, 0, 'con la sesión de otra cuenta');
  });

  it('12. sin el token del propietario (401 owner_session_required) no se reenvía con esa sesión', async () => {
    const calls = [];
    const remote = {
      create: async () => (calls.push('create'), { ok: false, error: { code: 'owner_session_required' }, status: 401 }),
      findByRequestId: async () => ({ ok: true, data: null }),
      update: async () => ({ ok: true, data: null }),
      fetch: async () => ({ ok: true, data: null }),
    };
    const { make } = device({ server: createFakePetServer({ owner: USER_A }) });
    const a = signIn(make(USER_A, remote), USER_A);
    const op = await a.engine.saveCreate(content());
    await a.engine.idle();
    await a.engine.requestSync();
    assert.deepEqual(calls, ['create']);
    assert.equal((await a.operations.read(op.localId)).status, 'pending');
    a.engine.setSessionUserId(USER_A);
    await a.engine.requestSync();
    assert.deepEqual(calls, ['create', 'create'], 'una sesión nueva o renovada desbloquea el envío');
  });

  it('13/14. el motor no tiene operaciones de borrado ni de fotos', async () => {
    const server = createFakePetServer({ owner: USER_A });
    const { make } = device({ server });
    const a = signIn(make(USER_A), USER_A);
    const op = await a.engine.saveCreate(content());
    await a.engine.idle();
    const { petId } = await a.operations.read(op.localId);
    await a.engine.saveEdit(petId, content({ name: 'Otra' }), server.rowOf(petId));
    await a.engine.idle();
    assert.deepEqual([...new Set(server.calls.map((call) => call.op))].sort(), ['create', 'update']);
    for (const call of server.calls) assert.equal('photo_path' in (call.payload ?? {}), false);
    assert.equal(server.rowOf(petId).photo_path, null);
    assert.equal(server.pets.size, 1, 'nada se borra');
  });

  it('15. la app se cierra durante el envío: al reabrir, se reenvía sin duplicar y queda sincronizada', async () => {
    const server = createFakePetServer({ owner: USER_A });
    const { make, disk } = device({ server });
    const a = signIn(make(USER_A), USER_A);
    // La respuesta no llega nunca: la app «se cierra» con el alta en vuelo.
    server.holdNext();
    const op = await a.engine.saveCreate(content());
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.notEqual((await a.operations.read(op.localId)).inFlightSince, null, 'anotada antes de enviar');
    assert.equal(server.pets.size, 1);

    const reopened = signIn(device({ disk, server }).make(USER_A), USER_A);
    await reopened.engine.requestSync();
    const mapped = await reopened.operations.read(op.localId);
    assert.equal(mapped.status, 'synced');
    assert.equal(server.pets.size, 1, 'una sola mascota');
  });
});
