// Fase 10 contra el Supabase LOCAL: eliminación de mascotas guardada en el dispositivo y enviada por el
// motor, con Auth, RLS (`pets: delete owner`), la precondición `updated_at` y la cascada reales, y la
// precondición sobre `photo_path` de las fotos (solo la base de datos: el bucket no existe en local).
// `npm run test:integration`; en `npm test` se omiten. Nunca contra `kitom-dev`.
//
// Crean usuarios `it-…@kitom.test` (quedan en el Auth local) y mascotas que se borran al terminar.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import { createClient } from '@supabase/supabase-js';

import { createOwnerAccessToken } from '../../auth/owner-session.ts';
import { contentToSaveArgs } from '../../daily-logs/offline/daily-log-content.ts';
import { createDailyLogRemote } from '../../daily-logs/offline/daily-log-remote.ts';
import { createLocalStore } from '../../../lib/local-store/local-store.ts';
import { createMemoryStorage } from '../../../lib/local-store/memory-storage.ts';
import { createPetPhotoRemote } from '../api/pet-photos-remote.ts';
import { createPetReads } from '../api/pets-remote.ts';
import { createPetWritesRemote } from '../api/pet-writes-remote.ts';
import { createPetCacheRepository } from './pet-cache-repository.ts';
import { createPetOperationRepository } from './pet-operation-repository.ts';
import { summarizePetOperations } from './pet-operation.ts';
import { createPetSyncEngine } from './pet-sync-engine.ts';
import { withLocalEdits } from './pet-write-view.ts';

const URL_ = process.env.KITOM_IT_SUPABASE_URL;
const ANON_KEY = process.env.KITOM_IT_SUPABASE_ANON_KEY;
const isLocal = URL_ !== undefined && ['127.0.0.1', 'localhost'].includes(new URL(URL_).hostname);
const skip = !URL_ || !ANON_KEY ? 'sin Supabase local (npm run test:integration)' : !isLocal ? 'la URL no es local' : false;

const authOptions = { persistSession: false, autoRefreshToken: false };
const PET_COLUMNS =
  'id, owner_id, name, species_id, sex, breed, breed_id, breed_status, birth_date, weight_kg, sterilized, known_conditions, allergies, temperament_notes, photo_path, is_active, created_at, updated_at';

async function signUp() {
  const supabase = createClient(URL_, ANON_KEY, { auth: authOptions });
  const email = `it-${randomUUID()}@kitom.test`;
  const password = `It-${randomUUID()}`;
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error || !data.session) throw error ?? new Error('El Auth local exige confirmar el email');
  return { supabase, userId: data.user.id, email, password };
}

/**
 * La app en un dispositivo: un cliente con red que se puede cortar, un registro de las peticiones a
 * `pets` (método) y respuestas de altas o borrados que se pueden perder (se aplican, pero no vuelven).
 */
function app(user, disk = new Map()) {
  const net = { online: true };
  const requests = [];
  const lose = new Set();
  const fetch_ = async (input, init) => {
    if (!net.online) throw new TypeError('Network request failed');
    const url = String(input instanceof Request ? input.url : input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = new URL(url).pathname;
    if (path === '/rest/v1/pets') requests.push(method);
    const response = await fetch(input, init);
    if (path === '/rest/v1/pets' && lose.delete(method)) throw new TypeError('Network request failed');
    return response;
  };
  const supabase = createClient(URL_, ANON_KEY, { auth: authOptions, global: { fetch: fetch_ } });
  const storage = createMemoryStorage(disk);
  const operations = createPetOperationRepository(createLocalStore(storage, user.userId));
  const cache = createPetCacheRepository(createLocalStore(storage, user.userId));
  const accessToken = createOwnerAccessToken(supabase.auth, user.userId);
  const engine = createPetSyncEngine({
    operations,
    cache,
    remote: createPetWritesRemote(supabase, { ownerUserId: user.userId, accessToken, timeoutMs: 5_000 }),
    isOnline: () => net.online,
    now: Date.now,
    createOperationId: randomUUID,
    random: () => 0,
  });
  return {
    net,
    requests,
    disk,
    supabase,
    operations,
    cache,
    engine,
    reads: createPetReads(supabase, { accessToken }),
    loseNext: (method) => lose.add(method),
    async signIn() {
      const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: user.password });
      if (error) throw error;
      engine.start();
      engine.setSessionUserId(user.userId);
      return this;
    },
  };
}

