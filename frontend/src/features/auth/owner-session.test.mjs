// Pruebas de `owner-session.ts` (`npm test`): el token solo se entrega si la sesión y el propio token
// son del propietario.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { describe, it } from 'node:test';

import { createOwnerAccessToken, jwtSubject, ownerTokenOrThrow } from './owner-session.ts';

const A = 'a0000000-0000-4000-8000-000000000001';
const B = 'a0000000-0000-4000-8000-000000000002';

/** JWT con `sub` (la firma no se comprueba en el cliente: eso lo hace el servidor). */
const fakeJwt = (sub) =>
  `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub, role: 'authenticated' })).toString('base64url')}.firma`;

const authWith = (session, error = null) => ({ getSession: async () => ({ data: { session }, error }) });
const sessionOf = (userId, token = fakeJwt(userId)) => ({ access_token: token, user: { id: userId } });

describe('jwtSubject', () => {
  it('lee el `sub` del payload (base64url, sin relleno)', () => {
    assert.equal(jwtSubject(fakeJwt(A)), A);
  });

  it('lo que no es un JWT legible no tiene sujeto', () => {
    for (const token of ['', 'abc', 'a.b', 'a.%%%.c', `a.${Buffer.from('[1]').toString('base64url')}.c`, `a.${Buffer.from('{"sub":""}').toString('base64url')}.c`]) {
      assert.equal(jwtSubject(token), null, token);
    }
  });
});

describe('createOwnerAccessToken', () => {
  it('sesión del propietario → su token', async () => {
    assert.deepEqual(await createOwnerAccessToken(authWith(sessionOf(A)), A)(), { status: 'ok', token: fakeJwt(A) });
  });

  it('sesión de otra cuenta → sin token', async () => {
    assert.deepEqual(await createOwnerAccessToken(authWith(sessionOf(B)), A)(), { status: 'other_user' });
  });

  it('sesión del propietario con un token de otra cuenta (o ilegible) → sin token (falla cerrado)', async () => {
    assert.deepEqual(await createOwnerAccessToken(authWith(sessionOf(A, fakeJwt(B))), A)(), { status: 'other_user' });
    assert.deepEqual(await createOwnerAccessToken(authWith(sessionOf(A, 'opaco')), A)(), { status: 'other_user' });
  });

  it('sin sesión → no_session; error al leerla o renovarla → unavailable', async () => {
    assert.deepEqual(await createOwnerAccessToken(authWith(null), A)(), { status: 'no_session' });
    assert.deepEqual(await createOwnerAccessToken(authWith(null, { name: 'AuthRetryableFetchError' }), A)(), {
      status: 'unavailable',
    });
    const throwing = { getSession: async () => Promise.reject(new Error('lock')) };
    assert.deepEqual(await createOwnerAccessToken(throwing, A)(), { status: 'unavailable' });
  });

  it('cada llamada consulta la sesión vigente en ese momento', async () => {
    const auth = { session: sessionOf(A), getSession: async () => ({ data: { session: auth.session }, error: null }) };
    const token = createOwnerAccessToken(auth, A);
    assert.equal((await token()).status, 'ok');
    auth.session = sessionOf(B);
    assert.equal((await token()).status, 'other_user');
  });
});

describe('ownerTokenOrThrow (opción `accessToken` de un cliente por propietario)', () => {
  const refused = () => new Error('refused');

  it('sesión del propietario → su token', async () => {
    const provider = ownerTokenOrThrow(createOwnerAccessToken(authWith(sessionOf(A)), A), refused);
    assert.equal(await provider(), fakeJwt(A));
  });

  it('otra cuenta, sin sesión o sesión ilegible → lanza (nunca `null`: supabase-js usaría la clave anónima)', async () => {
    for (const auth of [authWith(sessionOf(B)), authWith(null), authWith(null, new Error('refresh')), authWith(sessionOf(A, 'no-jwt'))]) {
      await assert.rejects(ownerTokenOrThrow(createOwnerAccessToken(auth, A), refused)(), /refused/);
    }
    const throwing = { getSession: async () => { throw new Error('storage'); } };
    await assert.rejects(ownerTokenOrThrow(createOwnerAccessToken(throwing, A), refused)(), /refused/);
  });

  it('cada petición vuelve a comprobar la sesión: al cambiar de cuenta deja de dar el token', async () => {
    const auth = { session: sessionOf(A), getSession: async () => ({ data: { session: auth.session }, error: null }) };
    const provider = ownerTokenOrThrow(createOwnerAccessToken(auth, A), refused);
    assert.equal(await provider(), fakeJwt(A));
    auth.session = sessionOf(B);
    await assert.rejects(provider(), /refused/);
  });
});
