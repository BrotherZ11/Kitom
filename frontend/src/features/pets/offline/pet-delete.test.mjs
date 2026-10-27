// Pruebas de la eliminación de mascotas sin conexión (fase 10, `npm test`): modelo (`pet-operation.ts`),
// motor (`pet-sync-engine.ts`) con el servidor falso (`fake-pet-server.mjs`), vistas
// (`pet-write-view.ts`), copia de mascotas y resumen del cierre de sesión. Discos en memoria que
// sobreviven a «reiniciar».
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { createLocalStore } from '../../../lib/local-store/local-store.ts';
import { createMemoryStorage } from '../../../lib/local-store/memory-storage.ts';
import { NO_PET_CHANGES, signOutTotal } from '../../auth/unsynced-changes.ts';
import { createPetCacheRepository } from './pet-cache-repository.ts';
import { createPetOperationRepository } from './pet-operation-repository.ts';
import {
  canDiscardPetOperation,
  canUndoPetDelete,
  contentOf,
  parseLocalPetOperation,
  petDeleteDisplay,
  petSyncDisplay,
  petUnsyncedTotal,
  summarizePetOperations,
} from './pet-operation.ts';
import { createPetSyncEngine } from './pet-sync-engine.ts';
import { createFakePetServer } from './fake-pet-server.mjs';
import { SPECIES, USER_A, USER_B } from './pet-test-helpers.mjs';
import { dailyLogsAccess, listWithLocalEdits, pendingDeletions, resolveLocalPetDetail, unsyncedPetItems, withLocalEdits } from './pet-write-view.ts';

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
    engine.start();
    engine.setSessionUserId(userId);
    return { operations, cache, engine };
  };
  return { disk, online, make };
}

/** Mascota de A en el servidor, vista por el dispositivo (en su copia, como tras abrir la lista). */
async function withPet({ owner = USER_A, overrides = {} } = {}) {
  const server = createFakePetServer({ owner: USER_A });
  const base = server.insertElsewhere({ id: randomUUID(), owner_id: owner, ...content(), ...overrides });
  const dev = device({ server });
  const a = dev.make(USER_A);
  await a.cache.applyPet(a.cache.beginRead(), base.id, base);
  return { server, dev, a, base };
}

const calls = (server, op) => server.calls.filter((call) => call.op === op);

