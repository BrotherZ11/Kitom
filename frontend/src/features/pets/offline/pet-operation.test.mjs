// Pruebas de `pet-operation.ts` y `pet-write-view.ts` (`npm test`): modelo de altas y ediciones del
// dispositivo, fusión a tres bandas, transiciones y vistas con lo local encima.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { createLocalStore } from '../../../lib/local-store/local-store.ts';
import { createMemoryStorage } from '../../../lib/local-store/memory-storage.ts';
import { createPetOperationRepository } from './pet-operation-repository.ts';
import {
  applyPetEdit,
  applyPetSyncFailure,
  canDiscardPetOperation,
  chooseContent,
  contentOf,
  createPetOperation,
  isLocalPetId,
  mergePetContent,
  PET_OPERATIONS,
  petSyncDisplay,
  reconcileEdit,
} from './pet-operation.ts';
import {
  canHaveDailyLogs,
  listWithLocalEdits,
  localDrafts,
  orphanedEdits,
  resolveLocalPetDetail,
  withLocalEdits,
} from './pet-write-view.ts';
import { at, makePet, USER_A, USER_B } from './pet-test-helpers.mjs';

const NOW = { now: 1_000 };
const edit = (pet, overrides) => ({ ...contentOf(pet), ...overrides });
const newOp = (userId = USER_A) => createPetOperation({ userId, content: contentOf(makePet()), operationId: randomUUID() }, NOW);
const updateOp = (pet, overrides) =>
  applyPetEdit(null, { userId: USER_A, petId: pet.id, content: edit(pet, overrides), baseRow: pet, operationId: randomUUID() }, NOW);

describe('modelo', () => {
  it('alta: id local distinguible, sin id del servidor, con su clave de operación', () => {
    const op = newOp();
    assert.equal(isLocalPetId(op.localId), true);
    assert.equal(op.localId, `local-${op.operationId}`);
    assert.equal(op.petId, null);
    assert.equal(isLocalPetId(makePet().id), false);
  });

  it('se guarda versionado bajo la clave de su usuario y se valida al leer', async () => {
    const disk = new Map();
    const store = createLocalStore(createMemoryStorage(disk), USER_A);
    const op = newOp();
    await store.write(PET_OPERATIONS, [op.localId], op);
    assert.deepEqual([...disk.keys()], [`kitom:v1:${USER_A}:pet-ops:${op.localId}`]);
    assert.deepEqual(await store.read(PET_OPERATIONS, [op.localId]), { status: 'found', value: op });

    // De otra cuenta (copiada a esta clave) no vale.
    const storeB = createLocalStore(createMemoryStorage(disk), USER_B);
    disk.set(`kitom:v1:${USER_B}:pet-ops:${op.localId}`, disk.get(`kitom:v1:${USER_A}:pet-ops:${op.localId}`));
    assert.deepEqual(await storeB.read(PET_OPERATIONS, [op.localId]), { status: 'corrupt', reason: 'key_mismatch' });
    // Contenido protegido o no válido: no se guarda.
    await assert.rejects(store.write(PET_OPERATIONS, [op.localId], { ...op, content: { ...op.content, name: '' } }), {
      code: 'invalid_value',
    });
  });

  it('lo ilegible no se lista, no se envía y no se sobrescribe', async () => {
    const disk = new Map();
    const repo = createPetOperationRepository(createLocalStore(createMemoryStorage(disk), USER_A));
    const op = newOp();
    disk.set(`kitom:v1:${USER_A}:pet-ops:${op.localId}`, JSON.stringify({ v: 9, data: {} }));
    assert.deepEqual(await repo.list(), []);
    assert.equal(await repo.unreadableCount(), 1);
    await assert.rejects(repo.update(op.localId, () => op), { code: 'unreadable' });
    assert.equal(JSON.parse(disk.get(`kitom:v1:${USER_A}:pet-ops:${op.localId}`)).v, 9);
  });
});

describe('6. ediciones: consolidación', () => {
  it('una operación por mascota: contenido nuevo, la misma base y el mismo id de operación', () => {
    const pet = makePet();
    const first = updateOp(pet, { name: 'Uno' });
    const second = applyPetEdit(first, { userId: USER_A, petId: pet.id, content: edit(pet, { name: 'Dos' }), baseRow: makePet(), operationId: randomUUID() }, { now: 2_000 });
    assert.equal(second.content.name, 'Dos');
    assert.equal(second.baseRow, first.baseRow);
    assert.equal(second.operationId, first.operationId);
    assert.equal(second.editedAt, 2_000);
  });

  it('sin cambios respecto a la base no hay nada que enviar; en conflicto o sin permiso no se edita', () => {
    const pet = makePet();
    assert.equal(applyPetEdit(null, { userId: USER_A, petId: pet.id, content: contentOf(pet), baseRow: pet, operationId: randomUUID() }, NOW), null);
    const conflict = { ...updateOp(pet, { name: 'X' }), status: 'conflict' };
    assert.deepEqual(applyPetEdit(conflict, { userId: USER_A, petId: pet.id, content: edit(pet, { name: 'Y' }), baseRow: pet, operationId: randomUUID() }, NOW), {
      rejected: 'not_editable',
    });
  });

  it('editar un alta sin confirmar cambia lo que se va a crear (misma clave de alta)', () => {
    const op = newOp();
    const edited = applyPetEdit(op, { userId: USER_A, petId: op.localId, content: { ...op.content, name: 'Otra' }, baseRow: null, operationId: randomUUID() }, NOW);
    assert.equal(edited.kind, 'create');
    assert.equal(edited.operationId, op.operationId);
    assert.equal(edited.content.name, 'Otra');
  });
});

