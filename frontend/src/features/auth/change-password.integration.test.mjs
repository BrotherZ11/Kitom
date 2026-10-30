// Cambio de contraseña con la contraseña actual (SEC-17) contra el Supabase LOCAL, con supabase-js real.
// `npm run test:integration`; en `npm test` se omiten. Nunca contra `kitom-dev`.
//
// Comprueba lo que no se ve con el Auth falso: que la comprobación de la contraseña actual con un cliente
// aparte no toca la sesión de la app (ni eventos ni tokens) y que la sesión de comprobación queda revocada
// en el servidor. No prueba la reautenticación por código (el local tiene `secure_password_change = false`)
// ni el reenvío de emails (el local confirma solo y limita los envíos a 2 por hora para todo el proyecto).
//
// Crea usuarios `it-…@kitom.test` (quedan en el Auth local).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { createClient } from '@supabase/supabase-js';

import { toAuthErrorCode } from './auth-error-code.ts';
import { changePassword, verifyCurrentPassword } from './change-password.ts';

const URL_ = process.env.KITOM_IT_SUPABASE_URL;
const ANON_KEY = process.env.KITOM_IT_SUPABASE_ANON_KEY;
const isLocal = URL_ !== undefined && ['127.0.0.1', 'localhost'].includes(new URL(URL_).hostname);
const skip = !URL_ || !ANON_KEY ? 'sin Supabase local (npm run test:integration)' : !isLocal ? 'la URL no es local' : false;

const memoryOnly = () => ({ persistSession: false, autoRefreshToken: false, detectSessionInUrl: false });

/** La app: cliente con sesión guardada (en memoria) y registro de los eventos de Auth. */
async function appWithUser() {
  const disk = new Map();
  const storage = {
    getItem: async (key) => disk.get(key) ?? null,
    setItem: async (key, value) => void disk.set(key, value),
    removeItem: async (key) => void disk.delete(key),
  };
  const client = createClient(URL_, ANON_KEY, {
    auth: { storage, storageKey: 'sb-it-password-auth-token', persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const email = `it-${randomUUID()}@kitom.test`;
  const password = `It-${randomUUID()}`;
  const { data, error } = await client.auth.signUp({ email, password });
  if (error || !data.session) throw error ?? new Error('El Auth local exige confirmar el email');
  const events = [];
  client.auth.onAuthStateChange((event) => events.push(event));
  await new Promise((resolve) => setTimeout(resolve, 50)); // INITIAL_SESSION
  events.length = 0;
  return { client, disk, events, email, password, userId: data.user.id };
}

/** Cliente de comprobación como `password-check-client.ts`, guardando el token de renovación emitido. */
function checkClients() {
  const issued = [];
  return {
    issued,
    createCheckClient() {
      const auth = createClient(URL_, ANON_KEY, { auth: { ...memoryOnly(), storageKey: 'kitom-password-check' } }).auth;
      return {
        async signInWithPassword(credentials) {
          const result = await auth.signInWithPassword(credentials);
          if (result.data.session) issued.push(result.data.session.refresh_token);
          return result;
        },
        signOut: (options) => auth.signOut(options),
      };
    },
  };
}

describe('cambio de contraseña (Supabase local)', { skip }, () => {
  it('comprobar la actual no toca la sesión de la app y revoca la sesión de comprobación', async () => {
    const app = await appWithUser();
    const before = [...app.disk.values()].join('|');
    const check = checkClients();

    assert.equal(await verifyCurrentPassword(check, { userId: app.userId, email: app.email, password: app.password }), null);
    assert.equal(
      await verifyCurrentPassword(check, { userId: app.userId, email: app.email, password: 'no-es-esta' }),
      'wrong_current_password'
    );

    assert.equal([...app.disk.values()].join('|'), before, 'la sesión guardada de la app no cambia');
    assert.deepEqual(app.events, [], 'la app no recibe eventos de Auth');
    assert.equal(check.issued.length, 1);
    const reuse = await createClient(URL_, ANON_KEY, { auth: memoryOnly() }).auth.refreshSession({ refresh_token: check.issued[0] });
    assert.ok(reuse.error, 'la sesión de comprobación está revocada en el servidor');
    // La de la app sigue valiendo.
    const { data } = await app.client.auth.getUser();
    assert.equal(data.user?.id, app.userId);
  });

  it('cambia la contraseña solo con la actual correcta', async () => {
    const app = await appWithUser();
    const auth = {
      ...checkClients(),
      updateUser: (attributes) => app.client.auth.updateUser(attributes),
      reauthenticate: () => app.client.auth.reauthenticate(),
    };
    const next = `Nueva-${randomUUID()}`;

    assert.deepEqual(
      await changePassword(auth, { userId: app.userId, email: app.email, currentPassword: 'mala', newPassword: next }),
      { status: 'error', error: 'wrong_current_password' }
    );
    assert.deepEqual(
      await changePassword(auth, { userId: app.userId, email: app.email, currentPassword: app.password, newPassword: next }),
      { status: 'done' }
    );

    const fresh = () => createClient(URL_, ANON_KEY, { auth: memoryOnly() }).auth;
    assert.ok((await fresh().signInWithPassword({ email: app.email, password: app.password })).error, 'la anterior ya no vale');
    const withNew = await fresh().signInWithPassword({ email: app.email, password: next });
    assert.equal(withNew.error, null);
    assert.equal(withNew.data.user?.id, app.userId);
  });

  it('una contraseña que el servidor rechaza por longitud llega como weak_password', async () => {
    const app = await appWithUser();
    // El local exige 6 (la app, 8): se envía directamente para ver el error real del servidor.
    const { error } = await app.client.auth.updateUser({ password: '12345' });
    assert.equal(toAuthErrorCode(error), 'weak_password');
  });
});
