import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { callbackDestination, readUrlParams, redirectFlow, shouldCompleteRedirect } from './auth-callback-plan.ts';

describe('readUrlParams / redirectFlow', () => {
  it('une query y fragmento', () => {
    assert.deepEqual(readUrlParams('kitom://auth-callback?flow=recovery&code=abc#error=x'), {
      flow: 'recovery',
      code: 'abc',
      error: 'x',
    });
    assert.deepEqual(readUrlParams('kitom://auth-callback'), {});
  });

  it('reconoce los flujos de la app y nada más', () => {
    assert.equal(redirectFlow('kitom://auth-callback?flow=recovery&code=1'), 'recovery');
    assert.equal(redirectFlow('exp://192.168.1.2:8081/--/auth-callback?flow=oauth&code=1'), 'oauth');
    assert.equal(redirectFlow('http://localhost:8081/auth-callback?code=1&flow=signup'), 'signup');
    assert.equal(redirectFlow('kitom://auth-callback?flow=otro'), null);
    assert.equal(redirectFlow('kitom://auth-callback?code=1'), null);
  });
});

describe('shouldCompleteRedirect', () => {
  it('sin sesión se canjea cualquier enlace', () => {
    for (const flow of ['signup', 'recovery', 'oauth', null]) assert.equal(shouldCompleteRedirect(flow, false), true);
  });

  it('con sesión solo la recuperación (nunca cambia de cuenta por un registro u OAuth)', () => {
    assert.equal(shouldCompleteRedirect('recovery', true), true);
    assert.equal(shouldCompleteRedirect('signup', true), false);
    assert.equal(shouldCompleteRedirect('oauth', true), false);
    assert.equal(shouldCompleteRedirect(null, true), false);
  });
});

describe('callbackDestination', () => {
  const at = (outcome, isSignedIn, isRecoveringPassword = false) =>
    callbackDestination({ outcome: outcome ? { status: outcome } : null, isSignedIn, isRecoveringPassword });

  it('sin sesión se queda (procesando, error o email confirmado)', () => {
    assert.equal(at(null, false), null);
    assert.equal(at('error', false), null);
    assert.equal(at('email_confirmed', false), null);
    // Canje correcto cuya sesión aún no ha llegado al estado de la app: espera.
    assert.equal(at('signed_in', false), null);
  });

  it('recuperación pendiente: siempre a /update-password', () => {
    assert.equal(at('signed_in', true, true), '/update-password');
    assert.equal(at(null, true, true), '/update-password');
    assert.equal(at('skipped', true, true), '/update-password');
  });

  it('con sesión: a la app al terminar el canje o si no hacía falta', () => {
    assert.equal(at('signed_in', true), '/');
    assert.equal(at('skipped', true), '/');
    assert.equal(at(null, true), null);
    // Enlace de recuperación fallido con la sesión iniciada: se muestra el error (botón «Volver a Kitom»).
    assert.equal(at('error', true), null);
  });
});