describe('7. fusión a tres bandas', () => {
  const base = contentOf(makePet({ name: 'Luna', weight_kg: 4 }));

  it('cambios en campos distintos se combinan; en el mismo campo con valores distintos, conflicto', () => {
    const local = { ...base, name: 'Mía' };
    const remote = { ...base, weight_kg: 5 };
    assert.deepEqual(mergePetContent(base, local, remote), { merged: { ...base, name: 'Mía', weight_kg: 5 }, conflicts: [] });
    const both = mergePetContent(base, local, { ...base, name: 'Suya' });
    assert.deepEqual(both.conflicts, ['name']);
    // El mismo valor en los dos lados no es un conflicto.
    assert.deepEqual(mergePetContent(base, local, { ...base, name: 'Mía' }).conflicts, []);
  });

  it('especie y raza se deciden juntas (una raza es de una especie)', () => {
    const otherSpecies = randomUUID();
    const local = { ...base, species_id: otherSpecies, breed_status: null };
    const remote = { ...base, breed_status: 'mixed' };
    assert.deepEqual(mergePetContent(base, local, remote).conflicts, ['species']);
  });

  it('los textos nunca se unen: el usuario elige uno de los dos', () => {
    const local = { ...base, temperament_notes: 'tranquila' };
    const remote = { ...base, temperament_notes: 'nerviosa', weight_kg: 6 };
    const { merged, conflicts } = mergePetContent(base, local, remote);
    assert.deepEqual(conflicts, ['temperament_notes']);
    assert.equal(chooseContent(merged, local, remote, { temperament_notes: 'local' }).temperament_notes, 'tranquila');
    const theirs = chooseContent(merged, local, remote, { temperament_notes: 'remote' });
    assert.equal(theirs.temperament_notes, 'nerviosa');
    assert.equal(theirs.weight_kg, 6, 'lo que no choca se conserva');
  });

  it('decidir una edición que no se aplicó: ya está, sin permiso, se reaplica o conflicto', () => {
    const pet = makePet({ updated_at: at(1) });
    const op = updateOp(pet, { name: 'Mía' });
    assert.equal(reconcileEdit(op, { ...pet, name: 'Mía', updated_at: at(2) }, NOW).result, 'synced');
    assert.equal(reconcileEdit(op, null, NOW).result, 'forbidden');
    // Misma versión y 0 filas: lo filtró RLS (sin permiso de edición).
    assert.equal(reconcileEdit(op, pet, NOW).op.lastError.reason, 'not_editable');
    const rebased = reconcileEdit(op, { ...pet, weight_kg: 9, updated_at: at(3) }, NOW);
    assert.equal(rebased.result, 'rebase');
    assert.equal(rebased.op.baseRow.updated_at, at(3));
    assert.equal(rebased.op.content.weight_kg, 9);
    assert.equal(rebased.op.content.name, 'Mía');
    assert.equal(reconcileEdit(op, { ...pet, name: 'Suya', updated_at: at(3) }, NOW).result, 'conflict');
    // Una versión del servidor anterior a la base: no se puede demostrar cuál es la actual.
    assert.equal(reconcileEdit({ ...op, baseRow: { ...pet, updated_at: at(5) } }, { ...pet, weight_kg: 2, updated_at: at(4) }, NOW).result, 'conflict');
  });
});

