// Pruebas de `pet-cache-repository.ts` (`npm test`): la copia de mascotas del dispositivo, sobre un
// almacenamiento en memoria que hace de disco (sobrevive a «reiniciar» creando otro repositorio).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createLocalStore } from '../../../lib/local-store/local-store.ts';
import { createMemoryStorage } from '../../../lib/local-store/memory-storage.ts';
import { createPetCacheRepository, PetCacheError } from './pet-cache-repository.ts';
import { at, device, makePet, USER_A, USER_B } from './pet-test-helpers.mjs';

const ids = (pets) => pets.map((pet) => pet.id);

describe('lista', () => {
  it('1. primera carga correcta: se guarda la lista (orden del servidor) y cada mascota', async () => {
    const { repository } = device();
    const repo = repository(USER_A);
    const luna = makePet({ name: 'Luna' });
    const kira = makePet({ name: 'Kira', created_at: at(5) });

    const shown = await repo.applyList(repo.beginRead(), [luna, kira]);
    assert.deepEqual(ids(shown), [luna.id, kira.id]);

    const list = await repo.readList();
    assert.equal(list.status, 'loaded');
    assert.deepEqual(list.pets, [luna, kira]);
    assert.match(list.savedAt, /^2026-10-20T12:00:\d\d\.000Z$/);
  });

  it('2. reabrir sin conexión (otro proceso sobre el mismo disco): la última lista guardada', async () => {
    const { repository } = device();
    const luna = makePet();
    const first = repository(USER_A);
    await first.applyList(first.beginRead(), [luna]);

    const afterRestart = repository(USER_A);
    const list = await afterRestart.readList();
    assert.deepEqual(list.pets, [luna]);
    assert.deepEqual((await afterRestart.readPet(luna.id)).pet, luna);
  });

  it('3. lista vacía confirmada por el servidor ≠ lista nunca cargada', async () => {
    const { repository } = device();
    const repo = repository(USER_A);
    assert.deepEqual(await repo.readList(), { status: 'never_loaded' });

    await repo.applyList(repo.beginRead(), []);
    const list = await repo.readList();
    assert.equal(list.status, 'loaded');
    assert.deepEqual(list.pets, []);
  });

  it('una lista vacía correcta sustituye a la anterior (sin borrar las copias de las mascotas)', async () => {
    const { repository, disk } = device();
    const repo = repository(USER_A);
    const luna = makePet();
    await repo.applyList(repo.beginRead(), [luna]);
    await repo.applyList(repo.beginRead(), []);
    assert.deepEqual((await repo.readList()).pets, []);
    assert.equal(disk.has(`kitom:v1:${USER_A}:pets:${luna.id}`), true);
  });

  it('una fila que no valida: no se guarda nada de esa respuesta (se devuelve tal cual)', async () => {
    const { repository } = device();
    const repo = repository(USER_A);
    const luna = makePet();
    await repo.applyList(repo.beginRead(), [luna]);
    const broken = { ...makePet(), name: 42 };
    const shown = await repo.applyList(repo.beginRead(), [broken]);
    assert.deepEqual(shown, [broken]);
    assert.deepEqual((await repo.readList()).pets, [luna]);
  });
});

describe('5. errores de lectura o validación del almacén: error recuperable, nunca «sin mascotas»', () => {
  const key = (name, id) => `kitom:v1:${USER_A}:${name}:${id}`;

  it('lista corrupta, de otra versión o ilegible', async () => {
    const { repository, disk } = device();
    const repo = repository(USER_A);

    disk.set(key('pets-list', 'current'), '{no es json');
    await assert.rejects(repo.readList(), (error) => error instanceof PetCacheError && error.reason === 'invalid_data');

    disk.set(key('pets-list', 'current'), JSON.stringify({ v: 1, data: { savedAt: 'x', petIds: [] } }));
    await assert.rejects(repo.readList(), { code: 'local_read_failed', reason: 'invalid_data' });

    disk.set(key('pets-list', 'current'), JSON.stringify({ v: 9, data: {} }));
    await assert.rejects(repo.readList(), { code: 'local_read_failed', reason: 'unknown_version' });
  });

  it('el proveedor falla al leer', async () => {
    const storage = createMemoryStorage();
    storage.getItem = async () => {
      throw new Error('disk');
    };
    const repo = createPetCacheRepository(createLocalStore(storage, USER_A));
    await assert.rejects(repo.readList(), { code: 'local_read_failed', reason: 'storage_failed' });
    await assert.rejects(repo.readPet(makePet().id), { code: 'local_read_failed', reason: 'storage_failed' });
  });

  it('una mascota de la lista sin copia legible: la lista no se muestra a medias', async () => {
    const { repository, disk } = device();
    const repo = repository(USER_A);
    const luna = makePet();
    const kira = makePet();
    await repo.applyList(repo.beginRead(), [luna, kira]);
    disk.set(key('pets', kira.id), JSON.stringify({ v: 1, data: { pet: { id: kira.id } } }));
    await assert.rejects(repository(USER_A).readList(), { reason: 'invalid_data' });
    await assert.rejects(repository(USER_A).readPet(kira.id), { reason: 'invalid_data' });
    disk.delete(key('pets', kira.id));
    await assert.rejects(repository(USER_A).readList(), { reason: 'missing_pet' });
  });

  it('la siguiente respuesta correcta del servidor repara lo ilegible', async () => {
    const { repository, disk } = device();
    const luna = makePet();
    disk.set(key('pets-list', 'current'), 'basura');
    disk.set(key('pets', luna.id), 'basura');
    const repo = repository(USER_A);
    await repo.applyList(repo.beginRead(), [luna]);
    assert.deepEqual((await repo.readList()).pets, [luna]);
  });
});