describe('altas de este dispositivo', () => {
  it('1. un borrador que nunca salió se cancela en local: no se crea nada en el servidor', async () => {
    const server = createFakePetServer({ owner: USER_A });
    const dev = device({ server });
    dev.online.value = false;
    const a = dev.make(USER_A);
    const op = await a.engine.saveCreate(content());
    assert.deepEqual(await a.engine.requestDelete(op.localId, null), { result: 'cancelled' });
    assert.equal(await a.operations.read(op.localId), null);

    dev.online.value = true;
    await a.engine.requestSync();
    assert.equal(server.calls.length, 0);
    assert.equal(server.pets.size, 0);
  });

  it('2. eliminar mientras el alta está en vuelo: espera al resultado y borra lo creado, sin duplicar', async () => {
    const server = createFakePetServer({ owner: USER_A });
    const dev = device({ server });
    const a = dev.make(USER_A);
    dev.online.value = false;
    const op = await a.engine.saveCreate(content({ name: 'En vuelo' }));
    dev.online.value = true;

    const release = server.holdNext();
    const pass = a.engine.requestSync();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal((await a.operations.read(op.localId)).inFlightSince !== null, true, 'el alta salió');
    const request = await a.engine.requestDelete(op.localId, null);
    assert.equal(request.result, 'saved');
    assert.equal(request.op.kind, 'delete');
    assert.equal(request.op.restore, 'create');
    assert.equal(request.op.petId, null, 'aún no se sabe si existe');

    release();
    await pass;
    await a.engine.requestSync();
    assert.equal(server.pets.size, 0, 'se creó y se borró');
    assert.equal(calls(server, 'create').length, 1);
    assert.equal(calls(server, 'delete').length, 1);
    const tombstone = await a.operations.read(op.localId);
    assert.equal(tombstone.status, 'synced');
    assert.equal(petDeleteDisplay(tombstone, false), 'deleted');
  });

  it('2b/3. respuesta del alta perdida, eliminar sin conexión y reiniciar: se busca por su clave y se borra (sin duplicados)', async () => {
    const server = createFakePetServer({ owner: USER_A });
    const dev = device({ server });
    const a = dev.make(USER_A);
    server.loseNextResponse();
    const op = await a.engine.saveCreate(content({ name: 'Perdida' }));
    await a.engine.idle();
    assert.equal(server.pets.size, 1, 'el servidor la creó');
    assert.notEqual((await a.operations.read(op.localId)).inFlightSince, null);

    dev.online.value = false;
    const request = await a.engine.requestDelete(op.localId, null);
    assert.equal(request.result, 'saved', 'no se cancela a ciegas: pudo crearse');

    // Reinicio con red.
    dev.online.value = true;
    const reopened = dev.make(USER_A);
    await reopened.engine.requestSync();
    assert.equal(server.pets.size, 0);
    assert.equal(calls(server, 'create').length, 1, 'el alta no se reenvía');
    assert.equal(calls(server, 'findByRequestId').length, 1);
    assert.equal((await reopened.operations.read(op.localId)).status, 'synced');
  });

  it('2c. el alta incierta nunca llegó al servidor: la clave no encuentra nada y se cancela en local', async () => {
    const server = createFakePetServer({ owner: USER_A });
    const dev = device({ server });
    const a = dev.make(USER_A);
    server.net.online = false; // la petición sale, pero no llega (sin respuesta)
    const op = await a.engine.saveCreate(content());
    await a.engine.idle();
    assert.notEqual((await a.operations.read(op.localId)).inFlightSince, null);

    await a.engine.requestDelete(op.localId, null);
    server.net.online = true;
    await a.engine.requestSync();
    assert.equal(await a.operations.read(op.localId), null);
    assert.equal(server.pets.size, 0);
    assert.equal(calls(server, 'delete').length, 0, 'nada que borrar');
  });

  it('2d. se pide borrar justo después de que el motor eligiera el alta y antes de enviarla: no se reenvía el alta', async () => {
    const server = createFakePetServer({ owner: USER_A });
    const disk = new Map();
    server.loseNextResponse();
    const first = device({ server, disk }).make(USER_A);
    const op = await first.engine.saveCreate(content({ name: 'Carrera' }));
    await first.engine.idle();
    first.engine.stop();
    assert.equal(calls(server, 'create').length, 1);

    // Reinicio: el motor lista las operaciones (ve el alta incierta) y, antes de enviarla, el usuario la borra.
    const storage = createMemoryStorage(disk);
    const operations = createPetOperationRepository(createLocalStore(storage, USER_A));
    // Ya toca reenviarla (sin la espera del fallo de red).
    await operations.update(op.localId, (current) => ({ ...current, nextAttemptAt: null }));
    let interleave = true;
    let engine;
    const racing = {
      ...operations,
      async list() {
        const ops = await operations.list();
        if (interleave) {
          interleave = false;
          await engine.requestDelete(op.localId, null);
        }
        return ops;
      },
    };
    engine = createPetSyncEngine({
      operations: racing,
      cache: createPetCacheRepository(createLocalStore(storage, USER_A)),
      remote: server.remoteFor(USER_A),
      isOnline: () => true,
      now: Date.now,
      createOperationId: randomUUID,
      random: () => 0,
    });
    engine.start();
    engine.setSessionUserId(USER_A);
    await engine.requestSync();
    await engine.requestSync();
    assert.equal(calls(server, 'create').length, 1, 'el alta no se vuelve a enviar');
    assert.equal(server.pets.size, 0, 'se encontró por su clave y se borró');
  });

  it('5b/3. deshacer la eliminación de un alta incierta: vuelve como incierta y se reenvía sin duplicar', async () => {
    const server = createFakePetServer({ owner: USER_A });
    const dev = device({ server });
    const a = dev.make(USER_A);
    server.loseNextResponse();
    const op = await a.engine.saveCreate(content({ name: 'Vuelve' }));
    await a.engine.idle();
    dev.online.value = false;
    await a.engine.requestDelete(op.localId, null);
    assert.equal(await a.engine.undoDelete(op.localId), 'restored');
    const restored = await a.operations.read(op.localId);
    assert.equal(restored.kind, 'create');
    assert.notEqual(restored.inFlightSince, null, 'sigue siendo incierta');
    assert.equal(canDiscardPetOperation(restored), false, 'no se puede descartar como si nunca hubiera salido');

    dev.online.value = true;
    await a.engine.requestSync();
    assert.equal(server.pets.size, 1);
    assert.equal((await a.operations.read(op.localId)).status, 'synced');
  });
});