describe('fallos', () => {
  const failure = (kind, policy) => ({ kind, policy, reason: kind, conflict: null });

  it('8. sin permiso → `forbidden`; datos rechazados → `failed`; red → sigue pendiente e incierta', () => {
    const op = { ...newOp(), inFlightSince: 900 };
    assert.equal(applyPetSyncFailure(op, failure('permission', 'give_up'), NOW).status, 'forbidden');
    assert.equal(applyPetSyncFailure(op, failure('validation', 'give_up'), NOW).status, 'failed');
    const offline = applyPetSyncFailure(op, failure('network', 'retry'), NOW);
    assert.equal(offline.status, 'pending');
    assert.equal(offline.inFlightSince, 900, 'sin respuesta: resultado incierto');
    assert.equal(offline.attempts, 0, 'la red no cuenta como intento');
    assert.equal(applyPetSyncFailure(op, failure('auth', 'wait_for_auth'), NOW).nextAttemptAt, null);
  });

  it('lo que salió sin respuesta no se descarta (podría estar aplicado)', () => {
    const op = newOp();
    assert.equal(canDiscardPetOperation(op), true);
    assert.equal(canDiscardPetOperation({ ...op, inFlightSince: 1 }), false);
    assert.equal(canDiscardPetOperation({ ...op, status: 'synced' }), false);
  });
});

describe('7. estados en la interfaz', () => {
  it('cada estado, con su texto (nunca solo color)', () => {
    const create = newOp();
    const update = updateOp(makePet(), { name: 'X' });
    assert.equal(petSyncDisplay(null, false), null);
    assert.equal(petSyncDisplay({ ...create, status: 'synced' }, false), null);
    assert.equal(petSyncDisplay(create, false), 'pending_create');
    assert.equal(petSyncDisplay(update, false), 'pending_update');
    assert.equal(petSyncDisplay(update, true), 'syncing');
    assert.equal(petSyncDisplay({ ...create, inFlightSince: 1 }, false), 'uncertain');
    assert.equal(petSyncDisplay({ ...update, status: 'conflict' }, false), 'conflict');
    assert.equal(petSyncDisplay({ ...update, status: 'failed' }, false), 'failed');
    assert.equal(petSyncDisplay({ ...update, status: 'forbidden' }, false), 'forbidden');
  });
});

describe('vistas con lo local encima', () => {
  it('1. el alta sin confirmar aparece como borrador (aparte), nunca como mascota del servidor', () => {
    const luna = makePet({ name: 'Luna' });
    const draft = newOp();
    const ops = [draft];
    const view = listWithLocalEdits({ state: 'ready', pets: [luna], source: 'server', stale: false, savedAt: null }, ops);
    assert.deepEqual(view.pets.map((pet) => pet.id), [luna.id]);
    const drafts = localDrafts(ops, null);
    assert.deepEqual(drafts.map((item) => [item.pet.id, item.display]), [[draft.localId, 'pending_create']]);
    assert.equal(localDrafts([{ ...draft, status: 'synced', petId: randomUUID() }], null).length, 0);
  });

  it('una mascota con edición pendiente se ve con lo local y su estado', () => {
    const luna = makePet({ name: 'Luna' });
    const op = updateOp(luna, { name: 'Luna (editada)' });
    const [item] = withLocalEdits([luna], [op], null);
    assert.equal(item.pet.name, 'Luna (editada)');
    assert.equal(item.pet.updated_at, luna.updated_at, 'los campos del servidor no se inventan');
    assert.equal(item.display, 'pending_update');
  });

  it('ficha de un id local: borrador, mapeo al id del servidor o descartado', () => {
    const op = newOp();
    const ok = (data) => ({ status: 'success', data, error: null });
    assert.equal(resolveLocalPetDetail(op.localId, ok([op])).state, 'ready');
    const remoteId = randomUUID();
    assert.deepEqual(resolveLocalPetDetail(op.localId, ok([{ ...op, status: 'synced', petId: remoteId }])), { state: 'redirect', petId: remoteId });
    assert.deepEqual(resolveLocalPetDetail(op.localId, ok([])), { state: 'not_found' });
    // Recién guardada y releyéndose: cargando, no «no existe».
    assert.deepEqual(resolveLocalPetDetail(op.localId, { ...ok([]), fetchStatus: 'fetching' }), { state: 'loading' });
    assert.equal(resolveLocalPetDetail(op.localId, { status: 'error', data: undefined, error: new Error('x') }).state, 'local_error');
  });

  it('fase 8.5: una edición de una mascota que ya no está en la lista se muestra aparte (no se oculta)', () => {
    const visible = makePet({ name: 'Visible' });
    const gone = makePet({ name: 'Sin acceso' });
    const ops = [updateOp(visible, { name: 'Visible 2' }), { ...updateOp(gone, { name: 'Mía' }), status: 'forbidden' }, newOp()];
    const orphans = orphanedEdits(ops, new Set([visible.id]), null);
    assert.deepEqual(orphans.map((item) => [item.pet.id, item.pet.name, item.display]), [[gone.id, 'Mía', 'forbidden']]);
    assert.deepEqual(orphanedEdits(ops, new Set([visible.id, gone.id]), null), []);
  });

  it('10. registros diarios: solo con id del servidor (nunca con un id temporal)', () => {
    assert.equal(canHaveDailyLogs(newOp().localId), false);
    assert.equal(canHaveDailyLogs(makePet().id), true);
  });
});
