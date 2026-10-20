// Fase 7 contra el Supabase LOCAL: lecturas de mascotas con el token del dueño, copia en el
// dispositivo, red cortada, mascota que deja de ser visible y cambio de cuenta con un cliente de
// Supabase COMPARTIDO (como en la app), con Auth y RLS reales. `npm run test:integration`; en
// `npm test` se omiten (no hay URL). Nunca contra `kitom-dev`.
//
// Crean dos usuarios `it-…@kitom.test` (quedan en el Auth local) y mascotas que se borran al terminar.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import { createClient } from '@supabase/supabase-js';

import { createOwnerAccessToken } from '../../auth/owner-session.ts';
import { createLocalStore } from '../../../lib/local-store/local-store.ts';
import { createMemoryStorage } from '../../../lib/local-store/memory-storage.ts';
import { SessionUnavailableError } from '../../../lib/user-token-fetch.ts';
import { createPetReads } from '../api/pets-remote.ts';
import { createPetCacheRepository } from './pet-cache-repository.ts';
import { fetchPetListThroughCache, fetchPetThroughCache } from './pet-queries.ts';

const URL_ = process.env.KITOM_IT_SUPABASE_URL;
const ANON_KEY = process.env.KITOM_IT_SUPABASE_ANON_KEY;
const isLocal = URL_ !== undefined && ['127.0.0.1', 'localhost'].includes(new URL(URL_).hostname);
const skip = !URL_ || !ANON_KEY ? 'sin Supabase local (npm run test:integration)' : !isLocal ? 'la URL no es local' : false;

const authOptions = { persistSession: false, autoRefreshToken: false };

async function signUp() {
  const supabase = createClient(URL_, ANON_KEY, { auth: authOptions });
  const email = `it-${randomUUID()}@kitom.test`;
  const password = `It-${randomUUID()}`;
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error || !data.session) throw error ?? new Error('El Auth local exige confirmar el email');
  return { supabase, userId: data.user.id, email, password };
}

/** Usuario del JWT de una cabecera `Authorization`. */
const subjectOf = (authorization) => {
  try {
    return JSON.parse(Buffer.from(authorization.split(' ')[1].split('.')[1], 'base64url').toString()).sub ?? null;
  } catch {
    return null;
  }
};

/**
 * La app: UN cliente de Supabase compartido, una red que se puede cortar y un registro de cada
 * lectura de `pets` que sale (con qué usuario). Copia local por usuario sobre un mismo «disco».
 */
function app() {
  const net = { online: true };
  const requests = [];
  const fetch_ = async (input, init) => {
    if (!net.online) throw new TypeError('Network request failed');
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('/rest/v1/pets')) requests.push(subjectOf(new Headers(init?.headers).get('Authorization')));
    return fetch(input, init);
  };
  const supabase = createClient(URL_, ANON_KEY, { auth: authOptions, global: { fetch: fetch_ } });
  const disk = new Map();
  const repositories = new Map();
  const repositoryOf = (userId) => {
    if (!repositories.has(userId)) {
      repositories.set(userId, createPetCacheRepository(createLocalStore(createMemoryStorage(disk), userId)));
    }
    return repositories.get(userId);
  };
  /** Sesión de la app: la del cliente compartido (como `serverCall`/`isCurrentUser` con `signed_in`). */
  let current = null;
  const deps = (userId) => ({
    repository: repositoryOf(userId),
    reads: createPetReads(supabase, { accessToken: createOwnerAccessToken(supabase.auth, userId) }),
    serverCall: (call) => (current ? call() : Promise.reject(new SessionUnavailableError())),
    isOwnerSession: () => current === userId,
  });

  return {
    net,
    requests,
    disk,
    repositoryOf,
    deps,
    async signIn(user) {
      const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: user.password });
      if (error) throw error;
      current = user.userId;
    },
  };
}

