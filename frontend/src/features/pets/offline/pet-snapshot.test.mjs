// Pruebas de `pet-snapshot.ts` (`npm test`): qué se guarda de una mascota y cómo se valida al leer.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createLocalStore } from '../../../lib/local-store/local-store.ts';
import { createMemoryStorage } from '../../../lib/local-store/memory-storage.ts';
import { PET_LIST_ID, PET_LIST_SNAPSHOT, PET_SNAPSHOTS, toCachedPet } from './pet-snapshot.ts';
import { makePet, USER_A } from './pet-test-helpers.mjs';

describe('toCachedPet', () => {
  it('copia exactamente las columnas que lee la app (nada de más)', () => {
    const pet = makePet();
    const cached = toCachedPet({ ...pet, signed_url: 'https://x/y?token=secret', access_token: 'jwt', can_edit: true });
    assert.deepEqual(cached, pet);
    assert.equal('signed_url' in cached, false);
    assert.equal('access_token' in cached, false);
    assert.equal('can_edit' in cached, false);
  });

  it('rechaza filas incompletas o con tipos inesperados', () => {
    const { name, ...withoutName } = makePet();
    assert.equal(name, 'Luna');
    assert.equal(toCachedPet(withoutName), null);
    assert.equal(toCachedPet(makePet({ id: 'no-es-uuid' })), null);
    assert.equal(toCachedPet(makePet({ weight_kg: '4' })), null);
    assert.equal(toCachedPet(makePet({ sex: 'otro' })), null);
    assert.equal(toCachedPet(makePet({ allergies: [1] })), null);
    assert.equal(toCachedPet(makePet({ updated_at: 'ayer' })), null);
    assert.equal(toCachedPet(null), null);
    assert.equal(toCachedPet([makePet()]), null);
  });

  it('13. `photo_path` es un path de Storage, nunca una URL (firmada o no)', () => {
    const path = `${makePet().id}/0b8c2d55-9a11-4f0e-8a51-0d1f3a7c9e10.jpg`;
    assert.equal(toCachedPet(makePet({ photo_path: path })).photo_path, path);
    assert.equal(toCachedPet(makePet({ photo_path: 'https://x.supabase.co/storage/v1/object/sign/a.jpg?token=t' })), null);
    assert.equal(toCachedPet(makePet({ photo_path: '' })), null);
  });
});

describe('colecciones en LocalStore', () => {
  it('versionadas y validadas al leer; una copia movida de clave no vale', async () => {
    const disk = new Map();
    const store = createLocalStore(createMemoryStorage(disk), USER_A);
    const pet = makePet();
    const snapshot = { pet, savedAt: '2026-10-20T12:00:00.000Z', unavailableAt: null };
    await store.write(PET_SNAPSHOTS, [pet.id], snapshot);
    assert.deepEqual(await store.read(PET_SNAPSHOTS, [pet.id]), { status: 'found', value: snapshot });
    assert.deepEqual([...disk.keys()], [`kitom:v1:${USER_A}:pets:${pet.id}`]);
    assert.equal(JSON.parse(disk.get(`kitom:v1:${USER_A}:pets:${pet.id}`)).v, 1);

    const other = makePet();
    disk.set(`kitom:v1:${USER_A}:pets:${other.id}`, disk.get(`kitom:v1:${USER_A}:pets:${pet.id}`));
    assert.deepEqual(await store.read(PET_SNAPSHOTS, [other.id]), { status: 'corrupt', reason: 'key_mismatch' });
  });

  it('la lista: ids únicos y válidos; `[]` es una lista vacía confirmada', async () => {
    const store = createLocalStore(createMemoryStorage(), USER_A);
    const empty = { savedAt: '2026-10-20T12:00:00.000Z', petIds: [] };
    await store.write(PET_LIST_SNAPSHOT, PET_LIST_ID, empty);
    assert.deepEqual(await store.read(PET_LIST_SNAPSHOT, PET_LIST_ID), { status: 'found', value: empty });
    const id = makePet().id;
    await assert.rejects(store.write(PET_LIST_SNAPSHOT, PET_LIST_ID, { savedAt: empty.savedAt, petIds: [id, id] }), {
      code: 'invalid_value',
    });
    await assert.rejects(store.write(PET_LIST_SNAPSHOT, PET_LIST_ID, { savedAt: empty.savedAt }), { code: 'invalid_value' });
  });
});
