// Fase 6 contra el Supabase LOCAL: arranque en frío con supabase-js REAL (su auth-js decide si la
// sesión guardada sirve, la renueva o no puede) y una red que se puede cortar o «colgar». Comprueba el
// controlador de sesión, la guardia de `user-token-fetch.ts` y que el motor solo envía con una sesión
// utilizable del dueño. `npm run test:integration`; en `npm test` se omiten. Nunca contra `kitom-dev`.
//
// Crea un usuario `it-…@kitom.test` (queda en el Auth local) y una mascota que se borra al terminar.
// Con la red cortada, auth-js reintenta la renovación ~25 s en segundo plano: este archivo tarda más.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import { createClient } from '@supabase/supabase-js';

import { createAuthSessionController } from '../../auth/auth-session-controller.ts';
import { createOwnerAccessToken } from '../../auth/owner-session.ts';
import { createLocalStore } from '../../../lib/local-store/local-store.ts';
import { createMemoryStorage } from '../../../lib/local-store/memory-storage.ts';
import { createUserTokenFetch, isSessionUnavailableError } from '../../../lib/user-token-fetch.ts';
import { createDailyLogRemote } from './daily-log-remote.ts';
import { createDailyLogRepository } from './daily-log-repository.ts';
import { createDailyLogSyncEngine } from './daily-log-sync-engine.ts';

const URL_ = process.env.KITOM_IT_SUPABASE_URL;
const ANON_KEY = process.env.KITOM_IT_SUPABASE_ANON_KEY;
const isLocal = URL_ !== undefined && ['127.0.0.1', 'localhost'].includes(new URL(URL_).hostname);
const skip = !URL_ || !ANON_KEY ? 'sin Supabase local (npm run test:integration)' : !isLocal ? 'la URL no es local' : false;

const KEY = 'sb-it-cold-start-auth-token';
const today = () => new Date().toISOString().slice(0, 10);
const content = (notes) => ({
  energy_level: 3,
  appetite_level: 3,
  mood_level: 3,
  activity_level: null,
  sleep_quality: null,
  vocalization_level: null,
  social_interaction_level: null,
  unusual_behavior: false,
  unusual_behavior_notes: null,
  notes,
  tags: [],
});
const waitFor = async (condition, ms = 15_000) => {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > ms) throw new Error('timeout');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

/**
 * Un arranque de la app: almacenamiento de la sesión (`sessionDisk`) y del almacén local (`disk`)
 * que sobreviven entre arranques, cliente de Supabase real con la guardia y una red controlable.
 */
function boot({ sessionDisk, disk, network }) {
  const held = [];
  const net = { mode: network };
  const requests = { auth: 0, rest: 0 };
  const fetch_ = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('/auth/v1/')) requests.auth += 1;
    if (url.includes('/rest/v1/')) requests.rest += 1;
    if (net.mode === 'offline') throw new TypeError('Network request failed');
    if (net.mode === 'hang') await new Promise((resolve) => held.push(resolve));
    if (net.mode === 'offline') throw new TypeError('Network request failed');
    return fetch(input, init);
  };
  const storage = {
    getItem: (key) => sessionDisk.get(key) ?? null,
    setItem: (key, value) => void sessionDisk.set(key, value),
    removeItem: (key) => void sessionDisk.delete(key),
  };
  const supabase = createClient(URL_, ANON_KEY, {
    auth: { storage, storageKey: KEY, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: createUserTokenFetch({ fetch: fetch_, supabaseUrl: URL_, anonKey: ANON_KEY }) },
  });
  const controller = createAuthSessionController({ auth: supabase.auth, storage, storageKey: KEY, startupTimeoutMs: 4_000 });
  const stop = controller.start();
  return {
    supabase,
    controller,
    requests,
    net,
    stop,
    /** La red vuelve (o deja de colgar). */
    release() {
      net.mode = 'online';
      for (const resolve of held.splice(0)) resolve();
    },
    engineFor(userId) {
      const repository = createDailyLogRepository(createLocalStore(createMemoryStorage(disk), userId));
      const engine = createDailyLogSyncEngine({
        repository,
        remote: createDailyLogRemote(supabase, { accessToken: createOwnerAccessToken(supabase.auth, userId) }),
        isOnline: () => net.mode === 'online',
        now: Date.now,
        createOperationId: randomUUID,
        random: () => 0,
      });
      engine.start();
      return { repository, engine };
    },
  };
}

