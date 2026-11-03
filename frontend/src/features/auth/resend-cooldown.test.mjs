import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { cooldownRemainingSeconds, RESEND_COOLDOWN_MS } from './resend-cooldown.ts';

describe('cooldownRemainingSeconds', () => {
  it('sin envío previo se puede reenviar', () => {
    assert.equal(cooldownRemainingSeconds(null, 1_000), 0);
  });

  it('cuenta hacia atrás 60 s redondeando hacia arriba', () => {
    assert.equal(RESEND_COOLDOWN_MS, 60_000);
    assert.equal(cooldownRemainingSeconds(0, 0), 60);
    assert.equal(cooldownRemainingSeconds(0, 1), 60);
    assert.equal(cooldownRemainingSeconds(0, 59_001), 1);
    assert.equal(cooldownRemainingSeconds(0, 60_000), 0);
    assert.equal(cooldownRemainingSeconds(0, 120_000), 0);
  });

  it('un reloj que retrocede no alarga la espera', () => {
    assert.equal(cooldownRemainingSeconds(100_000, 0), 60);
  });

  it('admite otra duración', () => {
    assert.equal(cooldownRemainingSeconds(0, 0, 5_000), 5);
  });
});
