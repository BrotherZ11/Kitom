// Pruebas del ciclo de vida de las fotos (fase 10, `npm test`): `pet-photo-ops.ts` con un Storage y una
// tabla `pets` falsos (precondición sobre `photo_path`, respuestas perdidas, red cortada, permisos) y el
// diario del dispositivo (`offline/pet-photo-journal.ts`) sobre un disco en memoria que sobrevive a
// «reiniciar». El bucket no existe en el Supabase local: Storage solo se prueba aquí.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { createLocalStore } from '../../lib/local-store/local-store.ts';
import { createMemoryStorage } from '../../lib/local-store/memory-storage.ts';
import { createPetPhotoJournal, photoObjectId } from './offline/pet-photo-journal.ts';
import { makePet, USER_A, USER_B } from './offline/pet-test-helpers.mjs';
import { PhotoOpError, processPhotoJournal, removePetPhotoSafely, replacePetPhoto } from './pet-photo-ops.ts';

const NETWORK = { message: 'TypeError: Network request failed' };

/**
 * Storage + `pets` falsos. `photoPath` por mascota; `objects`: rutas que existen. `loseNext(op)`: la
 * siguiente operación de ese tipo se aplica pero la respuesta se pierde; `dropNext(op)`: la petición no
 * llega (sin respuesta, no se aplica). `editable`/`visible` hacen de RLS y de las políticas de Storage.
 */
function fakeBackend() {
  const state = { objects: new Set(), photoPath: new Map(), editable: new Set(), visible: new Set(), online: true, lose: new Set(), drop: new Set(), calls: [] };
  const network = () => ({ ok: false, error: NETWORK, status: null });
  const run = (op, apply) => {
    state.calls.push(op);
    if (!state.online || state.drop.delete(op)) return network();
    const result = apply();
    return state.lose.delete(op) ? network() : result;
  };
  const row = (petId) => makePet({ id: petId, photo_path: state.photoPath.get(petId) ?? null });
  return {
    state,
    addPet(petId, photoPath = null) {
      state.visible.add(petId);
      state.editable.add(petId);
      state.photoPath.set(petId, photoPath);
      if (photoPath) state.objects.add(photoPath);
    },
    remote: {
      upload: async (path) => run('upload', () => {
        const petId = path.split('/')[0];
        if (!state.editable.has(petId)) return { ok: false, error: { message: 'row-level security' }, status: 403 };
        state.objects.add(path);
        return { ok: true, data: undefined };
      }),
      setPhotoPath: async (petId, next, expected) => run('setPhotoPath', () => {
        if (!state.editable.has(petId) || (state.photoPath.get(petId) ?? null) !== expected) return { ok: true, data: null };
        state.photoPath.set(petId, next);
        return { ok: true, data: row(petId) };
      }),
      fetchPhotoPath: async (petId) => run('fetchPhotoPath', () => ({
        ok: true,
        data: state.visible.has(petId) ? { photo_path: state.photoPath.get(petId) ?? null } : null,
      })),
      canEdit: async (petId) => run('canEdit', () => ({ ok: true, data: state.editable.has(petId) })),
      remove: async (path) => run('remove', () => {
        const petId = path.split('/')[0];
        if (!state.editable.has(petId) || !state.objects.has(path)) return { ok: true, data: 0 };
        state.objects.delete(path);
        return { ok: true, data: 1 };
      }),
    },
  };
}

/** Un dispositivo del usuario: diario en un disco compartido y reloj controlable. */
function photoDevice(backend, { disk = new Map(), userId = USER_A, clock = { now: 1_000_000 } } = {}) {
  const storage = createMemoryStorage(disk);
  return {
    disk,
    clock,
    deps: {
      remote: backend.remote,
      journal: createPetPhotoJournal(createLocalStore(storage, userId)),
      now: () => clock.now,
      createId: randomUUID,
      active: new Set(),
    },
    storage,
  };
}

const bytes = new ArrayBuffer(8);
const replace = (deps, petId, previousPath) => replacePetPhoto(deps, { petId, previousPath, bytes, contentType: 'image/jpeg' });
const later = (device, ms = 61_000) => (device.clock.now += ms);
const journalPass = (device, extra = {}) => processPhotoJournal({ ...device.deps, canRun: () => true, ...extra });
const code = (expected) => (error) => error instanceof PhotoOpError && error.code === expected;

