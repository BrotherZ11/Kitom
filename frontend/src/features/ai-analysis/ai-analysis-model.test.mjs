import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  canDiscardUploadedPhoto,
  isTerminal,
  nextMonthStart,
  pollState,
  resultScreen,
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

  it('un completed sin nivel de urgencia se trata como fallido (no espera para siempre)', () => {
    assert.equal(resultScreen({ status: 'completed', urgency_level: 'observe' }), 'result');
    assert.equal(resultScreen({ status: 'completed', urgency_level: null }), 'failed');
    assert.equal(resultScreen({ status: 'failed', urgency_level: null }), 'failed');
    assert.equal(resultScreen({ status: 'pending', urgency_level: null }), 'preparing');
    assert.equal(resultScreen({ status: 'processing', urgency_level: null }), 'preparing');
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

  it('con hint (migración 20261029151011) decide el hint, no el texto', () => {
    assert.equal(toRequestErrorCode({ message: 'cualquier texto', hint: 'ai_quota_exceeded' }), 'limit');
    assert.equal(toRequestErrorCode({ message: 'x', hint: 'ai_invalid_symptoms' }), 'invalid_symptoms');
    assert.equal(toRequestErrorCode({ message: 'x', hint: 'ai_not_allowed' }), 'not_allowed');
    assert.equal(toRequestErrorCode({ message: 'x', hint: 'ai_pet_unavailable' }), 'archived');
    assert.equal(toRequestErrorCode({ message: 'x', hint: 'ai_disclaimer_required' }), 'disclaimer');
    assert.equal(toRequestErrorCode({ message: 'x', hint: 'ai_invalid_photo' }), 'unknown');
    assert.equal(toRequestErrorCode({ message: 'x', hint: 'toString' }), 'unknown');
  });
});

describe('canDiscardUploadedPhoto', () => {
  it('solo se borra la foto si el servidor rechazó la solicitud (sin respuesta pudo crearse)', () => {
    assert.equal(canDiscardUploadedPhoto({ message: 'x', hint: 'ai_quota_exceeded' }), true);
    assert.equal(canDiscardUploadedPhoto({ message: 'Mascota no encontrada o archivada' }), true);
    assert.equal(canDiscardUploadedPhoto(new TypeError('Network request failed')), false);
    assert.equal(canDiscardUploadedPhoto({ message: 'session_unavailable: request not sent' }), false);
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
