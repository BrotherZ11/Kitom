import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { en } from '../../i18n/locales/en.ts';
import { es } from '../../i18n/locales/es.ts';
import {
  MIN_PASSWORD_LENGTH,
  passwordLength,
  validateCredentials,
  validateNewPassword,
  validatePasswordChange,
  validateSignUp,
} from './validation.ts';

describe('validateNewPassword', () => {
  it('exige al menos MIN_PASSWORD_LENGTH (8) caracteres', () => {
    assert.equal(MIN_PASSWORD_LENGTH, 8);
    assert.equal(validateNewPassword(''), 'missing_fields');
    assert.equal(validateNewPassword('1234567'), 'password_too_short');
    assert.equal(validateNewPassword('12345678'), null);
  });

  it('cuenta caracteres, no unidades UTF-16 (nunca menos que el servidor)', () => {
    assert.equal(passwordLength('🐶🐱'), 2);
    assert.equal(validateNewPassword('🐶🐱🐶🐱🐶🐱🐶'), 'password_too_short');
    assert.equal(validateNewPassword('ñandú-12'), null);
  });

  it('la regla visible dice el mismo número en todos los idiomas', () => {
    for (const locale of [es, en]) {
      assert.match(locale.auth.passwordRule, new RegExp(`\\b${MIN_PASSWORD_LENGTH}\\b`));
      assert.match(locale.auth.errors.password_too_short, new RegExp(`\\b${MIN_PASSWORD_LENGTH}\\b`));
    }
  });
});

describe('validateSignUp', () => {
  it('comprueba email, contraseña y Términos, en ese orden', () => {
    assert.equal(validateSignUp('', '', false), 'missing_fields');
    assert.equal(validateSignUp('no-es-email', '12345678', true), 'invalid_email');
    assert.equal(validateSignUp('a@b.co', 'corta', true), 'password_too_short');
    assert.equal(validateSignUp('a@b.co', '12345678', false), 'terms_not_accepted');
    assert.equal(validateSignUp(' a@b.co ', '12345678', true), null);
  });
});

describe('validateCredentials', () => {
  it('no aplica la longitud mínima al iniciar sesión (cuentas anteriores a la regla)', () => {
    assert.equal(validateCredentials('a@b.co', '123456'), null);
    assert.equal(validateCredentials('a@b.co', ''), 'missing_fields');
  });
});

describe('validatePasswordChange', () => {
  it('recuperación: nueva válida y repetida', () => {
    assert.equal(validatePasswordChange({ password: '', confirmation: '' }), 'missing_fields');
    assert.equal(validatePasswordChange({ password: 'corta', confirmation: 'corta' }), 'password_too_short');
    assert.equal(validatePasswordChange({ password: '12345678', confirmation: '12345679' }), 'password_mismatch');
    assert.equal(validatePasswordChange({ password: '12345678', confirmation: '12345678' }), null);
  });

  it('ajustes: también la actual', () => {
    assert.equal(
      validatePasswordChange({ currentPassword: '', password: '12345678', confirmation: '12345678' }),
      'missing_fields'
    );
    assert.equal(
      validatePasswordChange({ currentPassword: 'vieja', password: '12345678', confirmation: '12345678' }),
      null
    );
  });
});