describe('arranque en frío contra el Supabase local', { skip }, () => {
  let user;
  let session;
  let petId;

  before(async () => {
    const setup = createClient(URL_, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const email = `it-${randomUUID()}@kitom.test`;
    const { data, error } = await setup.auth.signUp({ email, password: `It-${randomUUID()}` });
    if (error || !data.session) throw error ?? new Error('El Auth local exige confirmar el email');
    user = { supabase: setup, userId: data.user.id };
    session = data.session;
    const species = await setup.from('species').select('id').limit(1).single();
    if (species.error) throw species.error;
    const pet = await setup
      .from('pets')
      .insert({ name: 'Arranque en frío', species_id: species.data.id, owner_id: user.userId })
      .select('id')
      .single();
    if (pet.error) throw pet.error;
    petId = pet.data.id;
  });

  after(async () => {
    if (petId) await user.supabase.from('pets').delete().eq('id', petId);
  });

  const stored = (overrides = {}) => new Map([[KEY, JSON.stringify({ ...session, ...overrides })]]);
  const expiredAt = () => Math.floor(Date.now() / 1000) - 600;

  it('1. token vigente y sin red: supabase-js la entrega sin pedir nada; sesión utilizable', async () => {
    const app = boot({ sessionDisk: stored(), disk: new Map(), network: 'offline' });
    await waitFor(() => app.controller.getState().status !== 'loading');
    assert.equal(app.controller.getState().status, 'signed_in');
    assert.equal(app.controller.getState().userId, user.userId);
    assert.equal(app.requests.auth, 0);
    app.stop();
  });

  it('3/4/12/13. token caducado y sin red: «offline» (no cierre); nada sale como anon; cerrar sesión la quita del dispositivo', async () => {
    const sessionDisk = stored({ expires_at: expiredAt() });
    const app = boot({ sessionDisk, disk: new Map(), network: 'offline' });
    await waitFor(() => app.controller.getState().status !== 'loading');
    const state = app.controller.getState();
    assert.equal(state.status, 'offline');
    assert.equal(state.userId, user.userId);
    assert.ok(sessionDisk.has(KEY));

    // Las queries de la app (`serverCall`) fallan al instante, sin esperar a la inicialización de
    // supabase-js (que sigue reintentando la renovación en segundo plano).
    const started = Date.now();
    await assert.rejects(
      app.controller.serverCall(() => app.supabase.from('pets').select('id')),
      (thrown) => isSessionUnavailableError(thrown)
    );
    assert.ok(Date.now() - started < 200);

    // Y una lectura directa (fuera de `serverCall`) tampoco sale sin token de usuario: la guardia la
    // corta (después de esperar a supabase-js, que es lo que `serverCall` evita).
    const { error } = await app.supabase.from('pets').select('id');
    assert.ok(isSessionUnavailableError(error));
    assert.equal(app.requests.rest, 0);

    // Supabase no puede cerrar la sesión (no consigue renovarla): se quita del dispositivo.
    assert.deepEqual(await app.controller.signOut(), { error: null });
    assert.equal(app.controller.getState().status, 'signed_out');
    assert.equal(sessionDisk.has(KEY), false);
    app.stop();
  });

  it('5/8/10/12. token caducado y red colgada: «offline» a los 4 s sin enviar; al volver la red se renueva y se envía como el dueño', async () => {
    const disk = new Map();
    // Arranque anterior: el registro de hoy quedó pendiente en el dispositivo.
    const previous = boot({ sessionDisk: stored(), disk, network: 'offline' });
    const before_ = previous.engineFor(user.userId);
    await before_.engine.saveLocal({ petId, logDate: today(), content: content('pendiente al cerrar'), baseRow: null });
    previous.stop();

    const sessionDisk = stored({ expires_at: expiredAt() });
    const app = boot({ sessionDisk, disk, network: 'hang' });
    const started = Date.now();
    await waitFor(() => app.controller.getState().status !== 'loading', 10_000);
    assert.equal(app.controller.getState().status, 'offline');
    assert.equal(app.controller.getState().reason, 'slow_start');
    assert.ok(Date.now() - started < 6_000);

    const { repository, engine } = app.engineFor(user.userId);
    assert.equal((await repository.read(petId, today())).status, 'pending');
    // Sin sesión utilizable, el motor no tiene sesión (`setSessionUserId(null)`) y no envía.
    engine.setSessionUserId(null);
    await engine.requestSync();

    // Vuelve la red: la renovación pendiente de auth-js termina y la sesión pasa a utilizable.
    app.release();
    await waitFor(() => app.controller.getState().status === 'signed_in');
    assert.equal(app.controller.getState().userId, user.userId);
    engine.setSessionUserId(user.userId);
    await engine.requestSync();
    await engine.idle();
    assert.equal((await repository.read(petId, today())).status, 'synced');
    const row = (await user.supabase.from('daily_logs').select('*').eq('pet_id', petId).eq('log_date', today()).maybeSingle()).data;
    assert.equal(row.notes, 'pendiente al cerrar');
    assert.equal(row.logged_by, user.userId);
    app.stop();
  });
});
