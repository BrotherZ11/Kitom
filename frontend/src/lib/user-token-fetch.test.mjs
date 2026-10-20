// Pruebas de `user-token-fetch.ts` (`npm test`), también con el cliente real de supabase-js (sin red:
// el `fetch` de debajo se cuenta y nunca llega a llamarse cuando la guardia corta).
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { describe, it } from 'node:test';

import { createClient } from '@supabase/supabase-js';

import { toDailyLogError } from '../features/daily-logs/daily-log-errors.ts';
import { createDailyLogRemote } from '../features/daily-logs/offline/daily-log-remote.ts';
import { createAuthRefreshFetch } from './auth-refresh-fetch.ts';
import { createUserTokenFetch, isSessionUnavailableError, SessionUnavailableError } from './user-token-fetch.ts';

const URL_ = 'http://127.0.0.1:54321';
const ANON = 'anon-key';

function counted() {
  const calls = [];
  const fetch = async (input, init) => {
    calls.push({ url: String(input), authorization: new Headers(init?.headers).get('Authorization') });
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { calls, guarded: createUserTokenFetch({ fetch, supabaseUrl: URL_, anonKey: ANON }) };
}

describe('createUserTokenFetch', () => {
  it('una petición de datos sin token de usuario (o con la clave anónima) no sale', async () => {
    const { calls, guarded } = counted();
    for (const path of ['rest/v1/pets', 'storage/v1/object/sign/pet-photos/x', 'functions/v1/f']) {
      await assert.rejects(guarded(`${URL_}/${path}`, { headers: { Authorization: `Bearer ${ANON}` } }), SessionUnavailableError);
      await assert.rejects(guarded(`${URL_}/${path}`), SessionUnavailableError);
    }
    assert.deepEqual(calls, []);
  });

  it('con token de usuario sale; Auth y otras URLs no se tocan', async () => {
    const { calls, guarded } = counted();
    await guarded(`${URL_}/rest/v1/pets`, { headers: { Authorization: 'Bearer user-jwt' } });
    await guarded(`${URL_}/auth/v1/token?grant_type=refresh_token`, { headers: { Authorization: `Bearer ${ANON}` } });
    await guarded('https://example.com/rest/v1/x');
    assert.equal(calls.length, 3);
  });

  it('con supabase-js real y sin sesión: falla en el momento (sin reintentos de postgrest-js) y se trata como sin conexión', async () => {
    const { calls, guarded } = counted();
    const client = createClient(URL_, ANON, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: guarded },
    });
    const started = Date.now();
    const { data, error, status } = await client.from('pets').select('id');
    assert.ok(Date.now() - started < 500, 'postgrest-js no debe esperar a reintentar');
    assert.equal(data, null);
    assert.equal(status, 0);
    assert.ok(isSessionUnavailableError(error));
    assert.equal(toDailyLogError(error).code, 'network');
    assert.deepEqual(calls, []); // nada llegó a la red: ni una lista vacía de `anon`

    const rpc = await client.rpc('can_edit_pet', { p_pet_id: 'x' });
    assert.ok(isSessionUnavailableError(rpc.error));
    assert.deepEqual(calls, []);
  });
});

// Login, renovación y escrituras con la guardia montada como en la app (`lib/supabase.ts`: guardia sobre
// `auth-refresh-fetch.ts`), contra un servidor de Auth falso que responde como GoTrue.
describe('guardia montada como en la app', () => {
  const USER = 'a0000000-0000-4000-8000-000000000001';
  const jwt = (sub, n) =>
    `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub, n })).toString('base64url')}.firma`;
  const sessionBody = (n) => ({
    access_token: jwt(USER, n),
    refresh_token: `refresh-${n}`,
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user: { id: USER, aud: 'authenticated', email: 'a@kitom.test' },
  });

  function appClient() {
    const calls = [];
    let issued = 0;
    const transport = async (input, init) => {
      const url = String(input);
      const authorization = new Headers(init?.headers).get('Authorization');
      calls.push({ path: url.slice(URL_.length), authorization });
      if (url.includes('/auth/v1/token')) {
        issued += 1;
        return new Response(JSON.stringify(sessionBody(issued)), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const disk = new Map();
    const client = createClient(URL_, ANON, {
      auth: {
        storage: {
          getItem: async (key) => disk.get(key) ?? null,
          setItem: async (key, value) => void disk.set(key, value),
          removeItem: async (key) => void disk.delete(key),
        },
        persistSession: true,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: createUserTokenFetch({
          fetch: createAuthRefreshFetch({ fetch: transport, supabaseUrl: URL_ }),
          supabaseUrl: URL_,
          anonKey: ANON,
        }),
      },
    });
    return { client, calls };
  }

  it('iniciar sesión y renovarla funcionan; las peticiones de datos salen con el token vigente', async () => {
    const { client, calls } = appClient();
    assert.ok(isSessionUnavailableError((await client.from('pets').select('id')).error)); // antes de entrar
    const signIn = await client.auth.signInWithPassword({ email: 'a@kitom.test', password: 'x' });
    assert.equal(signIn.error, null);
    await client.from('pets').select('id');
    const refreshed = await client.auth.refreshSession();
    assert.equal(refreshed.error, null);
    await client.from('pets').select('id');

    assert.deepEqual(calls.map((call) => call.path.replace(/\?select=.*$/, '')), [
      '/auth/v1/token?grant_type=password',
      '/rest/v1/pets',
      '/auth/v1/token?grant_type=refresh_token',
      '/rest/v1/pets',
    ]);
    assert.equal(calls[1].authorization, `Bearer ${jwt(USER, 1)}`);
    assert.equal(calls[3].authorization, `Bearer ${jwt(USER, 2)}`);
  });

  it('sin sesión del propietario, el remoto de Daily Logs no envía nada (ni como anon ni con otra sesión)', async () => {
    const { client, calls } = appClient();
    for (const status of ['no_session', 'other_user', 'unavailable']) {
      const remote = createDailyLogRemote(client, { accessToken: async () => ({ status }) });
      const save = await remote.save({ p_pet_id: 'p', p_log_date: '2026-10-19', p_expect_absent: true });
      assert.equal(save.ok, false);
      assert.equal(save.status, 401);
      assert.equal((await remote.fetch('p', '2026-10-19')).status, 401);
    }
    assert.deepEqual(calls, []);
  });
});