describe('Pets: eliminación sin conexión contra el Supabase local', { skip }, () => {
  let userA;
  let userB;
  let speciesId;
  const cleanup = [];

  const insertPet = async (user, name) => {
    const { data, error } = await user.supabase
      .from('pets')
      .insert({ owner_id: user.userId, name, species_id: speciesId })
      .select(PET_COLUMNS)
      .single();
    if (error) throw error;
    cleanup.push([user, data.id]);
    return data;
  };
  const exists = async (user, petId) => {
    const { data, error } = await user.supabase.from('pets').select('id').eq('id', petId);
    if (error) throw error;
    return data.length === 1;
  };

  before(async () => {
    userA = await signUp();
    userB = await signUp();
    const { data } = await userA.supabase.from('species').select('id').eq('is_active', true).limit(1).single();
    speciesId = data.id;
  });

  after(async () => {
    for (const [user, petId] of cleanup) await user.supabase.from('pets').delete().eq('id', petId);
  });

  it('4/11. sin conexión, reiniciar y sincronizar: se borra con precondición y en cascada (registros incluidos)', async () => {
    const pet = await insertPet(userA, 'Borrar');
    const device = await app(userA).signIn();
    const logs = createDailyLogRemote(device.supabase, { accessToken: createOwnerAccessToken(device.supabase.auth, userA.userId) });
    const saved = await logs.save({
      ...contentToSaveArgs(pet.id, new Date().toISOString().slice(0, 10), {
        energy_level: 3,
        appetite_level: null,
        mood_level: null,
        activity_level: null,
        sleep_quality: null,
        vocalization_level: null,
        social_interaction_level: null,
        unusual_behavior: false,
        unusual_behavior_notes: null,
        notes: null,
        tags: [],
      }),
      p_expect_absent: true,
    });
    assert.equal(saved.ok, true);

    device.net.online = false;
    assert.equal((await device.engine.requestDelete(pet.id, pet)).result, 'saved');
    assert.deepEqual(device.requests, [], 'sin conexión no sale nada');

    const reopened = await app(userA, device.disk).signIn();
    await reopened.engine.requestSync();
    assert.equal(await exists(userA, pet.id), false);
    assert.equal((await reopened.operations.read(pet.id)).status, 'synced');
    const { data: remaining } = await userA.supabase.from('daily_logs').select('id').eq('pet_id', pet.id);
    assert.deepEqual(remaining, [], 'cascada de la base de datos');
  });

  it('8. cambiada en otro dispositivo antes del borrado: 0 filas reales → conflicto, la mascota sigue', async () => {
    const pet = await insertPet(userA, 'Base');
    const device = await app(userA).signIn();
    device.net.online = false;
    await device.engine.requestDelete(pet.id, pet);
    await userA.supabase.from('pets').update({ name: 'Cambiada' }).eq('id', pet.id);
    device.net.online = true;
    await device.engine.requestSync();
    const op = await device.operations.read(pet.id);
    assert.equal(op.status, 'conflict');
    assert.equal(op.conflictRemote.name, 'Cambiada');
    assert.equal(await exists(userA, pet.id), true);

    assert.equal(await device.engine.resolveDeleteConflict(pet.id, { decision: 'delete', shownRemote: op.conflictRemote }), 'synced');
    assert.equal(await exists(userA, pet.id), false);
  });

  it('6/10. la respuesta del borrado se pierde: el reenvío da 0 filas, la lectura no la ve y se cierra', async () => {
    const pet = await insertPet(userA, 'Perdida');
    const device = await app(userA).signIn();
    device.loseNext('DELETE');
    await device.engine.requestDelete(pet.id, pet);
    await device.engine.idle();
    assert.notEqual((await device.operations.read(pet.id)).inFlightSince, null);
    assert.equal(await exists(userA, pet.id), false, 'el servidor sí la borró');

    await device.engine.retry(pet.id);
    assert.equal(await device.operations.read(pet.id), null);
    assert.deepEqual(summarizePetOperations(await device.operations.list()).uncertain, 0);
  });

  it('2/3. alta con respuesta perdida y eliminación: se encuentra por su clave y se borra, sin duplicados', async () => {
    const device = await app(userA).signIn();
    device.loseNext('POST');
    const op = await device.engine.saveCreate({
      name: 'Alta perdida',
      species_id: speciesId,
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
    });
    await device.engine.idle();
    const { data: created } = await userA.supabase.from('pets').select('id').eq('client_request_id', op.operationId);
    assert.equal(created.length, 1);
    cleanup.push([userA, created[0].id]);

    device.net.online = false;
    await device.engine.requestDelete(op.localId, null);
    device.net.online = true;
    await device.engine.requestSync();
    const { data: after } = await userA.supabase.from('pets').select('id').eq('client_request_id', op.operationId);
    assert.deepEqual(after, []);
    assert.equal(device.requests.filter((method) => method === 'POST').length, 1, 'el alta no se reenvía');
  });

  it('9/15. otra cuenta no puede borrarla: RLS da 0 filas y no la ve; el motor de B no toca la de A', async () => {
    const pet = await insertPet(userA, 'De A');
    const b = await app(userB).signIn();
    // B no ve la mascota: desde su almacén ni siquiera puede pedir el borrado con una base de A.
    assert.deepEqual(await b.engine.requestDelete(pet.id, pet), { result: 'rejected', reason: 'not_owner' });
    const remote = createPetWritesRemote(b.supabase, {
      ownerUserId: userB.userId,
      accessToken: createOwnerAccessToken(b.supabase.auth, userB.userId),
    });
    assert.deepEqual(await remote.delete(pet.id, pet.updated_at), { ok: true, data: false });
    assert.equal(await exists(userA, pet.id), true);
  });

  it('14. una lista leída antes del borrado y aplicada después no la resucita', async () => {
    const pet = await insertPet(userA, 'Tardía');
    const device = await app(userA).signIn();
    const staleMark = device.cache.beginRead();
    const staleRows = await device.reads.list();
    assert.ok(staleRows.some((row) => row.id === pet.id));
    await device.engine.requestDelete(pet.id, pet);
    await device.engine.idle();
    assert.equal(await exists(userA, pet.id), false);

    const shown = await device.cache.applyList(staleMark, staleRows);
    assert.equal(shown.some((row) => row.id === pet.id), false);
    assert.equal(withLocalEdits(staleRows, await device.operations.list(), null).some((item) => item.pet.id === pet.id), false);
  });

  it('12. `photo_path` con precondición: una referencia antigua no pisa la actual; con la actual, sí', async () => {
    const pet = await insertPet(userA, 'Foto');
    const device = await app(userA).signIn();
    const photos = createPetPhotoRemote(device.supabase);
    const first = `${pet.id}/${randomUUID()}.jpg`;
    const second = `${pet.id}/${randomUUID()}.jpg`;

    const set = await photos.setPhotoPath(pet.id, first, null);
    assert.equal(set.ok && set.data.photo_path, first);
    // Una respuesta tardía que esperaba «sin foto» no vuelve a poner nada.
    assert.deepEqual(await photos.setPhotoPath(pet.id, second, null), { ok: true, data: null });
    assert.deepEqual(await photos.fetchPhotoPath(pet.id), { ok: true, data: { photo_path: first } });
    // Quitar con la referencia actual.
    const cleared = await photos.setPhotoPath(pet.id, null, first);
    assert.equal(cleared.ok && cleared.data.photo_path, null);
    assert.deepEqual(await photos.canEdit(pet.id), { ok: true, data: true });

    const b = await app(userB).signIn();
    const theirs = createPetPhotoRemote(b.supabase);
    assert.deepEqual(await theirs.setPhotoPath(pet.id, second, null), { ok: true, data: null }, 'RLS: B no la cambia');
    assert.deepEqual(await theirs.fetchPhotoPath(pet.id), { ok: true, data: null }, 'ni la ve');
    assert.deepEqual(await theirs.canEdit(pet.id), { ok: true, data: false });
  });
});
