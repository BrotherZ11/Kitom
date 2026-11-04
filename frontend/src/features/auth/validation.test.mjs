import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { en } from '../../i18n/locales/en.ts';
import { es } from '../../i18n/locales/es.ts';
import {
  MIN_PASSWORD_LENGTH,
  passwordLength,
  suggestEmailCorrection,
  validateCredentials,
  validateEmail,
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
  it('comprueba email y contraseña, en ese orden', () => {
    assert.equal(validateSignUp('', ''), 'missing_fields');
    assert.equal(validateSignUp('no-es-email', '12345678'), 'invalid_email');
    assert.equal(validateSignUp('a@b.co', 'corta'), 'password_too_short');
    assert.equal(validateSignUp(' a@b.co ', '12345678'), null);
  });
});

describe('validateEmail', () => {
  it('acepta direcciones reales, también con alias, subdominios y mayúsculas', () => {
    for (const email of ['a@b.co', 'ana.garcia+kitom@correo.example.es', 'ANA@GMAIL.COM', ' ana_1@mi-dominio.com ']) {
      assert.equal(validateEmail(email), null, email);
    }
  });

  it('rechaza lo que no puede ser un buzón', () => {
    for (const email of ['ana', 'ana@', '@gmail.com', 'ana@gmail', 'ana@gmail.c', 'ana@gmail..com', 'ana..b@gmail.com', '.ana@gmail.com', 'ana.@gmail.com', 'an a@gmail.com', 'ana@-gmail.com', 'ana@gmail-.com', 'ana@gmail.c0m', 'a@b@gmail.com']) {
      assert.equal(validateEmail(email), 'invalid_email', email);
    }
    assert.equal(validateEmail(`${'a'.repeat(250)}@b.co`), 'invalid_email');
  });
});

describe('suggestEmailCorrection', () => {
  it('propone el dominio habitual ante una errata', () => {
    assert.equal(suggestEmailCorrection('ana@gmial.com'), 'ana@gmail.com');
    assert.equal(suggestEmailCorrection('ana@gmail.con'), 'ana@gmail.com');
    assert.equal(suggestEmailCorrection(' ana@hotmial.com '), 'ana@hotmail.com');
    assert.equal(suggestEmailCorrection('ana@outlok.es'), 'ana@outlook.es');
  });

  it('calla si el dominio es correcto, lejano o está a medio escribir', () => {
    for (const email of ['ana@gmail.com', 'ana@hotmail.es', 'ana@empresa.es', 'ana@kitom.app', 'ana', 'ana@', 'ana@gm']) {
      assert.equal(suggestEmailCorrection(email), null, email);
    }
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
