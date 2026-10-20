// Pruebas de `auth-refresh-fetch.ts` (`npm test`) con el cliente REAL de supabase-js: un `fetch` falso
// responde a la renovación del token y los temporizadores y el reloj son simulados (los reintentos de
// auth-js duran ~25 s). Las de «sin el envoltorio» fijan el comportamiento de auth-js que justifica el
// módulo: si una versión nueva lo cambia, fallan.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { createClient } from '@supabase/supabase-js';

import { isSessionRejected } from '../features/auth/auth-session-controller.ts';
import { createAuthRefreshFetch } from './auth-refresh-fetch.ts';

const URL_ = 'http://127.0.0.1:54321';
const KEY = 'sb-refresh-fetch-test-auth-token';
const USER = 'a0000000-0000-4000-8000-000000000001';
const jwt = (sub) =>
  `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.firma`;
const expiredSession = () => ({
  access_token: jwt(USER),
  refresh_token: 'refresh-0',
  expires_at: Math.floor(Date.now() / 1000) - 600,
  expires_in: 3600,
  token_type: 'bearer',
  user: { id: USER, aud: 'authenticated' },
});

const html = (status) => new Response('<html>Access denied</html>', { status, headers: { 'Content-Type': 'text/html' } });
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function advance(ms, step = 100) {
  for (let elapsed = 0; elapsed < ms; elapsed += step) {
    mock.timers.tick(Math.min(step, ms - elapsed));
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Arranque con la sesión caducada guardada; `respond` contesta a la renovación. */
async function bootWith(respond, { wrapped }) {
  const disk = new Map([[KEY, JSON.stringify(expiredSession())]]);
  const events = [];
  const transport = async () => respond();
  const supabase = createClient(URL_, 'anon-key', {
    auth: {
      storage: {
        getItem: async (key) => disk.get(key) ?? null,
        setItem: async (key, value) => void disk.set(key, value),
        removeItem: async (key) => void disk.delete(key),
      },
      storageKey: KEY,
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { fetch: wrapped ? createAuthRefreshFetch({ fetch: transport, supabaseUrl: URL_ }) : transport },
  });
  supabase.auth.onAuthStateChange((event) => events.push(event));
  const result = supabase.auth.getSession();
  await advance(31_000); // reintentos de auth-js, si los hay
  return { disk, events, result: await result };
}

describe('createAuthRefreshFetch', () => {
  beforeEach(() => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: Date.UTC(2026, 9, 19, 9) });
    mock.method(console, 'warn', () => {});
    mock.method(console, 'error', () => {});
  });
  afterEach(() => {
    mock.timers.reset();
    mock.restoreAll();
  });

  it('sin el envoltorio, auth-js toma un 403 en HTML como rechazo: borra la sesión caducada y emite SIGNED_OUT', async () => {
    const { disk, events, result } = await bootWith(() => html(403), { wrapped: false });
    assert.equal(result.data.session, null);
    assert.equal(disk.has(KEY), false);
    assert.ok(events.includes('SIGNED_OUT'));
  });

  it('con el envoltorio, el mismo 403 en HTML es un fallo de red: la sesión se conserva y no se cierra', async () => {
    const { disk, events, result } = await bootWith(() => html(403), { wrapped: true });
    assert.equal(result.data.session, null);
    assert.equal(result.error?.name, 'AuthRetryableFetchError');
    assert.equal(isSessionRejected(result.error), false);
    assert.ok(disk.has(KEY));
    assert.ok(!events.includes('SIGNED_OUT'));
  });

  it('un rechazo real del servidor (JSON) sigue cerrando la sesión y se reconoce como rechazo', async () => {
    const body = { code: 'refresh_token_not_found', message: 'Invalid Refresh Token: Refresh Token Not Found' };
    const { disk, events, result } = await bootWith(() => json(400, body), { wrapped: true });
    assert.equal(disk.has(KEY), false);
    assert.ok(events.includes('SIGNED_OUT'));
    assert.equal(isSessionRejected(result.error), true);
  });

  it('un 503 (JSON o no) ya es reintentable en auth-js: la sesión se conserva', async () => {
    for (const response of [() => json(503, { message: 'unavailable' }), () => html(503)]) {
      const { disk, result } = await bootWith(response, { wrapped: true });
      assert.equal(result.error?.name, 'AuthRetryableFetchError');
      assert.ok(disk.has(KEY));
    }
  });

  it('las demás peticiones y las respuestas correctas pasan sin cambios', async () => {
    const calls = [];
    const guarded = createAuthRefreshFetch({
      fetch: async (input) => (calls.push(String(input)), html(403)),
      supabaseUrl: URL_,
    });
    assert.equal((await guarded(`${URL_}/auth/v1/token?grant_type=password`)).status, 403);
    assert.equal((await guarded(`${URL_}/rest/v1/pets`)).status, 403);
    const ok = createAuthRefreshFetch({ fetch: async () => new Response('x', { status: 200 }), supabaseUrl: URL_ });
    assert.equal((await ok(`${URL_}/auth/v1/token?grant_type=refresh_token`)).status, 200);
    assert.equal(calls.length, 2);
  });
});
