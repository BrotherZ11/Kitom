import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveLocale } from './locale.ts';

describe('resolveLocale', () => {
  it('español en cualquier región', () => {
    assert.equal(resolveLocale(['es-ES']), 'es');
    assert.equal(resolveLocale(['es_MX']), 'es');
    assert.equal(resolveLocale(['ES']), 'es');
  });

  it('cualquier otro idioma usa inglés (respaldo del producto)', () => {
    assert.equal(resolveLocale(['en-GB']), 'en');
    assert.equal(resolveLocale(['fr-FR', 'es-ES']), 'en');
    assert.equal(resolveLocale(['ca-ES']), 'en');
  });

  it('decide el primero válido; sin datos, español', () => {
    assert.equal(resolveLocale([null, '', ' es-AR ']), 'es');
    assert.equal(resolveLocale([]), 'es');
    assert.equal(resolveLocale([undefined]), 'es');
  });
});