describe('mascotas del servidor', () => {
  it('4. eliminar sin conexión, reiniciar y sincronizar: borrada con precondición; lápida y copia no disponible', async () => {
    const { server, dev, a, base } = await withPet();
    dev.online.value = false;
    const request = await a.engine.requestDelete(base.id, base);
    assert.equal(request.result, 'saved');
    assert.equal(server.calls.length, 0);

    dev.online.value = true;
    const reopened = dev.make(USER_A);
    await reopened.engine.requestSync();
    assert.equal(server.rowOf(base.id), null);
    assert.deepEqual(calls(server, 'delete').map((call) => call.baseUpdatedAt), [base.updated_at]);
    assert.equal((await reopened.operations.read(base.id)).status, 'synced');
    assert.notEqual((await reopened.cache.readPet(base.id)).unavailableAt, null, 'la copia se conserva, no disponible');
  });

  it('4b. con una edición pendiente: la eliminación la sustituye y usa su base; deshacer la devuelve', async () => {
    const { server, dev, a, base } = await withPet();
    dev.online.value = false;
    await a.engine.saveEdit(base.id, content({ name: 'Editada' }), base);
    const request = await a.engine.requestDelete(base.id, base);
    assert.equal(request.op.restore, 'update');
    assert.equal(request.op.content.name, 'Editada');
    assert.equal(request.op.baseRow.updated_at, base.updated_at);

    assert.equal(await a.engine.undoDelete(base.id), 'restored');
    const restored = await a.operations.read(base.id);
    assert.equal(restored.kind, 'update');
    assert.equal(restored.content.name, 'Editada', 'la edición no se pierde');
    dev.online.value = true;
    await a.engine.requestSync();
    assert.equal(server.rowOf(base.id).name, 'Editada');
    assert.equal(calls(server, 'delete').length, 0);
  });

  it('5. deshacer antes de confirmar (sin edición): no queda nada pendiente y el servidor no cambia', async () => {
    const { server, dev, a, base } = await withPet();
    dev.online.value = false;
    await a.engine.requestDelete(base.id, base);
    assert.equal(canUndoPetDelete(await a.operations.read(base.id)), true);
    assert.equal(await a.engine.undoDelete(base.id), 'restored');
    assert.equal(await a.operations.read(base.id), null);
    dev.online.value = true;
    await a.engine.requestSync();
    assert.equal(server.calls.length, 0);
    assert.ok(server.rowOf(base.id));
  });

  it('6. dos peticiones de eliminación: una operación y un solo borrado; respuesta perdida → se comprueba sin error', async () => {
    const { server, dev, a, base } = await withPet();
    dev.online.value = false;
    const first = await a.engine.requestDelete(base.id, base);
    const second = await a.engine.requestDelete(base.id, base);
    assert.equal(second.op.operationId, first.op.operationId, 'pedirla dos veces no duplica nada');
    assert.equal((await a.operations.list()).length, 1);

    dev.online.value = true;
    server.loseNextResponse(); // se borra, pero la respuesta no llega
    await a.engine.requestSync();
    const uncertain = await a.operations.read(base.id);
    assert.notEqual(uncertain.inFlightSince, null);
    assert.equal(petDeleteDisplay(uncertain, false), 'uncertain');
    assert.equal(await a.engine.undoDelete(base.id), 'in_flight', 'no se deshace lo que pudo aplicarse');

    await a.engine.retry(base.id);
    assert.equal(calls(server, 'delete').length, 2);
    assert.equal(await a.operations.read(base.id), null, 'ya no estaba: se cierra');
    assert.equal(server.rowOf(base.id), null);
  });

  it('7. ya eliminada en otro dispositivo: se cierra sin error y la copia queda no disponible', async () => {
    const { server, dev, a, base } = await withPet();
    dev.online.value = false;
    await a.engine.requestDelete(base.id, base);
    server.deleteElsewhere(base.id);
    dev.online.value = true;
    await a.engine.requestSync();
    assert.equal(await a.operations.read(base.id), null);
    assert.notEqual((await a.cache.readPet(base.id)).unavailableAt, null);
  });

  it('8. otro dispositivo la cambió antes del borrado: conflicto, el cambio se enseña y no se borra sin decidir', async () => {
    const { server, dev, a, base } = await withPet();
    dev.online.value = false;
    await a.engine.requestDelete(base.id, base);
    const changed = server.editElsewhere(base.id, { name: 'Cambiada fuera' });
    dev.online.value = true;
    await a.engine.requestSync();

    const op = await a.operations.read(base.id);
    assert.equal(op.status, 'conflict');
    assert.equal(op.conflictRemote.name, 'Cambiada fuera');
    assert.equal(server.rowOf(base.id).name, 'Cambiada fuera', 'la modificación no se descarta');
    assert.equal(canUndoPetDelete(op), true);

    // Vuelve a cambiar entre que se ve y se decide: se enseña la nueva; no se borra.
    server.editElsewhere(base.id, { name: 'Otra vez' });
    assert.equal(await a.engine.resolveDeleteConflict(base.id, { decision: 'delete', shownRemote: changed }), 'conflict');
    assert.ok(server.rowOf(base.id));
    const again = await a.operations.read(base.id);
    assert.equal(again.conflictRemote.name, 'Otra vez');

    assert.equal(await a.engine.resolveDeleteConflict(base.id, { decision: 'delete', shownRemote: again.conflictRemote }), 'synced');
    assert.equal(server.rowOf(base.id), null);
  });

  it('8b. conservar la mascota en un conflicto: vuelve lo que había y el servidor no cambia', async () => {
    const { server, dev, a, base } = await withPet();
    dev.online.value = false;
    await a.engine.saveEdit(base.id, content({ weight_kg: 4.5 }), base);
    await a.engine.requestDelete(base.id, base);
    const changed = server.editElsewhere(base.id, { name: 'Cambiada fuera' });
    dev.online.value = true;
    await a.engine.requestSync();
    assert.equal(await a.engine.resolveDeleteConflict(base.id, { decision: 'keep', shownRemote: changed }), 'kept');
    const restored = await a.operations.read(base.id);
    assert.equal(restored.kind, 'update');
    assert.equal(restored.content.weight_kg, 4.5);
    assert.ok(server.rowOf(base.id));
  });

  it('8c. la edición de este dispositivo llegó sin respuesta: el borrado se rehace sobre ella (no es un conflicto)', async () => {
    const { server, dev, a, base } = await withPet();
    server.loseNextResponse();
    await a.engine.saveEdit(base.id, content({ name: 'Mía' }), base);
    await a.engine.idle();
    assert.equal(server.rowOf(base.id).name, 'Mía', 'la edición se aplicó');
    dev.online.value = false;
    await a.engine.requestDelete(base.id, base);
    dev.online.value = true;
    await a.engine.requestSync();
    assert.equal(server.rowOf(base.id), null);
    assert.equal(calls(server, 'delete').length, 2, 'primero con la base vieja (0 filas), después sobre la edición');
  });

  it('9. sin permiso: no se puede iniciar si no es el propietario; si deja de serlo, queda «sin permiso» con todo', async () => {
    const shared = await withPet({ owner: USER_B });
    shared.server.addEditor(shared.base.id, USER_A);
    assert.deepEqual(await shared.a.engine.requestDelete(shared.base.id, shared.base), { result: 'rejected', reason: 'not_owner' });
    assert.equal(await shared.a.operations.read(shared.base.id), null);

    // Era el propietario según su copia, pero ya no lo es (p. ej. transferida) y sigue como co-tutor.
    const { server, dev, a, base } = await withPet();
    dev.online.value = false;
    await a.engine.saveEdit(base.id, content({ name: 'Local' }), base);
    await a.engine.requestDelete(base.id, base);
    server.pets.get(base.id).owner_id = USER_B;
    server.addEditor(base.id, USER_A);
    dev.online.value = true;
    await a.engine.requestSync();
    const op = await a.operations.read(base.id);
    assert.equal(op.status, 'forbidden');
    assert.equal(op.content.name, 'Local', 'lo local se conserva');
    assert.ok(server.rowOf(base.id));
    assert.equal(await a.engine.undoDelete(base.id), 'restored', 'se puede recuperar');
  });

  it('10. red: antes (nada sale), durante (incierta) y después (la lectura de comprobación falla)', async () => {
    const { server, dev, a, base } = await withPet();
    dev.online.value = false;
    await a.engine.requestDelete(base.id, base);
    await a.engine.requestSync();
    assert.equal(server.calls.length, 0, 'antes: sin conexión no sale nada');

    // Después: el borrado responde 0 filas (otra versión) y la lectura se queda sin red.
    server.editElsewhere(base.id, { name: 'X' });
    dev.online.value = true;
    const remote = server.remoteFor(USER_A);
    let failFetch = true;
    const flaky = {
      ...remote,
      fetch: (petId) => (failFetch ? ((failFetch = false), Promise.resolve({ ok: false, error: { message: 'Network request failed' }, status: null })) : remote.fetch(petId)),
    };
    const b = dev.make(USER_A, flaky);
    await b.engine.requestSync();
    const afterFetchFailure = await b.operations.read(base.id);
    assert.equal(afterFetchFailure.status, 'pending');
    assert.equal(afterFetchFailure.inFlightSince, null, 'el borrado respondió: no es incierto');
    assert.ok(server.rowOf(base.id));
    await b.engine.retry(base.id);
    assert.equal((await b.operations.read(base.id)).status, 'conflict');
  });
});

