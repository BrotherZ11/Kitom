import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';

import { accountHasPassword, changePassword, requestCode, verifyCurrentPassword } from './change-password.ts';

const USER = { userId: 'u1', email: 'ana@kitom.test' };

/** Auth falso: contraseña actual `vieja`; registra lo que se llama. */
function fakeAuth({ password = 'vieja', userId = 'u1', updateErrors = [], reauthError = null, signInThrows = null } = {}) {
  const calls = [];
  const auth = {
    calls,
    createCheckClient() {
      calls.push('createCheckClient');
      return {
        async signInWithPassword(credentials) {
          calls.push(['signIn', credentials.email]);
          if (signInThrows) throw signInThrows;
          if (credentials.password !== password) {
            return { data: { user: null, session: null }, error: new AuthApiError('Invalid login credentials', 400, 'invalid_credentials') };
          }
          return { data: { user: { id: userId }, session: { access_token: 't' } }, error: null };
        },
        async signOut(options) {
          calls.push(['checkSignOut', options.scope]);
          return { error: null };
        },
      };
    },
    async updateUser(attributes) {
      calls.push(['updateUser', attributes]);
      return { error: updateErrors.shift() ?? null };
    },
    async reauthenticate() {
      calls.push('reauthenticate');
      return { error: reauthError };
    },
  };
  return auth;
}

describe('verifyCurrentPassword', () => {
  it('correcta: con un cliente aparte cuya sesión se cierra (solo esa) en el servidor', async () => {
    const auth = fakeAuth();
    assert.equal(await verifyCurrentPassword(auth, { ...USER, password: 'vieja' }), null);
    assert.deepEqual(auth.calls, ['createCheckClient', ['signIn', USER.email], ['checkSignOut', 'local']]);
  });

  it('incorrecta: wrong_current_password, sin sesión que cerrar', async () => {
    const auth = fakeAuth();
    assert.equal(await verifyCurrentPassword(auth, { ...USER, password: 'mala' }), 'wrong_current_password');
    assert.equal(auth.calls.some((call) => call[0] === 'checkSignOut'), false);
  });

  it('otra cuenta con ese email (p. ej. el email cambió): no se da por buena', async () => {
    const auth = fakeAuth({ userId: 'otro' });
    assert.equal(await verifyCurrentPassword(auth, { ...USER, password: 'vieja' }), 'wrong_current_password');
    assert.deepEqual(auth.calls.at(-1), ['checkSignOut', 'local']);
  });

  it('sin red: network', async () => {
    const auth = fakeAuth({ signInThrows: new AuthRetryableFetchError('fetch failed', 0) });
    assert.equal(await verifyCurrentPassword(auth, { ...USER, password: 'vieja' }), 'network');
  });
});

describe('changePassword', () => {
  it('comprueba la actual antes de cambiar y envía current_password', async () => {
    const auth = fakeAuth();
    const result = await changePassword(auth, { ...USER, currentPassword: 'vieja', newPassword: 'nueva-123' });
    assert.deepEqual(result, { status: 'done' });
    assert.deepEqual(auth.calls.at(-1), ['updateUser', { password: 'nueva-123', current_password: 'vieja' }]);
  });

  it('con la actual incorrecta no llama a updateUser', async () => {
    const auth = fakeAuth();
    const result = await changePassword(auth, { ...USER, currentPassword: 'mala', newPassword: 'nueva-123' });
    assert.deepEqual(result, { status: 'error', error: 'wrong_current_password' });
    assert.equal(auth.calls.some((call) => call[0] === 'updateUser'), false);
  });

  it('reauthentication_needed: pide el código y repite con nonce sin volver a comprobar la actual', async () => {
    const auth = fakeAuth({ updateErrors: [new AuthApiError('Password update requires reauthentication', 400, 'reauthentication_needed')] });
    const first = await changePassword(auth, { ...USER, currentPassword: 'vieja', newPassword: 'nueva-123' });
    assert.deepEqual(first, { status: 'needs_code' });
    assert.equal(auth.calls.at(-1), 'reauthenticate');

    auth.calls.length = 0;
    const second = await changePassword(auth, { ...USER, currentPassword: 'vieja', newPassword: 'nueva-123', nonce: ' 123456 ' });
    assert.deepEqual(second, { status: 'done' });
    assert.deepEqual(auth.calls, [['updateUser', { password: 'nueva-123', current_password: 'vieja', nonce: '123456' }]]);
  });

  it('código incorrecto: code_invalid (no se pide otro solo)', async () => {
    const auth = fakeAuth({ updateErrors: [new AuthApiError('Invalid nonce', 400, 'reauthentication_not_valid')] });
    const result = await changePassword(auth, { ...USER, currentPassword: 'vieja', newPassword: 'nueva-123', nonce: '000000' });
    assert.deepEqual(result, { status: 'error', error: 'code_invalid' });
    assert.equal(auth.calls.includes('reauthenticate'), false);
  });

  it('errores del servidor mapeados (misma contraseña, actual rechazada por el servidor)', async () => {
    const same = fakeAuth({ updateErrors: [new AuthApiError('same', 422, 'same_password')] });
    assert.deepEqual(await changePassword(same, { ...USER, currentPassword: 'vieja', newPassword: 'vieja-123' }), {
      status: 'error',
      error: 'same_password',
    });
    const rejected = fakeAuth({ updateErrors: [new AuthApiError('bad', 400, 'current_password_invalid')] });
    assert.deepEqual(await changePassword(rejected, { ...USER, currentPassword: 'vieja', newPassword: 'nueva-123' }), {
      status: 'error',
      error: 'wrong_current_password',
    });
  });

  it('pedir el código con límite de envíos: rate_limited', async () => {
    const auth = fakeAuth({ reauthError: new AuthApiError('wait', 429, 'over_email_send_rate_limit') });
    assert.deepEqual(await requestCode(auth), { status: 'error', error: 'rate_limited' });
  });
});

describe('accountHasPassword', () => {
  it('solo Google: no; con email: sí; desconocido: se supone que sí', () => {
    assert.equal(accountHasPassword([{ provider: 'google' }]), false);
    assert.equal(accountHasPassword([{ provider: 'google' }, { provider: 'email' }]), true);
    assert.equal(accountHasPassword([{ provider: 'email' }]), true);
    assert.equal(accountHasPassword([]), true);
    assert.equal(accountHasPassword(undefined), true);
  });
});
