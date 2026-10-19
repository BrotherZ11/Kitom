import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { authErrorField } from './auth-error-field.ts';

describe('authErrorField', () => {
  it('pone en el email los errores del email', () => {
    assert.equal(authErrorField('invalid_email'), 'email');
    assert.equal(authErrorField('email_already_registered'), 'email');
  });

  it('pone en la contraseña los errores de credenciales y de contraseña', () => {
    assert.equal(authErrorField('invalid_credentials'), 'password');
    assert.equal(authErrorField('weak_password'), 'password');
    assert.equal(authErrorField('same_password'), 'password');
  });

  it('deja en la alerta del formulario el resto (incluido missing_fields)', () => {
    for (const code of [
      'missing_fields',
      'email_not_confirmed',
      'link_invalid',
      'oauth_failed',
      'rate_limited',
      'signup_disabled',
      'network',
      'unknown',
    ]) {
      assert.equal(authErrorField(code), null, code);
    }
  });
});