describe('vistas, registros diarios y respuestas tardías', () => {
  it('11. registros diarios: no se abren mientras hay eliminación; los del dispositivo no se tocan', async () => {
    const { dev, a, base } = await withPet();
    const logKey = `kitom:v1:${USER_A}:daily-logs:${base.id}:2026-10-25`;
    dev.disk.set(logKey, '{"v":1,"data":"registro sin sincronizar"}');
    dev.online.value = false;
    await a.engine.requestDelete(base.id, base);
    assert.equal(dailyLogsAccess(base.id, await a.operations.list()), 'deleting');
    dev.online.value = true;
    await a.engine.requestSync();
    assert.equal(dailyLogsAccess(base.id, await a.operations.list()), 'deleting', 'tampoco tras confirmarla');
    assert.equal(dev.disk.get(logKey), '{"v":1,"data":"registro sin sincronizar"}', 'el registro sigue igual');
    assert.equal(dailyLogsAccess(randomUUID(), await a.operations.list()), 'allowed');
  });

  it('14. una respuesta antigua no la hace reaparecer: ni en la copia ni en la lista', async () => {
    const { server, a, base } = await withPet();
    const staleMark = a.cache.beginRead(); // una lectura de la lista empieza antes del borrado…
    const staleRows = [server.rowOf(base.id)];
    await a.engine.requestDelete(base.id, base);
    await a.engine.requestSync();
    assert.equal(server.rowOf(base.id), null);

    // …y su respuesta llega después.
    const shown = await a.cache.applyList(staleMark, staleRows);
    assert.deepEqual(shown, [], 'la copia no la resucita');
    const ops = await a.operations.list();
    assert.deepEqual(withLocalEdits(staleRows, ops, null), [], 'la lista la oculta por su lápida');
    const view = listWithLocalEdits({ state: 'ready', pets: staleRows, source: 'server', stale: false, savedAt: null }, ops);
    assert.deepEqual(view.pets, []);
  });

  it('las eliminaciones pendientes van aparte, con su estado; la lápida no', async () => {
    const { dev, a, base } = await withPet();
    dev.online.value = false;
    await a.engine.requestDelete(base.id, base);
    const ops = await a.operations.list();
    const [item] = pendingDeletions(ops, null);
    assert.equal(item.pet.id, base.id);
    assert.equal(item.display, 'pending');
    assert.equal(petSyncDisplay(item.op, false), null, 'no es un alta ni una edición');
    assert.deepEqual(unsyncedPetItems(ops, null).map((entry) => [entry.kind, entry.deletion]), [['delete', 'pending']]);
    assert.deepEqual(withLocalEdits([base], ops, null), []);

    dev.online.value = true;
    await a.engine.requestSync();
    assert.deepEqual(pendingDeletions(await a.operations.list(), null), []);
    assert.deepEqual(unsyncedPetItems(await a.operations.list(), null), []);
  });

  it('la ficha de un alta incierta que se elimina enseña la eliminación', async () => {
    const server = createFakePetServer({ owner: USER_A });
    const dev = device({ server });
    const a = dev.make(USER_A);
    server.loseNextResponse();
    const op = await a.engine.saveCreate(content({ name: 'Ficha' }));
    await a.engine.idle();
    await a.engine.requestDelete(op.localId, null);
    const detail = resolveLocalPetDetail(op.localId, { status: 'success', data: await a.operations.list(), error: null });
    assert.equal(detail.state, 'ready');
    assert.equal(detail.op.kind, 'delete');
    assert.equal(detail.pet.name, 'Ficha');
  });

  it('15. aislamiento: la eliminación de A no la ve ni la envía B en el mismo dispositivo', async () => {
    const { server, dev, a, base } = await withPet();
    dev.online.value = false;
    await a.engine.requestDelete(base.id, base);
    a.engine.setSessionUserId(null);
    a.engine.stop();

    dev.online.value = true;
    const b = dev.make(USER_B);
    assert.deepEqual(await b.operations.list(), []);
    await b.engine.requestSync();
    assert.equal(calls(server, 'delete').length, 0);
    assert.deepEqual(await b.engine.requestDelete(base.id, base), { result: 'rejected', reason: 'not_owner' });

    // Con la sesión de B activa, el motor de A no envía nada (el remoto lo autoriza el dueño).
    a.engine.start();
    a.engine.setSessionUserId(USER_B);
    await a.engine.requestSync();
    assert.equal(calls(server, 'delete').length, 0);
    a.engine.setSessionUserId(USER_A);
    await a.engine.requestSync();
    assert.deepEqual(calls(server, 'delete').map((call) => call.userId), [USER_A]);
  });
});

