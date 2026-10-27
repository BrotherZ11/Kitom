// Fase 11 contra el Supabase LOCAL: flujos que cruzan funcionalidades (Auth + Pets + Daily Logs + fotos)
// con un cliente de Supabase COMPARTIDO como en la app, los motores reales y discos en memoria que
// sobreviven a «reiniciar». `npm run test:integration`; en `npm test` se omiten. Nunca contra `kitom-dev`.
//
// Lo que ya cubre cada funcionalidad por separado está en sus propias pruebas de integración; aquí, lo
// que solo aparece al combinarlas. Storage no se prueba (el bucket no existe en local): de las fotos,
// solo que su cliente nunca envía nada con la sesión de otra cuenta (base de datos y Storage).
//
// Crean usuarios `it-…@kitom.test` (quedan en el Auth local) y mascotas que se borran al terminar.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import { createClient } from '@supabase/supabase-js';

import { createOwnerAccessToken, ownerTokenOrThrow } from './auth/owner-session.ts';
import { summarizeUnsynced } from './daily-logs/offline/daily-log-cache.ts';
import { createDailyLogRemote } from './daily-logs/offline/daily-log-remote.ts';
import { createDailyLogRepository } from './daily-logs/offline/daily-log-repository.ts';
import { createDailyLogSyncEngine } from './daily-logs/offline/daily-log-sync-engine.ts';
import { createLocalStore } from '../lib/local-store/local-store.ts';
import { createMemoryStorage } from '../lib/local-store/memory-storage.ts';
import { SessionUnavailableError } from '../lib/user-token-fetch.ts';
import { createPetPhotoRemote } from './pets/api/pet-photos-remote.ts';
import { createPetWritesRemote } from './pets/api/pet-writes-remote.ts';
import { createPetCacheRepository } from './pets/offline/pet-cache-repository.ts';
import { createPetOperationRepository } from './pets/offline/pet-operation-repository.ts';
import { createPetPhotoJournal } from './pets/offline/pet-photo-journal.ts';
import { createPetSyncEngine } from './pets/offline/pet-sync-engine.ts';
import { dailyLogsAccess } from './pets/offline/pet-write-view.ts';
import { processPhotoJournal } from './pets/pet-photo-ops.ts';

const URL_ = process.env.KITOM_IT_SUPABASE_URL;
const ANON_KEY = process.env.KITOM_IT_SUPABASE_ANON_KEY;
const isLocal = URL_ !== undefined && ['127.0.0.1', 'localhost'].includes(new URL(URL_).hostname);
const skip = !URL_ || !ANON_KEY ? 'sin Supabase local (npm run test:integration)' : !isLocal ? 'la URL no es local' : false;

const authOptions = { persistSession: false, autoRefreshToken: false };
const PET_COLUMNS =
  'id, owner_id, name, species_id, sex, breed, breed_id, breed_status, birth_date, weight_kg, sterilized, known_conditions, allergies, temperament_notes, photo_path, is_active, created_at, updated_at';
const today = () => new Date().toISOString().slice(0, 10);
const logContent = (overrides = {}) => ({
  energy_level: 3,
  appetite_level: 3,
  mood_level: 3,
  activity_level: null,
  sleep_quality: null,
  vocalization_level: null,
  social_interaction_level: null,
  unusual_behavior: false,
  unusual_behavior_notes: null,
  notes: null,
  tags: [],
  ...overrides,
});

async function signUp() {
  const supabase = createClient(URL_, ANON_KEY, { auth: authOptions });
  const email = `it-${randomUUID()}@kitom.test`;
  const password = `It-${randomUUID()}`;
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error || !data.session) throw error ?? new Error('El Auth local exige confirmar el email');
  return { supabase, userId: data.user.id, email, password };
}

/**
 * La app en un dispositivo: UN cliente compartido con red que se puede cortar, y para el usuario los
 * dos motores (Daily Logs y Pets) sobre el mismo disco, como los proveedores.
 */
