import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  chooseGoogleSignInMethod,
  googleTokenErrorCode,
  interpretNativeSignIn,
  interpretNativeSignInError,
} from './google-sign-in-plan.ts';

// Valores reales de `statusCodes` en Android (constantes del módulo nativo).
const codes = { SIGN_IN_CANCELLED: '12501', IN_PROGRESS: 'ASYNC_OP_IN_PROGRESS', PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE' };
const clientId = '123-abc.apps.googleusercontent.com';

describe('chooseGoogleSignInMethod', () => {
  it('Android con módulo y client ID: nativo', () => {
    assert.equal(chooseGoogleSignInMethod({ platform: 'android', webClientId: clientId, hasNativeModule: true }), 'native');
  });

  it('sin módulo nativo (Expo Go) o sin client ID: navegador', () => {
    assert.equal(chooseGoogleSignInMethod({ platform: 'android', webClientId: clientId, hasNativeModule: false }), 'browser');
    assert.equal(chooseGoogleSignInMethod({ platform: 'android', webClientId: undefined, hasNativeModule: true }), 'browser');
    assert.equal(chooseGoogleSignInMethod({ platform: 'android', webClientId: '  ', hasNativeModule: true }), 'browser');
  });

  it('web e iOS: navegador', () => {
    assert.equal(chooseGoogleSignInMethod({ platform: 'web', webClientId: clientId, hasNativeModule: true }), 'browser');
    assert.equal(chooseGoogleSignInMethod({ platform: 'ios', webClientId: clientId, hasNativeModule: true }), 'browser');
  });
});

describe('interpretNativeSignIn', () => {
  it('éxito con ID token: se canjea', () => {
    assert.deepEqual(interpretNativeSignIn({ type: 'success', data: { idToken: 'tok' } }), { type: 'token', idToken: 'tok' });
  });

  it('éxito sin ID token: fallo de configuración', () => {
    assert.deepEqual(interpretNativeSignIn({ type: 'success', data: { idToken: null } }), { type: 'error', error: 'oauth_failed' });
  });

  it('cancelado: no es un error', () => {
    assert.deepEqual(interpretNativeSignIn({ type: 'cancelled', data: null }), { type: 'cancelled' });
  });
});

describe('interpretNativeSignInError', () => {
  const withCode = (code) => Object.assign(new Error('x'), { code });

  it('cancelar o un acceso ya en curso: sin mensaje', () => {
    assert.deepEqual(interpretNativeSignInError(withCode('12501'), codes), { type: 'cancelled' });
    assert.deepEqual(interpretNativeSignInError(withCode('ASYNC_OP_IN_PROGRESS'), codes), { type: 'cancelled' });
  });

  it('sin Google Play services', () => {
    assert.deepEqual(interpretNativeSignInError(withCode('PLAY_SERVICES_NOT_AVAILABLE'), codes), {
      type: 'error',
      error: 'google_play_services',
    });
  });

  it('sin red (CommonStatusCodes.NETWORK_ERROR, como texto o número)', () => {
    assert.deepEqual(interpretNativeSignInError(withCode('7'), codes), { type: 'error', error: 'network' });
    assert.deepEqual(interpretNativeSignInError(withCode(7), codes), { type: 'error', error: 'network' });
  });

  it('DEVELOPER_ERROR y lo desconocido: fallo genérico de Google', () => {
    assert.deepEqual(interpretNativeSignInError(withCode('10'), codes), { type: 'error', error: 'oauth_failed' });
    assert.deepEqual(interpretNativeSignInError(new Error('boom'), codes), { type: 'error', error: 'oauth_failed' });
    assert.deepEqual(interpretNativeSignInError(null, codes), { type: 'error', error: 'oauth_failed' });
  });
});

describe('googleTokenErrorCode', () => {
  it('lo desconocido de Supabase se explica como fallo de Google; lo conocido se conserva', () => {
    assert.equal(googleTokenErrorCode('unknown'), 'oauth_failed');
    assert.equal(googleTokenErrorCode('network'), 'network');
    assert.equal(googleTokenErrorCode('rate_limited'), 'rate_limited');
  });
});