describe('16. cierre de sesión y contador de pendientes', () => {
  it('cuenta las eliminaciones pendientes, inciertas y en conflicto; no las confirmadas', async () => {
    const { server, dev, a, base } = await withPet();
    dev.online.value = false;
    await a.engine.requestDelete(base.id, base);
    let summary = summarizePetOperations(await a.operations.list());
    assert.equal(summary.pendingDelete, 1);
    assert.equal(petUnsyncedTotal(summary), 1);
    assert.equal(signOutTotal({ dailyLogs: { pending: 0, failed: 0, conflict: 0 }, pets: summary }), 1, 'no se cierra sin preguntar');

    server.editElsewhere(base.id, { name: 'Cambiada' });
    dev.online.value = true;
    await a.engine.requestSync();
    summary = summarizePetOperations(await a.operations.list());
    assert.equal(summary.conflict, 1);
    assert.equal(summary.pendingDelete, 0);

    const op = await a.operations.read(base.id);
    await a.engine.resolveDeleteConflict(base.id, { decision: 'delete', shownRemote: op.conflictRemote });
    summary = summarizePetOperations(await a.operations.list());
    assert.deepEqual(summary, NO_PET_CHANGES, 'la lápida no cuenta');
  });

  it('syncNow (sincronizar y cerrar) envía las eliminaciones pendientes', async () => {
    const { server, dev, a, base } = await withPet();
    dev.online.value = false;
    await a.engine.requestDelete(base.id, base);
    dev.online.value = true;
    assert.deepEqual(await a.engine.syncNow({ timeoutMs: 1000 }), { status: 'completed' });
    assert.equal(server.rowOf(base.id), null);
    assert.equal(petUnsyncedTotal(summarizePetOperations(await a.operations.list())), 0);
  });
});