describe('6. ficha', () => {
  it('guardada al leerla: disponible después; nunca guardada: `null` (no «no existe»)', async () => {
    const { repository } = device();
    const repo = repository(USER_A);
    const luna = makePet();
    assert.equal(await repo.readPet(luna.id), null);
    assert.deepEqual(await repo.applyPet(repo.beginRead(), luna.id, luna), luna);
    const snapshot = await repository(USER_A).readPet(luna.id);
    assert.deepEqual(snapshot.pet, luna);
    assert.equal(snapshot.unavailableAt, null);
  });

  it('un id que no es un UUID no toca el almacén', async () => {
    const { repository, disk } = device();
    const repo = repository(USER_A);
    assert.equal(await repo.applyPet(repo.beginRead(), 'abc:def', null), null);
    assert.equal(await repo.readPet('../x'), null);
    assert.equal(disk.size, 0);
  });

  it('una fila de otra mascota no se guarda bajo esta clave', async () => {
    const { repository } = device();
    const repo = repository(USER_A);
    const luna = makePet();
    const other = makePet();
    await repo.applyPet(repo.beginRead(), luna.id, other);
    assert.equal(await repo.readPet(luna.id), null);
  });
});

describe('7. respuestas fuera de orden', () => {
  it('una lista que llega tarde no hace retroceder datos ni la lista', async () => {
    const { repository } = device();
    const repo = repository(USER_A);
    const luna = makePet({ updated_at: at(1) });
    const kira = makePet();
    const early = repo.beginRead();
    const late = repo.beginRead();

    // La segunda lectura responde primero: Luna editada, Kira ya no se ve.
    await repo.applyList(late, [{ ...luna, name: 'Luna 2', updated_at: at(2) }]);
    const shown = await repo.applyList(early, [luna, kira]);

    assert.deepEqual(shown.map((pet) => pet.name), ['Luna 2']);
    const list = await repo.readList();
    assert.deepEqual(list.pets.map((pet) => pet.name), ['Luna 2']);
    assert.notEqual((await repo.readPet(kira.id))?.unavailableAt ?? 'sin copia', null);
  });

  it('con marca posterior pero `updated_at` anterior: la visibilidad sí, los datos no retroceden', async () => {
    const { repository } = device();
    const repo = repository(USER_A);
    const luna = makePet({ name: 'Nueva', updated_at: at(9) });
    await repo.applyPet(repo.beginRead(), luna.id, luna);
    const shown = await repo.applyList(repo.beginRead(), [{ ...luna, name: 'Vieja', updated_at: at(3) }]);
    assert.equal(shown[0].name, 'Nueva');
    assert.equal((await repo.readPet(luna.id)).pet.name, 'Nueva');
  });

  it('una lectura tardía con datos estrictamente más nuevos sí se acepta', async () => {
    const { repository } = device();
    const repo = repository(USER_A);
    const luna = makePet({ updated_at: at(1) });
    const early = repo.beginRead();
    await repo.applyPet(repo.beginRead(), luna.id, luna);
    assert.equal((await repo.applyPet(early, luna.id, { ...luna, name: 'Más nueva', updated_at: at(2) })).name, 'Más nueva');
  });

  it('una ausencia tardía no oculta una mascota que una lectura posterior vio; ni al revés', async () => {
    const { repository } = device();
    const repo = repository(USER_A);
    const luna = makePet();
    const early = repo.beginRead();
    await repo.applyPet(repo.beginRead(), luna.id, luna);
    assert.deepEqual(await repo.applyPet(early, luna.id, null), luna);
    assert.equal((await repo.readPet(luna.id)).unavailableAt, null);

    const before = repo.beginRead();
    await repo.applyPet(repo.beginRead(), luna.id, null);
    assert.equal(await repo.applyPet(before, luna.id, { ...luna, updated_at: at(30) }), null);
    assert.notEqual((await repo.readPet(luna.id)).unavailableAt, null);
  });

  it('una lista iniciada antes de crear una mascota no la quita de la lista guardada', async () => {
    const { repository } = device();
    const repo = repository(USER_A);
    const luna = makePet();
    await repo.applyList(repo.beginRead(), [luna]);
    const listRead = repo.beginRead();
    const created = makePet({ name: 'Nueva' });
    await repo.applyPet(repo.beginRead(), created.id, created);
    const shown = await repo.applyList(listRead, [luna]);
    assert.deepEqual(ids(shown), [luna.id, created.id]);
    assert.deepEqual(ids((await repo.readList()).pets), [luna.id, created.id]);
  });
});

