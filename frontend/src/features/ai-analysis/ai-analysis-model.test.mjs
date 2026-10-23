import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isTerminal,
  nextMonthStart,
  pollState,
  SLOW_AFTER_MS,
  toEntitlement,
  toggleSymptom,
  toRequestErrorCode,
} from './ai-analysis-model.ts';

describe('estado del análisis', () => {
  it('completed y failed son finales', () => {
    assert.equal(isTerminal('completed'), true);
    assert.equal(isTerminal('failed'), true);
    assert.equal(isTerminal('pending'), false);
    assert.equal(isTerminal('processing'), false);
  });

  it('se espera hasta el umbral y después se avisa de que tarda', () => {
    assert.equal(pollState('processing', 0, 1_000), 'waiting');
    assert.equal(pollState('pending', 0, SLOW_AFTER_MS + 1), 'slow');
    assert.equal(pollState('completed', 0, SLOW_AFTER_MS + 1), 'done');
  });
});

describe('toRequestErrorCode', () => {
  it('reconoce los mensajes de request_ai_analysis y la red', () => {
    assert.equal(toRequestErrorCode({ message: 'Has alcanzado tu límite mensual de análisis de IA (3 de 3)' }), 'limit');
    assert.equal(toRequestErrorCode({ message: 'El síntoma x no es compatible con la especie de esta mascota' }), 'invalid_symptoms');
    assert.equal(toRequestErrorCode({ message: 'Mascota no encontrada o archivada' }), 'archived');
    assert.equal(toRequestErrorCode({ message: 'No tienes acceso de edición sobre esta mascota' }), 'not_allowed');
    assert.equal(toRequestErrorCode(new TypeError('Network request failed')), 'network');
    assert.equal(toRequestErrorCode({ message: 'session_unavailable: request not sent' }), 'network');
    assert.equal(toRequestErrorCode({ message: 'otra cosa' }), 'unknown');
  });
});

describe('cupo', () => {
  it('convierte la fila del servidor y, sin fila, no deja pedir', () => {
    assert.deepEqual(
      toEntitlement({ can_request: true, would_use_full_history: false, monthly_used: 1, monthly_limit: 3 }),
      { canRequest: true, usedThisMonth: 1, monthlyLimit: 3, fullHistory: false }
    );
    assert.equal(toEntitlement(undefined).canRequest, false);
  });

  it('el cupo se renueva el día 1 del mes siguiente', () => {
    assert.equal(nextMonthStart(new Date(2026, 11, 20)).getTime(), new Date(2027, 0, 1).getTime());
  });
});

describe('toggleSymptom', () => {
  it('añade y quita manteniendo el orden del catálogo', () => {
    const order = ['a', 'b', 'c'];
    assert.deepEqual(toggleSymptom([], 'c', order), ['c']);
    assert.deepEqual(toggleSymptom(['c'], 'a', order), ['a', 'c']);
    assert.deepEqual(toggleSymptom(['a', 'c'], 'a', order), ['c']);
  });
});