describe('subir, reemplazar y quitar', () => {
  it('12. primera foto: el objeto queda referenciado y el diario vacío', async () => {
    const backend = fakeBackend();
    const petId = randomUUID();
    backend.addPet(petId);
    const device = photoDevice(backend);
    const pet = await replace(device.deps, petId, null);
    assert.equal(photoObjectId(petId, pet.photo_path) !== null, true);
    assert.deepEqual([...backend.state.objects], [pet.photo_path]);
    assert.deepEqual(await device.deps.journal.list(), []);
  });

  it('12. reemplazo: la anterior se borra solo tras confirmar el cambio', async () => {
    const backend = fakeBackend();
    const petId = randomUUID();
    const old = `${petId}/${randomUUID()}.jpg`;
    backend.addPet(petId, old);
    const device = photoDevice(backend);
    const pet = await replace(device.deps, petId, old);
    assert.deepEqual([...backend.state.objects], [pet.photo_path]);
    assert.equal(backend.state.calls.indexOf('remove') > backend.state.calls.indexOf('setPhotoPath'), true);
    assert.deepEqual(await device.deps.journal.list(), []);
  });

  it('12/13. se pierde la respuesta del cambio de referencia: la foto nueva NO se borra (está en uso) y el diario lo resuelve', async () => {
    const backend = fakeBackend();
    const petId = randomUUID();
    const old = `${petId}/${randomUUID()}.jpg`;
    backend.addPet(petId, old);
    const device = photoDevice(backend);
    backend.state.lose.add('setPhotoPath');
    await assert.rejects(replace(device.deps, petId, old), code('unconfirmed'));
    const current = backend.state.photoPath.get(petId);
    assert.notEqual(current, old, 'el servidor sí aplicó el cambio');
    assert.ok(backend.state.objects.has(current), 'la foto referenciada sigue existiendo');
    assert.ok(backend.state.objects.has(old), 'la anterior tampoco se borra aún');

    // Reinicio con conexión, pasado el tiempo mínimo.
    const reopened = photoDevice(backend, { disk: device.disk, clock: device.clock });
    later(reopened);
    const pass = await journalPass(reopened);
    assert.deepEqual(pass, { resolved: 2, blocked: 0, kept: 0, stopped: false });
    assert.ok(backend.state.objects.has(current), 'en uso: se conserva');
    assert.deepEqual(await reopened.deps.journal.list(), []);
    assert.equal(backend.state.objects.has(old), false, 'la anterior, ya sin referencias, se borra');
  });

  it('13. la petición de referencia no llega: la foto nueva queda huérfana y el diario la borra al volver', async () => {
    const backend = fakeBackend();
    const petId = randomUUID();
    backend.addPet(petId);
    const device = photoDevice(backend);
    backend.state.drop.add('setPhotoPath');
    await assert.rejects(replace(device.deps, petId, null), code('unconfirmed'));
    const [orphan] = [...backend.state.objects];
    assert.equal(backend.state.photoPath.get(petId), null);

    assert.deepEqual(await journalPass(device), { resolved: 0, blocked: 0, kept: 1, stopped: false }, 'antes del tiempo mínimo no se toca');
    later(device);
    await journalPass(device);
    assert.equal(backend.state.objects.has(orphan), false);
    assert.deepEqual(await device.deps.journal.list(), []);
  });

  it('13. la app se cierra entre subir y referenciar: tras reiniciar, el objeto anotado se borra', async () => {
    const backend = fakeBackend();
    const petId = randomUUID();
    backend.addPet(petId);
    const device = photoDevice(backend);
    // La subida «cuelga» la app justo después de crear el objeto.
    const originalSet = backend.remote.setPhotoPath;
    backend.remote.setPhotoPath = () => new Promise(() => {});
    void replace(device.deps, petId, null);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(backend.state.objects.size, 1);
    backend.remote.setPhotoPath = originalSet;

    const reopened = photoDevice(backend, { disk: device.disk, clock: device.clock });
    later(reopened);
    await journalPass(reopened);
    assert.equal(backend.state.objects.size, 0);
  });

  it('13. falla el borrado de la anterior: se conserva anotada y se borra en la siguiente pasada', async () => {
    const backend = fakeBackend();
    const petId = randomUUID();
    const old = `${petId}/${randomUUID()}.jpg`;
    backend.addPet(petId, old);
    const device = photoDevice(backend);
    backend.state.drop.add('remove');
    const pet = await replace(device.deps, petId, old);
    assert.ok(backend.state.objects.has(old));
    assert.deepEqual((await device.deps.journal.list()).map((item) => [item.path, item.reason]), [[old, 'replaced']]);
    later(device);
    await journalPass(device);
    assert.deepEqual([...backend.state.objects], [pet.photo_path]);
  });

  it('otro dispositivo cambió la foto antes: `photo_changed`, su foto no se toca y la subida propia se retira', async () => {
    const backend = fakeBackend();
    const petId = randomUUID();
    const old = `${petId}/${randomUUID()}.jpg`;
    const theirs = `${petId}/${randomUUID()}.jpg`;
    backend.addPet(petId, old);
    backend.state.photoPath.set(petId, theirs);
    backend.state.objects.add(theirs);
    const device = photoDevice(backend);
    await assert.rejects(replace(device.deps, petId, old), code('photo_changed'));
    assert.equal(backend.state.photoPath.get(petId), theirs, 'una respuesta tardía no pisa la foto de otro');
    assert.ok(backend.state.objects.has(theirs));
    assert.ok(backend.state.objects.has(old), 'la anterior no se borra: este dispositivo no la retiró');
    assert.equal(backend.state.objects.size, 2, 'la subida propia se borró');
    assert.deepEqual(await device.deps.journal.list(), []);
  });

  it('quitar la foto: referencia primero y objeto después; con un cambio de otro dispositivo no se quita la suya', async () => {
    const backend = fakeBackend();
    const petId = randomUUID();
    const mine = `${petId}/${randomUUID()}.jpg`;
    backend.addPet(petId, mine);
    const device = photoDevice(backend);
    const pet = await removePetPhotoSafely(device.deps, { petId, photoPath: mine });
    assert.equal(pet.photo_path, null);
    assert.equal(backend.state.objects.size, 0);

    const shown = `${petId}/${randomUUID()}.jpg`;
    const theirs = `${petId}/${randomUUID()}.jpg`;
    backend.state.objects.add(shown).add(theirs);
    backend.state.photoPath.set(petId, theirs);
    await assert.rejects(removePetPhotoSafely(device.deps, { petId, photoPath: shown }), code('photo_changed'));
    assert.equal(backend.state.photoPath.get(petId), theirs);
    assert.ok(backend.state.objects.has(theirs), 'la foto actual no se toca');
    assert.equal(backend.state.objects.has(shown), false, 'la que se quería quitar ya no la usa nadie');
  });

  it('quitar sin permiso: la referencia y el objeto se conservan', async () => {
    const backend = fakeBackend();
    const petId = randomUUID();
    const photo = `${petId}/${randomUUID()}.jpg`;
    backend.addPet(petId, photo);
    backend.state.editable.delete(petId);
    const device = photoDevice(backend);
    await assert.rejects(removePetPhotoSafely(device.deps, { petId, photoPath: photo }), code('not_allowed'));
    assert.equal(backend.state.photoPath.get(petId), photo);
    assert.ok(backend.state.objects.has(photo));
    assert.deepEqual(await device.deps.journal.list(), []);
  });

  it('quitar sin respuesta: el objeto se conserva hasta comprobar si la referencia se quitó', async () => {
    const backend = fakeBackend();
    const petId = randomUUID();
    const photo = `${petId}/${randomUUID()}.jpg`;
    backend.addPet(petId, photo);
    const device = photoDevice(backend);
    backend.state.drop.add('setPhotoPath');
    await assert.rejects(removePetPhotoSafely(device.deps, { petId, photoPath: photo }), code('unconfirmed'));
    assert.ok(backend.state.objects.has(photo));
    later(device);
    await journalPass(device);
    assert.ok(backend.state.objects.has(photo), 'sigue siendo la foto: no se borra');
    assert.deepEqual(await device.deps.journal.list(), [], 'y la entrada se cierra');
  });

  it('una subida rechazada con respuesta no deja nada que limpiar; sin poder anotarla, no se sube', async () => {
    const backend = fakeBackend();
    const petId = randomUUID();
    backend.addPet(petId);
    backend.state.editable.delete(petId);
    const device = photoDevice(backend);
    await assert.rejects(replace(device.deps, petId, null), code('upload_failed'));
    assert.deepEqual(await device.deps.journal.list(), []);

    backend.state.editable.add(petId);
    device.storage.setItem = async () => {
      throw new Error('disk full');
    };
    await assert.rejects(replace(device.deps, petId, null), code('local_failed'));
    assert.equal(backend.state.calls.filter((call) => call === 'upload').length, 1, 'no se subió');
  });
});