describe('11. mascota que deja de ser visible en el servidor', () => {
  it('sale de la lista, pero su copia se conserva con `unavailableAt` (nada se borra)', async () => {
    const { repository, disk } = device();
    const repo = repository(USER_A);
    const luna = makePet();
    const kira = makePet();
    await repo.applyList(repo.beginRead(), [luna, kira]);
    await repo.applyList(repo.beginRead(), [luna]);

    assert.deepEqual(ids((await repo.readList()).pets), [luna.id]);
    const snapshot = await repository(USER_A).readPet(kira.id);
    assert.deepEqual(snapshot.pet, kira);
    assert.match(snapshot.unavailableAt, /^2026-10-20T/);
    assert.equal(disk.has(`kitom:v1:${USER_A}:pets:${kira.id}`), true);
  });

  it('la ficha que responde «no existe» también: sale de la lista guardada y conserva la copia', async () => {
    const { repository } = device();
    const repo = repository(USER_A);
    const luna = makePet();
    await repo.applyList(repo.beginRead(), [luna]);
    assert.equal(await repo.applyPet(repo.beginRead(), luna.id, null), null);
    assert.deepEqual((await repo.readList()).pets, []);
    assert.deepEqual((await repo.readPet(luna.id)).pet, luna);
  });

  it('si vuelve a ser visible, vuelve a la lista', async () => {
    const { repository } = device();
    const repo = repository(USER_A);
    const luna = makePet();
    await repo.applyList(repo.beginRead(), [luna]);
    await repo.applyList(repo.beginRead(), []);
    await repo.applyList(repo.beginRead(), [luna]);
    assert.deepEqual((await repo.readList()).pets, [luna]);
    assert.equal((await repo.readPet(luna.id)).unavailableAt, null);
  });
});

it('13. `photo_path` se conserva en la copia (mostrar la foto nunca lo cambia)', async () => {
  const { repository } = device();
  const repo = repository(USER_A);
  const luna = makePet();
  const withPhoto = { ...luna, photo_path: `${luna.id}/0b8c2d55-9a11-4f0e-8a51-0d1f3a7c9e10.jpg` };
  await repo.applyList(repo.beginRead(), [withPhoto]);
  assert.equal((await repository(USER_A).readPet(luna.id)).pet.photo_path, withPhoto.photo_path);
  assert.equal((await repository(USER_A).readList()).pets[0].photo_path, withPhoto.photo_path);
});

describe('14. aislamiento entre usuarios del mismo dispositivo', () => {
  it('cada cuenta ve solo su copia; usar otra cuenta no borra la de la primera', async () => {
    const { repository, disk } = device();
    const a = repository(USER_A);
    const lunaA = makePet();
    await a.applyList(a.beginRead(), [lunaA]);

    const b = repository(USER_B);
    assert.deepEqual(await b.readList(), { status: 'never_loaded' });
    assert.equal(await b.readPet(lunaA.id), null);
    const kiraB = makePet({ owner_id: USER_B });
    await b.applyList(b.beginRead(), [kiraB]);

    assert.deepEqual((await repository(USER_A).readList()).pets, [lunaA]);
    assert.deepEqual((await repository(USER_B).readList()).pets, [kiraB]);
    for (const key of disk.keys()) assert.match(key, new RegExp(`^kitom:v1:(${USER_A}|${USER_B}):`));
  });
});

describe('escrituras de mejor esfuerzo', () => {
  it('si el dispositivo no puede guardar, lo aceptado sigue ordenando las respuestas en memoria', async () => {
    const storage = createMemoryStorage();
    const repo = createPetCacheRepository(createLocalStore(storage, USER_A));
    storage.setItem = async () => {
      throw new Error('disk full');
    };
    const luna = makePet({ updated_at: at(1) });
    const early = repo.beginRead();
    assert.equal((await repo.applyList(repo.beginRead(), [{ ...luna, name: 'Nueva', updated_at: at(2) }]))[0].name, 'Nueva');
    assert.equal((await repo.applyList(early, [luna]))[0].name, 'Nueva');
    assert.deepEqual(await repo.readList(), { status: 'never_loaded' });
  });
});
