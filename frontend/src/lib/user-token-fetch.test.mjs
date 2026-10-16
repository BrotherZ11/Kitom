// Pruebas de `user-token-fetch.ts` (`npm test`), también con el cliente real de supabase-js (sin red:
// el `fetch` de debajo se cuenta y nunca llega a llamarse cuando la guardia corta).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createClient } from '@supabase/supabase-js';

import { toDailyLogError } from '../features/daily-logs/daily-log-errors.ts';
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