describe('diario de fotos', () => {
  it('nunca toca lo que no anotó (p. ej. fotos de consultas en la misma carpeta) ni lo que está en uso', async () => {
    const backend = fakeBackend();
    const petId = randomUUID();
    const profile = `${petId}/${randomUUID()}.jpg`;
    const consult = `${petId}/${randomUUID()}.jpg`;
    backend.addPet(petId, profile);
    backend.state.objects.add(consult);
    const device = photoDevice(backend);
    await device.deps.journal.put({ userId: USER_A, petId, path: profile, reason: 'uploaded', status: 'pending', createdAt: 0, checkedAt: null, blockedReason: null });
    later(device);
    await journalPass(device);
    assert.ok(backend.state.objects.has(profile));
    assert.ok(backend.state.objects.has(consult));
  });

  it('mascota eliminada o sin acceso: queda bloqueada (no se reintenta) y no se pierde', async () => {
    const backend = fakeBackend();
    const petId = randomUUID();
    const path = `${petId}/${randomUUID()}.jpg`;
    backend.state.objects.add(path);
    const device = photoDevice(backend);
    await device.deps.journal.put({ userId: USER_A, petId, path, reason: 'replaced', status: 'pending', createdAt: 0, checkedAt: null, blockedReason: null });
    later(device);
    assert.deepEqual(await journalPass(device), { resolved: 0, blocked: 1, kept: 0, stopped: false });
    const [entry] = await device.deps.journal.list();
    assert.deepEqual([entry.status, entry.blockedReason], ['blocked', 'pet_unavailable']);
    const before = backend.state.calls.length;
    await journalPass(device);
    assert.equal(backend.state.calls.length, before, 'no se vuelve a pedir');
    assert.ok(backend.state.objects.has(path));
  });

  it('sin conexión, con una operación en curso o con otra cuenta: no cambia nada', async () => {
    const backend = fakeBackend();
    const petId = randomUUID();
    const path = `${petId}/${randomUUID()}.jpg`;
    backend.addPet(petId);
    backend.state.objects.add(path);
    const device = photoDevice(backend);
    const item = { userId: USER_A, petId, path, reason: 'uploaded', status: 'pending', createdAt: 0, checkedAt: null, blockedReason: null };
    await device.deps.journal.put(item);
    later(device);

    backend.state.online = false;
    assert.equal((await journalPass(device)).stopped, true);
    backend.state.online = true;
    assert.equal((await journalPass(device, { canRun: () => false })).stopped, true);
    device.deps.active.add(path);
    assert.equal((await journalPass(device)).kept, 1);
    assert.ok(backend.state.objects.has(path));
    device.deps.active.delete(path);
    await journalPass(device);
    assert.equal(backend.state.objects.has(path), false);
  });

  it('15. cada cuenta tiene su diario', async () => {
    const backend = fakeBackend();
    const petId = randomUUID();
    const disk = new Map();
    const a = photoDevice(backend, { disk });
    const b = photoDevice(backend, { disk, userId: USER_B });
    await a.deps.journal.put({ userId: USER_A, petId, path: `${petId}/${randomUUID()}.jpg`, reason: 'uploaded', status: 'pending', createdAt: 0, checkedAt: null, blockedReason: null });
    assert.equal((await a.deps.journal.list()).length, 1);
    assert.deepEqual(await b.deps.journal.list(), []);
  });

  it('una entrada con una ruta de otra mascota o con otra forma no es válida', async () => {
    const petId = randomUUID();
    assert.equal(photoObjectId(petId, `${randomUUID()}/${randomUUID()}.jpg`), null);
    assert.equal(photoObjectId(petId, `${petId}/sub/${randomUUID()}.jpg`), null);
    assert.equal(photoObjectId(petId, `${petId}/foto.jpg`), null);
  });
});
