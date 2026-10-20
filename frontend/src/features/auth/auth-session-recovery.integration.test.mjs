// Fase 6.5 contra el Supabase LOCAL: la sesión con supabase-js REAL montado como en la app
// (`autoRefreshToken: true`, guardia de `user-token-fetch.ts` sobre `auth-refresh-fetch.ts`, puerta del
// temporizador de `auto-refresh-gate.ts`) y el controlador de sesión. `npm run test:integration`; en
// `npm test` se omiten. Nunca contra `kitom-dev`. Los tiempos de recuperación se miden aparte
// (`scripts/measure-session-recovery.mjs`).
//
// Crea usuarios `it-…@kitom.test` (quedan en el Auth local). Hay esperas reales de ~35 s.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { createClient } from '@supabase/supabase-js';

import { createAuthRefreshFetch } from '../../lib/auth-refresh-fetch.ts';
import { createAutoRefreshGate } from '../../lib/auto-refresh-gate.ts';
import { createUserTokenFetch, isSessionUnavailableError } from '../../lib/user-token-fetch.ts';
import { createAuthSessionController } from './auth-session-controller.ts';

const URL_ = process.env.KITOM_IT_SUPABASE_URL;
const ANON_KEY = process.env.KITOM_IT_SUPABASE_ANON_KEY;
const isLocal = URL_ !== undefined && ['127.0.0.1', 'localhost'].includes(new URL(URL_).hostname);
const skip = !URL_ || !ANON_KEY ? 'sin Supabase local (npm run test:integration)' : !isLocal ? 'la URL no es local' : false;

const KEY = 'sb-it-recovery-auth-token';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (condition, ms = 15_000) => {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > ms) throw new Error('timeout');
    await sleep(20);
  }
};

async function newUser() {
  const setup = createClient(URL_, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `it-${randomUUID()}@kitom.test`;
  const password = `It-${randomUUID()}`;
  const { data, error } = await setup.auth.signUp({ email, password });
  if (error || !data.session) throw error ?? new Error('El Auth local exige confirmar el email');
  return { email, password, userId: data.user.id, session: data.session };
}

/** La app: cliente real con la guardia, red controlable y la puerta del temporizador como en móvil. */
function app({ stored = null, online = true } = {}) {
  const disk = new Map(stored ? [[KEY, JSON.stringify(stored)]] : []);
  const net = { online };
  const requests = [];
  const transport = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    requests.push(url.includes('grant_type=refresh_token') ? 'refresh' : url.includes('/rest/v1/') ? 'rest' : 'auth');
    if (!net.online) throw new TypeError('Network request failed');
    return fetch(input, init);
  };
  const storage = {
    getItem: async (key) => disk.get(key) ?? null,
    setItem: async (key, value) => void disk.set(key, value),
    removeItem: async (key) => void disk.delete(key),
  };
  const supabase = createClient(URL_, ANON_KEY, {
    auth: { storage, storageKey: KEY, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    global: {
      fetch: createUserTokenFetch({
        fetch: createAuthRefreshFetch({ fetch: transport, supabaseUrl: URL_ }),
        supabaseUrl: URL_,
        anonKey: ANON_KEY,
      }),
    },
  });
  const gate = createAutoRefreshGate({
    start: () => void supabase.auth.startAutoRefresh(),
    stop: () => void supabase.auth.stopAutoRefresh(),
    foreground: true,
    online,
  });
  void supabase.auth.initialize().then(() => setTimeout(gate.sync, 0));
  const online$ = new Set();
  const controller = createAuthSessionController({
    auth: supabase.auth,
    storage,
    storageKey: KEY,
    subscribeOnline: (listener) => (online$.add(listener), () => online$.delete(listener)),
    canAttemptRecovery: () => net.online,
  });
  const stop = controller.start();
  return {
    supabase,
    controller,
    disk,
    requests,
    refreshes: () => requests.filter((kind) => kind === 'refresh').length,
    goOnline() {
      net.online = true;
      gate.setOnline(true);
      for (const listener of online$) listener(true);
    },
    async stop() {
      stop();
      await supabase.auth.stopAutoRefresh();
    },
  };
}

describe('recuperación de la sesión contra el Supabase local', { skip }, () => {
  it('con la guardia montada: iniciar sesión y renovarla funcionan; los datos salen como el usuario', async () => {
    const user = await newUser();
    const client = app();
    await waitFor(() => client.controller.getState().status === 'signed_out');
    const before = await client.supabase.from('profiles').select('id');
    assert.ok(isSessionUnavailableError(before.error)); // sin sesión no sale ni como anon

    const signIn = await client.supabase.auth.signInWithPassword({ email: user.email, password: user.password });
    assert.equal(signIn.error, null);
    await waitFor(() => client.controller.getState().status === 'signed_in');
    const own = await client.controller.serverCall(() => client.supabase.from('profiles').select('id'));
    assert.deepEqual(own.data, [{ id: user.userId }]);

    const refreshed = await client.supabase.auth.refreshSession();
    assert.equal(refreshed.error, null);
    assert.notEqual(refreshed.data.session.refresh_token, signIn.data.session.refresh_token);
    const again = await client.controller.serverCall(() => client.supabase.from('profiles').select('id'));
    assert.deepEqual(again.data, [{ id: user.userId }]);
    await client.stop();
  });

  it('sesión revocada en el servidor: cierre de sesión y ninguna renovación más (35 s)', async () => {
    const user = await newUser();
    const other = createClient(URL_, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    await other.auth.setSession({ access_token: user.session.access_token, refresh_token: user.session.refresh_token });
    assert.equal((await other.auth.signOut({ scope: 'global' })).error, null);

    const client = app({ stored: { ...user.session, expires_at: Math.floor(Date.now() / 1000) - 600 } });
    await waitFor(() => client.controller.getState().status === 'signed_out');
    assert.equal(client.disk.has(KEY), false);
    const refreshes = client.refreshes();
    assert.equal(refreshes, 1);
    await sleep(35_000); // más de una pasada del temporizador de auth-js y varios intervalos del controlador
    assert.equal(client.refreshes(), refreshes);
    await client.stop();
  });

  it('token caducado sin conexión: tras los reintentos de arranque, ninguna renovación mientras siga sin red (35 s)', { timeout: 90_000 }, async () => {
    const user = await newUser();
    const client = app({ stored: { ...user.session, expires_at: Math.floor(Date.now() / 1000) - 600 }, online: false });
    await waitFor(() => client.controller.getState().status === 'offline');
    await waitFor(() => client.controller.getState().reason === 'refresh_failed', 35_000); // fin de los reintentos de arranque
    const afterStartup = client.refreshes();
    await sleep(35_000);
    assert.equal(client.refreshes(), afterStartup, 'ni el temporizador de auth-js ni el controlador intentan sin red');
    assert.equal(client.requests.filter((kind) => kind === 'rest').length, 0);
    assert.equal(client.controller.getState().status, 'offline');
    await client.stop();
  });
});