function app(disk = new Map()) {
  const net = { online: true };
  const requests = [];
  const fetch_ = async (input, init) => {
    if (!net.online) throw new TypeError('Network request failed');
    requests.push(new URL(String(input instanceof Request ? input.url : input)).pathname);
    return fetch(input, init);
  };
  const supabase = createClient(URL_, ANON_KEY, { auth: authOptions, global: { fetch: fetch_ } });
  const motors = (userId) => {
    const storage = createMemoryStorage(disk);
    const accessToken = createOwnerAccessToken(supabase.auth, userId);
    const logs = createDailyLogRepository(createLocalStore(storage, userId));
    const logEngine = createDailyLogSyncEngine({
      repository: logs,
      remote: createDailyLogRemote(supabase, { accessToken }),
      isOnline: () => net.online,
      now: Date.now,
      createOperationId: randomUUID,
      random: () => 0,
    });
    const pets = createPetOperationRepository(createLocalStore(storage, userId));
    const petEngine = createPetSyncEngine({
      operations: pets,
      cache: createPetCacheRepository(createLocalStore(storage, userId)),
      remote: createPetWritesRemote(supabase, { ownerUserId: userId, accessToken, timeoutMs: 5_000 }),
      isOnline: () => net.online,
      now: Date.now,
      createOperationId: randomUUID,
      random: () => 0,
    });
    return { logs, logEngine, pets, petEngine };
  };
  return {
    net,
    requests,
    supabase,
    disk,
    async signIn(user) {
      const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: user.password });
      if (error) throw error;
      const session = motors(user.userId);
      session.logEngine.start();
      session.logEngine.setSessionUserId(user.userId);
      session.petEngine.start();
      session.petEngine.setSessionUserId(user.userId);
      return session;
    },
  };
}

