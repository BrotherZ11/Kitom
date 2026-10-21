// Fase 8 contra el Supabase LOCAL (con la migración `20261020135440_pets_client_request_id`): altas y
// ediciones de mascotas guardadas en el dispositivo y enviadas por el motor, con Auth, RLS, el índice de
// la clave de alta y un cliente de Supabase COMPARTIDO (como en la app). `npm run test:integration`; en
// `npm test` se omiten. Nunca contra `kitom-dev`.
//
// Crean usuarios `it-…@kitom.test` (quedan en el Auth local) y mascotas que se borran al terminar.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import { createClient } from '@supabase/supabase-js';

import { createOwnerAccessToken } from '../../auth/owner-session.ts';
import { contentToSaveArgs } from '../../daily-logs/offline/daily-log-content.ts';
import { createDailyLogRemote } from '../../daily-logs/offline/daily-log-remote.ts';
import { classifySyncError } from '../../daily-logs/offline/sync-errors.ts';
import { createLocalStore } from '../../../lib/local-store/local-store.ts';
import { createMemoryStorage } from '../../../lib/local-store/memory-storage.ts';
import { createPetWritesRemote } from '../api/pet-writes-remote.ts';
import { createPetCacheRepository } from './pet-cache-repository.ts';
import { createPetOperationRepository } from './pet-operation-repository.ts';
import { contentOf } from './pet-operation.ts';
import { createPetSyncEngine } from './pet-sync-engine.ts';

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

const subjectOf = (authorization) => {
  try {
    return JSON.parse(Buffer.from(authorization.split(' ')[1].split('.')[1], 'base64url').toString()).sub ?? null;
  } catch {
    return null;
  }
};

/**
 * La app en un dispositivo: UN cliente compartido, una red que se puede cortar, un registro de cada
 * petición de datos (método, ruta y usuario del token) y respuestas de altas que se pueden perder (la
 * petición llega al servidor y se aplica, pero la respuesta no vuelve) o quedarse colgadas.
 */
function app(disk = new Map()) {
  const net = { online: true };
  const requests = [];
  let loseNextCreate = false;
  let hangNextCreate = false;
  const fetch_ = async (input, init) => {
    if (!net.online) throw new TypeError('Network request failed');
    const url = String(input instanceof Request ? input.url : input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = new URL(url).pathname;
    if (path.startsWith('/rest/v1/') || path.startsWith('/storage/v1/')) {
      requests.push({ method, path, userId: subjectOf(new Headers(init?.headers).get('Authorization')) });
    }
    const response = await fetch(input, init);
    if (method === 'POST' && path === '/rest/v1/pets') {
      if (loseNextCreate) {
        loseNextCreate = false;
        throw new TypeError('Network request failed');
      }
      if (hangNextCreate) {
        hangNextCreate = false;
        return new Promise(() => {});
      }
    }
    return response;
  };
  const supabase = createClient(URL_, ANON_KEY, { auth: authOptions, global: { fetch: fetch_ } });
  const engines = new Map();
  const sessionFor = (userId) => {
    if (!engines.has(userId)) {
      const storage = createMemoryStorage(disk);
      const operations = createPetOperationRepository(createLocalStore(storage, userId));
      const cache = createPetCacheRepository(createLocalStore(storage, userId));
      const engine = createPetSyncEngine({
        operations,
        cache,
        remote: createPetWritesRemote(supabase, { ownerUserId: userId, accessToken: createOwnerAccessToken(supabase.auth, userId), timeoutMs: 5_000 }),
        isOnline: () => net.online,
        now: Date.now,
        createOperationId: randomUUID,
        random: () => 0,
      });
      engines.set(userId, { operations, cache, engine });
    }
    return engines.get(userId);
  };
  return {
    net,
    requests,
    disk,
    supabase,
    sessionFor,
    loseNextCreate: () => (loseNextCreate = true),
    hangNextCreate: () => (hangNextCreate = true),
    /** Entra con `user` en el cliente compartido y activa su motor (los demás, parados y sin sesión). */
    async signIn(user) {
      const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: user.password });
      if (error) throw error;
      for (const [id, other] of engines) {
        if (id !== user.userId) {
          other.engine.stop();
          other.engine.setSessionUserId(null);
        }
      }
      const session = sessionFor(user.userId);
      session.engine.start();
      session.engine.setSessionUserId(user.userId);
      return session;
    },
  };
}

