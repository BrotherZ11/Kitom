// Pruebas de `chunked-storage.ts` (`npm test`) con un SecureStore falso que puede fallar al leer, escribir
// o borrar: los errores se propagan, nunca se borra nada para «arreglarlos» y un valor escrito a medias
// entre dos cuentas no identifica a ninguna (`persisted-session.ts`, `auth-state.ts`).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createAuthStateMachine } from '../features/auth/auth-state.ts';
import { fakeJwt } from '../features/auth/fake-supabase-auth.mjs';
import { parsePersistedSession, readPersistedIdentity } from '../features/auth/persisted-session.ts';
import { createChunkedStorage } from './chunked-storage.ts';

const KEY = 'sb-test-auth-token';
const A = 'a0000000-0000-4000-8000-00000000000a';
const B = 'b0000000-0000-4000-8000-00000000000b';

/** SecureStore falso: `fail` decide, por operación y clave, si esa llamada falla. */
function fakeSecureStore(fail = () => false) {
  const items = new Map();
  const calls = { delete: 0 };
  const check = (operation, key) => {
    if (fail(operation, key)) throw new Error(`keystore: ${operation} ${key}`);
  };
  return {
    items,
    calls,
    async getItemAsync(key) {
      check('get', key);
      return items.get(key) ?? null;
    },
    async setItemAsync(key, value) {
      check('set', key);
      items.set(key, value);
    },
    async deleteItemAsync(key) {
      calls.delete += 1;
      check('delete', key);
      items.delete(key);
    },
  };
}

/** Sesiones con la misma longitud y forma: el peor caso, en el que un valor mezclado sigue siendo JSON. */
const session = (userId) =>
  JSON.stringify({
    access_token: `${fakeJwt(userId)}.${'x'.repeat(900)}`.replace('.firma.', '.'),
    refresh_token: `refresh-${userId.slice(0, 8)}`,
    expires_at: 1_800_000_000,
    expires_in: 3600,
    token_type: 'bearer',
    user: { id: userId, email: `${userId.slice(0, 8)}@kitom.test`, padding: 'p'.repeat(1200) },
  });

describe('createChunkedStorage', () => {
  it('guarda en trozos, lee el valor entero y borra los trozos sobrantes', async () => {
    const store = fakeSecureStore();
    const storage = createChunkedStorage(store, 1024);
    const long = 'a'.repeat(3000);
    await storage.setItem(KEY, long);
    assert.equal(store.items.get(`${KEY}.count`), '3');
    assert.equal(await storage.getItem(KEY), long);
    await storage.setItem(KEY, 'corto');
    assert.equal(await storage.getItem(KEY), 'corto');
    assert.deepEqual([...store.items.keys()].sort(), [`${KEY}.0`, `${KEY}.count`]);
    await storage.removeItem(KEY);
    assert.equal(await storage.getItem(KEY), null);
    assert.equal(store.items.size, 0);
  });

  it('un trozo perdido invalida el valor (null), sin borrar nada', async () => {
    const store = fakeSecureStore();
    const storage = createChunkedStorage(store, 1024);
    await storage.setItem(KEY, 'b'.repeat(2500));
    store.items.delete(`${KEY}.1`);
    const deletes = store.calls.delete;
    assert.equal(await storage.getItem(KEY), null);
    assert.equal(store.calls.delete, deletes);
    assert.ok(store.items.has(`${KEY}.0`));
  });

  it('leer falla: el error se propaga, no hay identidad y no se borra nada', async () => {
    let broken = false;
    const store = fakeSecureStore((operation) => broken && operation === 'get');
    const storage = createChunkedStorage(store, 1024);
    await storage.setItem(KEY, session(A));
    broken = true;
    const deletes = store.calls.delete;
    await assert.rejects(storage.getItem(KEY), /keystore/);
    assert.deepEqual(await readPersistedIdentity(storage, KEY), { status: 'unreadable' });
    assert.equal(store.calls.delete, deletes);
    broken = false;
    assert.equal(parsePersistedSession(await storage.getItem(KEY)).status, 'found');
  });

  it('escribir otra cuenta falla a medias: el valor mezclado nunca identifica a nadie', async () => {
    let mixedButValidJson = 0;
    // Cada caso: qué escritura de la cuenta B falla (un trozo o el recuento).
    const total = Math.ceil(session(B).length / 1024);
    const failures = [...Array.from({ length: total }, (_, index) => `${KEY}.${index}`), `${KEY}.count`];
    for (const failing of failures) {
      let writingB = false;
      const store = fakeSecureStore((operation, key) => writingB && operation === 'set' && key === failing);
      const storage = createChunkedStorage(store, 1024);
      await storage.setItem(KEY, session(A));
      writingB = true;
      await assert.rejects(storage.setItem(KEY, session(B)), /keystore/);

      const raw = await storage.getItem(KEY);
      const identity = parsePersistedSession(raw);
      let parsed = null;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // JSON no válido: ni supabase-js ni la app lo toman por una sesión.
      }
      if (identity.status === 'found') {
        // Solo si el valor es entero de una cuenta (no mezclado).
        assert.ok(raw === session(A) || raw === session(B), `valor mezclado aceptado (falla ${failing})`);
        continue;
      }
      if (parsed) {
        mixedButValidJson += 1;
        // supabase-js sí lo entregaría como sesión: la app no la acepta como de nadie.
        const machine = createAuthStateMachine();
        machine.authEvent('INITIAL_SESSION', parsed);
        assert.equal(machine.getState().status, 'signed_out', `falla ${failing}`);
      }
    }
    assert.ok(mixedButValidJson > 0, 'el caso peligroso (JSON válido mezclando dos cuentas) se ha probado');
  });

  it('borrar falla: el error se propaga y la sesión sigue legible (no se pierde a medias)', async () => {
    let broken = false;
    const store = fakeSecureStore((operation) => broken && operation === 'delete');
    const storage = createChunkedStorage(store, 1024);
    await storage.setItem(KEY, session(A));
    broken = true;
    await assert.rejects(storage.removeItem(KEY), /keystore/);
    assert.equal(parsePersistedSession(await storage.getItem(KEY)).status, 'found');
  });
});