describe('flujos cruzados sin conexión contra el Supabase local', { skip }, () => {
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

  before(async () => {
    userA = await signUp();
    userB = await signUp();
    const { data } = await userA.supabase.from('species').select('id').eq('is_active', true).limit(1).single();
    speciesId = data.id;
  });

  after(async () => {
    for (const [user, petId] of cleanup) await user.supabase.from('pets').delete().eq('id', petId);
  });

  it('D6/D7/B6. registro sin sincronizar y eliminación de su mascota: no se abren registros nuevos y el pendiente no se pierde', async () => {
    const pet = await insertPet(userA, 'Con registro pendiente');
    const device = app();
    const a = await device.signIn(userA);
    device.net.online = false;
    await a.logEngine.saveLocal({ petId: pet.id, logDate: today(), content: logContent({ notes: 'solo aquí' }), baseRow: null });
    await a.petEngine.requestDelete(pet.id, pet);
    assert.equal(dailyLogsAccess(pet.id, await a.pets.list()), 'deleting', 'no se pueden abrir registros de la mascota');

    // Vuelve la red: el borrado se confirma antes de que salga el registro (el orden más difícil).
    device.net.online = true;
    await a.petEngine.requestSync();
    assert.equal((await a.pets.read(pet.id)).status, 'synced');
    await a.logEngine.requestSync();

    const kept = await a.logs.read(pet.id, today());
    assert.ok(kept, 'el registro sigue en el dispositivo');
    assert.equal(kept.pending.content.notes, 'solo aquí');
    assert.notEqual(kept.status, 'synced');
    assert.equal(kept.error.kind, 'permission', 'la mascota ya no existe: el servidor lo rechaza (42501)');
    assert.equal(summarizeUnsynced(await a.logs.list()).failed, 1, 'cuenta como no sincronizado (cierre de sesión)');
    assert.equal(dailyLogsAccess(pet.id, await a.pets.list()), 'deleting', 'tampoco tras confirmarla (lápida)');
  });

  it('D4. registro borrado en el servidor durante una edición local: conflicto «ya no existe», lo local intacto', async () => {
    const pet = await insertPet(userA, 'Registro borrado');
    const device = app();
    const a = await device.signIn(userA);
    await a.logEngine.saveLocal({ petId: pet.id, logDate: today(), content: logContent({ notes: 'v1' }), baseRow: null });
    await a.logEngine.requestSync();
    const synced = await a.logs.read(pet.id, today());
    assert.equal(synced.status, 'synced');

    device.net.online = false;
    await a.logEngine.saveLocal({ petId: pet.id, logDate: today(), content: logContent({ notes: 'v2 local' }), baseRow: synced.serverRow });
    const { error } = await userA.supabase.from('daily_logs').delete().eq('pet_id', pet.id).eq('log_date', today());
    if (error) throw error;
    device.net.online = true;
    await a.logEngine.requestSync();

    const record = await a.logs.read(pet.id, today());
    assert.equal(record.status, 'conflict');
    assert.equal(record.pending.content.notes, 'v2 local');
    assert.equal(record.conflict.detail, 'row_missing');
    const { data: server } = await userA.supabase.from('daily_logs').select('id').eq('pet_id', pet.id).eq('log_date', today());
    assert.deepEqual(server, [], 'no se vuelve a crear sin que el usuario lo decida');
  });

  it('F6/E. el cliente de fotos de A nunca envía nada con la sesión de B (base de datos ni Storage)', async () => {
    const pet = await insertPet(userA, 'Fotos de A');
    const device = app();
    await device.signIn(userA);
    // Cliente de fotos de A, como `createOwnerScopedClient`: token de A en el cliente compartido o nada.
    const sent = [];
    const ownerClient = createClient(URL_, ANON_KEY, {
      accessToken: ownerTokenOrThrow(createOwnerAccessToken(device.supabase.auth, userA.userId), () => new SessionUnavailableError()),
      global: {
        fetch: (input, init) => {
          sent.push(new URL(String(input instanceof Request ? input.url : input)).pathname);
          return fetch(input, init);
        },
      },
    });
    const photos = createPetPhotoRemote(ownerClient);
    const path = `${pet.id}/${randomUUID()}.jpg`;
    const set = await photos.setPhotoPath(pet.id, path, null);
    assert.equal(set.ok && set.data.photo_path, path, 'con la sesión de A, funciona');
    assert.equal(sent.length, 1);

    // B entra en el cliente compartido mientras el diario de A tiene trabajo pendiente.
    const { error } = await device.supabase.auth.signInWithPassword({ email: userB.email, password: userB.password });
    if (error) throw error;
    const before = sent.length;
    const fetched = await photos.fetchPhotoPath(pet.id);
    assert.equal(fetched.ok, false);
    assert.equal(fetched.status, null, 'como sin conexión: no se sabe nada, no se decide nada');
    assert.equal((await photos.remove(`${pet.id}/${randomUUID()}.jpg`)).ok, false);
    assert.equal((await photos.setPhotoPath(pet.id, null, path)).ok, false);

    const journal = createPetPhotoJournal(createLocalStore(createMemoryStorage(device.disk), userA.userId));
    const orphan = `${pet.id}/${randomUUID()}.jpg`;
    await journal.put({ userId: userA.userId, petId: pet.id, path: orphan, reason: 'uploaded', status: 'pending', createdAt: 0, checkedAt: null, blockedReason: null });
    // Aunque la comprobación de cuenta llegara tarde (`canRun` dice que sí), nada sale.
    const pass = await processPhotoJournal({ remote: photos, journal, now: Date.now, createId: randomUUID, active: new Set(), canRun: () => true });
    assert.equal(pass.stopped, true);
    assert.equal(sent.length, before, 'ninguna petición salió con la sesión de B');
    assert.equal((await journal.list()).length, 1, 'el trabajo pendiente se conserva');
    const { data: still } = await userA.supabase.from('pets').select('photo_path').eq('id', pet.id).single();
    assert.equal(still.photo_path, path);
  });
});
