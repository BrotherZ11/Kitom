import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AuthApiError,
  AuthPKCECodeVerifierMissingError,
  AuthRetryableFetchError,
  AuthWeakPasswordError,
} from '@supabase/supabase-js';

import { toAuthErrorCode } from './auth-error-code.ts';

const api = (code, status = 400) => new AuthApiError('mensaje del servidor', status, code);

describe('toAuthErrorCode', () => {
  it('distingue una contraseña filtrada de una débil (reasons de AuthWeakPasswordError)', () => {
    assert.equal(toAuthErrorCode(new AuthWeakPasswordError('weak', 422, ['length'])), 'weak_password');
    assert.equal(toAuthErrorCode(new AuthWeakPasswordError('weak', 422, ['characters'])), 'weak_password');
    assert.equal(toAuthErrorCode(new AuthWeakPasswordError('pwned', 422, ['pwned'])), 'pwned_password');
    assert.equal(toAuthErrorCode(new AuthWeakPasswordError('both', 422, ['length', 'pwned'])), 'pwned_password');
    assert.equal(toAuthErrorCode(api('weak_password', 422)), 'weak_password');
  });

  it('mapea los códigos de la contraseña actual y de la reautenticación', () => {
    assert.equal(toAuthErrorCode(api('current_password_invalid')), 'wrong_current_password');
    assert.equal(toAuthErrorCode(api('current_password_required')), 'missing_fields');
    assert.equal(toAuthErrorCode(api('reauthentication_not_valid')), 'code_invalid');
    assert.equal(toAuthErrorCode(api('reauth_nonce_missing')), 'code_invalid');
    assert.equal(toAuthErrorCode(api('same_password', 422)), 'same_password');
  });

  it('mapea los límites de envío y de peticiones', () => {
    assert.equal(toAuthErrorCode(api('over_email_send_rate_limit', 429)), 'rate_limited');
    assert.equal(toAuthErrorCode(api('over_request_rate_limit', 429)), 'rate_limited');
  });

  it('mantiene el resto de casos', () => {
    assert.equal(toAuthErrorCode(api('invalid_credentials')), 'invalid_credentials');
    assert.equal(toAuthErrorCode(api('email_not_confirmed')), 'email_not_confirmed');
    assert.equal(toAuthErrorCode(api('user_already_exists', 422)), 'email_already_registered');
    assert.equal(toAuthErrorCode(new AuthPKCECodeVerifierMissingError()), 'link_invalid');
    assert.equal(toAuthErrorCode(new AuthRetryableFetchError('fetch failed', 0)), 'network');
    assert.equal(toAuthErrorCode(new TypeError('Network request failed')), 'network');
    assert.equal(toAuthErrorCode(api('algo_nuevo')), 'unknown');
    assert.equal(toAuthErrorCode(new Error('x')), 'unknown');
  });
});