describe('Pets: altas y ediciones sin conexión contra el Supabase local', { skip }, () => {
  let userA;
  let userB;
  let speciesId;
  const cleanup = [];

  const content = (overrides = {}) => ({
    name: 'Luna',
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
    ...overrides,
  });
  const petsWithKey = async (user, key) => {
    const { data, error } = await user.supabase.from('pets').select('id, name').eq('client_request_id', key);
    if (error) throw error;
    return data;
  };
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

  before(async () => {
    userA = await signUp();
    userB = await signUp();
    const { data } = await userA.supabase.from('species').select('id').eq('is_active', true).limit(1).single();
    speciesId = data.id;
  });

  after(async () => {
    for (const [user, petId] of cleanup) await user.supabase.from('pets').delete().eq('id', petId);
  });

  it('1/2/4. alta sin conexión, reabrir la app y sincronizar: id del servidor y mapeo, una sola mascota', async () => {
    const device = app();
    const a = await device.signIn(userA);
    device.net.online = false;
    const op = await a.engine.saveCreate(content({ name: 'Sin red' }));
    await a.engine.idle();
    assert.equal(device.requests.length, 0, 'sin conexión no sale nada');

    // «Reiniciar» sobre el mismo disco y volver la red.
    const reopened = app(device.disk);
    const a2 = await reopened.signIn(userA);
    assert.equal((await a2.operations.read(op.localId)).status, 'pending');
    await a2.engine.requestSync();
    const mapped = await a2.operations.read(op.localId);
    assert.equal(mapped.status, 'synced');
    cleanup.push([userA, mapped.petId]);
    assert.deepEqual(await petsWithKey(userA, op.operationId), [{ id: mapped.petId, name: 'Sin red' }]);
    assert.equal((await a2.cache.readPet(mapped.petId)).pet.name, 'Sin red');
    assert.ok(reopened.requests.every((request) => request.userId === userA.userId), 'todo con el token de A');
  });

  it('5. se pierde la respuesta de un alta ya creada: el reenvío da 23505 y se lee por la clave (sin duplicado)', async () => {
    const device = app();
    const a = await device.signIn(userA);
    device.loseNextCreate();
    const op = await a.engine.saveCreate(content({ name: 'Respuesta perdida' }));
    await a.engine.idle();
    const uncertain = await a.operations.read(op.localId);
    assert.equal(uncertain.status, 'pending');
    assert.notEqual(uncertain.inFlightSince, null);
    assert.equal((await petsWithKey(userA, op.operationId)).length, 1, 'el servidor sí la creó');

    await a.engine.retry(op.localId);
    const mapped = await a.operations.read(op.localId);
    assert.equal(mapped.status, 'synced');
    cleanup.push([userA, mapped.petId]);
    const rows = await petsWithKey(userA, op.operationId);
    assert.deepEqual(rows.map((row) => row.id), [mapped.petId], 'una sola mascota');
    assert.deepEqual(
      device.requests.filter((request) => request.path === '/rest/v1/pets').map((request) => request.method),
      ['POST', 'POST', 'GET']
    );
  });

  it('15. la app se cierra con el alta en vuelo: al reabrir se reenvía sin duplicar', async () => {
    const device = app();
    const a = await device.signIn(userA);
    device.hangNextCreate();
    const op = await a.engine.saveCreate(content({ name: 'Cerrada en vuelo' }));
    for (let i = 0; i < 50 && (await petsWithKey(userA, op.operationId)).length === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    a.engine.stop();
    assert.notEqual((await a.operations.read(op.localId)).inFlightSince, null);

    const reopened = app(device.disk);
    const a2 = await reopened.signIn(userA);
    await a2.engine.requestSync();
    const mapped = await a2.operations.read(op.localId);
    assert.equal(mapped.status, 'synced');
    cleanup.push([userA, mapped.petId]);
    assert.equal((await petsWithKey(userA, op.operationId)).length, 1);
  });

  it('6/7. ediciones consolidadas; el mismo campo cambiado en el servidor da conflicto y el usuario decide', async () => {
    const pet = await insertPet(userA, 'Base');
    const device = app();
    const a = await device.signIn(userA);
    device.net.online = false;
    await a.engine.saveEdit(pet.id, { ...contentOf(pet), name: 'Mía 1' }, pet);
    await a.engine.saveEdit(pet.id, { ...contentOf(pet), name: 'Mía 2', weight_kg: 4.5 }, pet);
    assert.equal((await a.operations.list()).length, 1);

    // Otro dispositivo cambia el nombre mientras tanto.
    await userA.supabase.from('pets').update({ name: 'Suya' }).eq('id', pet.id);
    device.net.online = true;
    await a.engine.requestSync();
    const op = await a.operations.read(pet.id);
    assert.equal(op.status, 'conflict');
    assert.equal(op.conflictRemote.name, 'Suya');
    const { data: untouched } = await userA.supabase.from('pets').select('name, weight_kg').eq('id', pet.id).single();
    assert.deepEqual(untouched, { name: 'Suya', weight_kg: null }, 'el servidor no se sobrescribe');

    const outcome = await a.engine.resolveConflict(pet.id, {
      content: { ...contentOf(op.conflictRemote), name: 'Mía 2', weight_kg: 4.5 },
      shownRemote: op.conflictRemote,
    });
    assert.equal(outcome, 'synced');
    const { data: final } = await userA.supabase.from('pets').select('name, weight_kg').eq('id', pet.id).single();
    assert.deepEqual(final, { name: 'Mía 2', weight_kg: 4.5 });
  });

  it('7b. un cambio remoto en otro campo se conserva y lo local se aplica encima (precondición real)', async () => {
    const pet = await insertPet(userA, 'Base 2');
    const device = app();
    const a = await device.signIn(userA);
    device.net.online = false;
    await a.engine.saveEdit(pet.id, { ...contentOf(pet), name: 'Mía' }, pet);
    await userA.supabase.from('pets').update({ temperament_notes: 'del servidor' }).eq('id', pet.id);
    device.net.online = true;
    await a.engine.requestSync();
    assert.deepEqual(await a.operations.list(), []);
    const { data } = await userA.supabase.from('pets').select('name, temperament_notes').eq('id', pet.id).single();
    assert.deepEqual(data, { name: 'Mía', temperament_notes: 'del servidor' });
  });

  it('8. sin permiso (RLS): la edición queda «sin permiso» con los datos locales y el servidor no cambia', async () => {
    const pet = await insertPet(userA, 'De A');
    const device = app();
    const b = await device.signIn(userB);
    await b.engine.saveEdit(pet.id, { ...contentOf(pet), name: 'Intento de B' }, pet);
    await b.engine.idle();
    const op = await b.operations.read(pet.id);
    assert.equal(op.status, 'forbidden');
    assert.equal(op.content.name, 'Intento de B');
    const { data } = await userA.supabase.from('pets').select('name').eq('id', pet.id).single();
    assert.equal(data.name, 'De A');
  });

  it('9/11/12. tras cambiar de cuenta, lo de la anterior no sale con el token de la nueva', async () => {
    const device = app();
    const a = await device.signIn(userA);
    device.net.online = false;
    const op = await a.engine.saveCreate(content({ name: 'De A sin enviar' }));
    device.net.online = true;
    await device.signIn(userB);
    // Aunque el motor de A se pusiera en marcha, su token ya no está: no se envía nada.
    a.engine.start();
    a.engine.setSessionUserId(userA.userId);
    const before = device.requests.length;
    await a.engine.requestSync();
    assert.equal(device.requests.length, before, 'ninguna petición');
    const pending = await a.operations.read(op.localId);
    assert.equal(pending.status, 'pending');
    assert.equal(pending.lastError.reason, 'owner_session_required');
    assert.deepEqual(await device.sessionFor(userB.userId).operations.list(), [], 'B no ve el borrador de A');
  });

  it('10. un registro diario con un id temporal no se puede vincular a ninguna mascota', async () => {
    const device = app();
    await device.signIn(userA);
    const remote = createDailyLogRemote(device.supabase, { accessToken: createOwnerAccessToken(device.supabase.auth, userA.userId) });
    const localPetId = `local-${randomUUID()}`;
    const result = await remote.save({
      ...contentToSaveArgs(localPetId, new Date().toISOString().slice(0, 10), {
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
    assert.equal(result.ok, false);
    assert.equal(result.error.code, '22P02');
    assert.equal(classifySyncError(result.error, result.status).policy, 'give_up');
  });

  it('13/14. el motor no borra mascotas ni toca Storage', async () => {
    const device = app();
    const a = await device.signIn(userA);
    const op = await a.engine.saveCreate(content({ name: 'Sin fotos' }));
    await a.engine.idle();
    const { petId } = await a.operations.read(op.localId);
    cleanup.push([userA, petId]);
    const row = (await a.cache.readPet(petId)).pet;
    await a.engine.saveEdit(petId, { ...contentOf(row), name: 'Sin fotos 2' }, row);
    await a.engine.idle();
    assert.equal(device.requests.some((request) => request.method === 'DELETE'), false);
    assert.equal(device.requests.some((request) => request.path.startsWith('/storage/v1/')), false);
    const { data } = await userA.supabase.from('pets').select('name, photo_path').eq('id', petId).single();
    assert.deepEqual(data, { name: 'Sin fotos 2', photo_path: null });
  });
});