async function createPet(user, name) {
  const { data: species } = await user.supabase.from('species').select('id').eq('is_active', true).limit(1).single();
  const { data, error } = await user.supabase
    .from('pets')
    .insert({ owner_id: user.userId, name, species_id: species.id })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

describe('Pets sin conexión contra el Supabase local', { skip }, () => {
  let userA;
  let userB;
  const created = [];

  before(async () => {
    userA = await signUp();
    userB = await signUp();
  });

  after(async () => {
    for (const [user, petId] of created) await user.supabase.from('pets').delete().eq('id', petId);
  });

  it('1/2/4/6. primera carga, red cortada (no sobrescribe) y reabrir lista y ficha desde la copia', async () => {
    const device = app();
    await device.signIn(userA);
    const luna = await createPet(userA, 'Luna');
    created.push([userA, luna]);

    const shown = await fetchPetListThroughCache(device.deps(userA.userId));
    assert.deepEqual(shown.map((pet) => pet.id), [luna]);
    assert.deepEqual(device.requests, [userA.userId]);
    // La ficha de una mascota que solo se vio en la lista también queda guardada.
    assert.equal((await device.repositoryOf(userA.userId).readPet(luna)).pet.name, 'Luna');

    device.net.online = false;
    // postgrest-js lo devuelve como `{ message: 'TypeError: Network request failed' }` (la app lo
    // clasifica como «sin conexión» por el mensaje, `isPetOfflineError`).
    const offline = { message: /Network request failed/ };
    await assert.rejects(fetchPetListThroughCache(device.deps(userA.userId)), offline);
    await assert.rejects(fetchPetThroughCache(device.deps(userA.userId), luna), offline);

    // «Reiniciar» la app sobre el mismo disco: la copia sigue y no se ha vaciado.
    const restarted = createPetCacheRepository(createLocalStore(createMemoryStorage(device.disk), userA.userId));
    const list = await restarted.readList();
    assert.equal(list.status, 'loaded');
    assert.deepEqual(list.pets.map((pet) => pet.name), ['Luna']);
    assert.equal((await restarted.readPet(luna)).pet.id, luna);
    assert.equal(await restarted.readPet(randomUUID()), null);
  });

  it('3. lista vacía confirmada por el servidor', async () => {
    const device = app();
    await device.signIn(userB);
    assert.deepEqual(await device.repositoryOf(userB.userId).readList(), { status: 'never_loaded' });
    assert.deepEqual(await fetchPetListThroughCache(device.deps(userB.userId)), []);
    const list = await device.repositoryOf(userB.userId).readList();
    assert.equal(list.status, 'loaded');
    assert.deepEqual(list.pets, []);
  });

  it('11. una mascota que el servidor deja de devolver conserva su copia', async () => {
    const device = app();
    await device.signIn(userA);
    const kira = await createPet(userA, 'Kira');
    await fetchPetListThroughCache(device.deps(userA.userId));
    await fetchPetThroughCache(device.deps(userA.userId), kira);

    // Se borra fuera de este dispositivo (otra sesión de la misma cuenta).
    await userA.supabase.from('pets').delete().eq('id', kira);
    assert.equal(await fetchPetThroughCache(device.deps(userA.userId), kira), null);
    const shown = await fetchPetListThroughCache(device.deps(userA.userId));
    assert.equal(shown.some((pet) => pet.id === kira), false);

    const repository = device.repositoryOf(userA.userId);
    assert.equal((await repository.readList()).pets.some((pet) => pet.id === kira), false);
    const snapshot = await repository.readPet(kira);
    assert.equal(snapshot.pet.name, 'Kira');
    assert.notEqual(snapshot.unavailableAt, null);
  });

  it('8/14. cambio de cuenta: la lectura de la anterior no sale con la sesión nueva; cada copia, la suya', async () => {
    const device = app();
    await device.signIn(userA);
    const luna = await createPet(userA, 'Luna A');
    created.push([userA, luna]);
    await fetchPetListThroughCache(device.deps(userA.userId));
    const before = device.requests.length;

    await device.signIn(userB);
    // Una query de A que se ejecuta tras el cambio: el token del cliente compartido ya es de B.
    const readsAsA = device.deps(userA.userId).reads;
    await assert.rejects(readsAsA.list(), SessionUnavailableError);
    await assert.rejects(readsAsA.detail(luna), SessionUnavailableError);
    assert.equal(device.requests.length, before, 'ninguna petición de A con la sesión de B');

    const shownB = await fetchPetListThroughCache(device.deps(userB.userId));
    assert.equal(shownB.some((pet) => pet.id === luna), false);
    assert.deepEqual(device.requests.slice(before), [userB.userId]);
    // RLS: la mascota de A no es visible para B (no se confunde con «no existe» en la copia de A).
    assert.equal(await fetchPetThroughCache(device.deps(userB.userId), luna), null);

    assert.ok((await device.repositoryOf(userA.userId).readList()).pets.some((pet) => pet.id === luna));
    assert.equal((await device.repositoryOf(userB.userId).readList()).pets.some((pet) => pet.id === luna), false);
    assert.equal((await device.repositoryOf(userA.userId).readPet(luna)).unavailableAt, null);
  });
});