describe('formato guardado de la eliminación', () => {
  it('se guarda y se vuelve a leer; las combinaciones imposibles no son válidas', async () => {
    const { dev, a, base } = await withPet();
    dev.online.value = false;
    const { op } = await a.engine.requestDelete(base.id, base);
    assert.deepEqual(parseLocalPetOperation(JSON.parse(JSON.stringify(op))), op);
    assert.equal(parseLocalPetOperation({ ...op, restore: null }), null, 'una eliminación sabe qué deshace');
    assert.equal(parseLocalPetOperation({ ...op, baseRow: null }), null, 'sin base no hay precondición');
    assert.equal(parseLocalPetOperation({ ...op, petId: null }), null);
    assert.equal(parseLocalPetOperation({ ...op, kind: 'update' }), null, 'una edición no lleva `restore`');
    assert.deepEqual(contentOf(op.baseRow), contentOf(base));
  });

  it('las operaciones de antes de la fase 10 (sin `restore`) se siguen leyendo', async () => {
    const server = createFakePetServer({ owner: USER_A });
    const a = device({ server }).make(USER_A);
    const op = await a.engine.saveCreate(content());
    const { restore, ...legacy } = op;
    assert.equal(restore, null);
    assert.deepEqual(parseLocalPetOperation(legacy), op);
  });
});
