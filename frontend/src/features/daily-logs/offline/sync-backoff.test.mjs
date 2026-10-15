// Pruebas de `sync-backoff.ts` con el runner de Node (`npm test`). Ver frontend/CLAUDE.md.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MAX_SYNC_ATTEMPTS,
  SYNC_BACKOFF_BASE_MS,
  SYNC_BACKOFF_MAX_MS,
  backoffDelayMs,
  isAttemptDue,
  nextAttemptAt,
} from './sync-backoff.ts';

const NOW = Date.UTC(2026, 9, 13, 10, 0, 0);

describe('backoffDelayMs', () => {
  it('es determinista con el jitter inyectado', () => {
    const delays = (random) => [1, 2, 3, 4, 5].map((attempt) => backoffDelayMs(attempt, { random: () => random }));
    assert.deepEqual(delays(0), [1_000, 2_000, 4_000, 8_000, 16_000]);
    assert.deepEqual(delays(0.5), [1_500, 3_000, 6_000, 12_000, 24_000]);
    assert.deepEqual(delays(1), [2_000, 4_000, 8_000, 16_000, 32_000]);
  });

  it('nunca supera el tope ni baja de la mitad del tope exponencial', () => {
    for (const random of [0, 0.25, 0.999]) {
      for (let attempt = 1; attempt <= 40; attempt += 1) {
        const delay = backoffDelayMs(attempt, { random: () => random });
        const ceiling = Math.min(SYNC_BACKOFF_MAX_MS, SYNC_BACKOFF_BASE_MS * 2 ** (attempt - 1));
        assert.ok(delay >= ceiling / 2 && delay <= ceiling, `intento ${attempt}: ${delay}`);
      }
    }
    assert.equal(backoffDelayMs(1_000, { random: () => 1 }), SYNC_BACKOFF_MAX_MS);
  });

  it('acepta base y tope propios, y tolera valores raros', () => {
    assert.equal(backoffDelayMs(3, { baseMs: 100, maxMs: 250, random: () => 1 }), 250);
    assert.equal(backoffDelayMs(0, { random: () => 0 }), 1_000);
    assert.equal(backoffDelayMs(Number.NaN, { random: () => 0 }), 1_000);
    assert.equal(backoffDelayMs(1, { random: () => 7 }), 2_000);
    assert.equal(backoffDelayMs(1, { random: () => -3 }), 1_000);
    // Un azar no válido da la espera más larga, nunca una espera sin definir.
    assert.equal(backoffDelayMs(1, { random: () => Number.NaN }), 2_000);
    assert.equal(backoffDelayMs(1, { random: () => undefined }), 2_000);
  });

  it('sin `random` usa Math.random dentro del mismo rango', () => {
    const delay = backoffDelayMs(2);
    assert.ok(delay >= 2_000 && delay <= 4_000);
  });
});

describe('nextAttemptAt / isAttemptDue', () => {
  it('programa el siguiente intento a partir del reloj inyectado', () => {
    assert.equal(nextAttemptAt(1, NOW, { random: () => 0.5 }), NOW + 1_500);
    assert.equal(nextAttemptAt(3, NOW, { random: () => 0 }), NOW + 4_000);
  });

  it('toca cuando llega la hora; `null` es cuanto antes', () => {
    const at = nextAttemptAt(2, NOW, { random: () => 0.5 });
    assert.equal(isAttemptDue(null, NOW), true);
    assert.equal(isAttemptDue(at, NOW), false);
    assert.equal(isAttemptDue(at, at - 1), false);
    assert.equal(isAttemptDue(at, at), true);
    assert.equal(isAttemptDue(at, at + 60_000), true);
  });

  it('una espera mayor que el tope (reloj del dispositivo atrasado) no bloquea la operación', () => {
    const at = NOW + 1_000;
    assert.equal(isAttemptDue(at, at - SYNC_BACKOFF_MAX_MS), false);
    assert.equal(isAttemptDue(at, at - SYNC_BACKOFF_MAX_MS - 1), true);
    assert.equal(isAttemptDue(at, NOW - 24 * 60 * 60_000), true);
  });

  it('hay un límite de intentos razonable', () => {
    assert.ok(Number.isInteger(MAX_SYNC_ATTEMPTS) && MAX_SYNC_ATTEMPTS >= 3);
  });
});
