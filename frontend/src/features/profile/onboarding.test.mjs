import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ONBOARDING_COLLECTION, resolveOnboardingGate, validateProfileName } from './onboarding.ts';

const success = (completedAt) => ({ status: 'success', completedAt });

describe('resolveOnboardingGate', () => {
  it('la marca del dispositivo basta (sin esperar al servidor)', () => {
    assert.equal(resolveOnboardingGate({ canUseServer: true, localDone: true, remote: { status: 'pending' } }), 'complete');
  });

  it('sin sesión utilizable nunca se bloquea', () => {
    assert.equal(resolveOnboardingGate({ canUseServer: false, localDone: false, remote: { status: 'pending' } }), 'complete');
    assert.equal(resolveOnboardingGate({ canUseServer: false, localDone: undefined, remote: { status: 'pending' } }), 'complete');
  });

  it('mientras se lee la marca o el perfil, carga', () => {
    assert.equal(resolveOnboardingGate({ canUseServer: true, localDone: undefined, remote: success(null) }), 'loading');
    assert.equal(resolveOnboardingGate({ canUseServer: true, localDone: false, remote: { status: 'pending' } }), 'loading');
  });

  it('con servidor decide onboarding_completed_at', () => {
    assert.equal(resolveOnboardingGate({ canUseServer: true, localDone: false, remote: success(null) }), 'pending');
    assert.equal(
      resolveOnboardingGate({ canUseServer: true, localDone: false, remote: success('2026-10-21T10:00:00Z') }),
      'complete'
    );
  });

  it('un fallo de red no bloquea; otro error sí se muestra (con reintento)', () => {
    assert.equal(
      resolveOnboardingGate({ canUseServer: true, localDone: false, remote: { status: 'error', offline: true } }),
      'complete'
    );
    assert.equal(
      resolveOnboardingGate({ canUseServer: true, localDone: false, remote: { status: 'error', offline: false } }),
      'error'
    );
  });
});

describe('validateProfileName', () => {
  it('vacío vale (es opcional); más de 60 caracteres no', () => {
    assert.equal(validateProfileName(''), null);
    assert.equal(validateProfileName('  David  '), null);
    assert.equal(validateProfileName('x'.repeat(61)), 'too_long');
  });
});

describe('ONBOARDING_COLLECTION.parse', () => {
  it('solo acepta { done: true }', () => {
    assert.deepEqual(ONBOARDING_COLLECTION.parse({ done: true }), { done: true });
    assert.equal(ONBOARDING_COLLECTION.parse({ done: 'yes' }), null);
    assert.equal(ONBOARDING_COLLECTION.parse(null), null);
  });
});
