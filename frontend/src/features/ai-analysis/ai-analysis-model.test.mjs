import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildShareText,
  canDiscardUploadedPhoto,
  contextProblem,
  groupSigns,
  isSymptomOnset,
  isSymptomTrend,
  MAX_CONTEXT_LENGTH,
  normalizeContext,
  isTerminal,
  nextMonthStart,
  pollState,
  resultScreen,
  SLOW_AFTER_MS,
  toEntitlement,
  toggleSymptom,
  toRequestErrorCode,
  signCategoryLabel,
} from './ai-analysis-model.ts';
import { hasUrgentSign, urgentSignsFor } from './urgent-signs.ts';

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

  it('límites de abuso (migración 20261030090318): frecuencia y fallos del día', () => {
    assert.equal(toRequestErrorCode({ message: 'Espera un minuto antes de pedir otra orientación', hint: 'ai_rate_limited' }), 'rate_limited');
    assert.equal(toRequestErrorCode({ message: 'x', hint: 'ai_failure_limit' }), 'failure_limit');
    // No son errores de red: la foto subida se puede borrar.
    assert.equal(canDiscardUploadedPhoto({ message: 'x', hint: 'ai_rate_limited' }), true);
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

describe('contexto del tutor', () => {
  it('se guarda sin espacios en los extremos y en blanco es null', () => {
    assert.equal(normalizeContext('  cojea  '), 'cojea');
    assert.equal(normalizeContext(' \n '), null);
  });

  it('hace falta una señal o un texto suficiente, y nunca más del máximo', () => {
    assert.equal(contextProblem('', 1), null);
    assert.equal(contextProblem('corto', 0), 'required');
    assert.equal(contextProblem('   Cojea desde ayer   ', 0), null);
    assert.equal(contextProblem('a'.repeat(MAX_CONTEXT_LENGTH), 0), null);
    assert.equal(contextProblem('a'.repeat(MAX_CONTEXT_LENGTH + 1), 3), 'too_long');
  });

  it('inicio y evolución de una lista cerrada (la misma que el CHECK)', () => {
    assert.equal(isSymptomOnset('days_4_7'), true);
    assert.equal(isSymptomOnset('yesterday'), false);
    assert.equal(isSymptomTrend('same'), true);
    assert.equal(isSymptomTrend(null), false);
  });

  it('los nuevos hint del servidor tienen su código', () => {
    assert.equal(toRequestErrorCode({ hint: 'ai_context_too_long' }), 'context_too_long');
    assert.equal(toRequestErrorCode({ hint: 'ai_invalid_context' }), 'invalid_context');
  });
});

describe('señales', () => {
  it('se agrupan por categoría en el orden fijo, con las desconocidas al final', () => {
    const groups = groupSigns([
      { id: 'a', category: 'skin' },
      { id: 'b', category: 'general' },
      { id: 'c', category: null },
      { id: 'd', category: 'skin' },
      { id: 'e', category: 'rara' },
    ]);
    assert.deepEqual(
      groups.map((group) => [group.category, group.signs.map((sign) => sign.id)]),
      [
        ['general', ['b']],
        ['skin', ['a', 'd']],
        ['other', ['c', 'e']],
      ]
    );
  });

  it('las urgentes dependen de la especie', () => {
    assert.equal(hasUrgentSign('cat', ['straining_to_urinate']), true);
    assert.equal(hasUrgentSign('dog', ['straining_to_urinate']), false);
    assert.equal(hasUrgentSign('rabbit', ['not_eating', 'limping']), true);
    assert.equal(hasUrgentSign(null, ['seizures']), true);
    assert.ok(urgentSignsFor('dog').includes('unproductive_retching'));
  });
});

describe('compartir el resumen', () => {
  const labels = {
    title: 'Orientación para Luna',
    date: 'Fecha: 13 nov',
    level: 'Nivel: Observar',
    signs: 'Señales: Cojera',
    summary: 'En resumen',
    causes: 'Posibles causas',
    todo: 'Qué hacer',
    warning: 'Acude ya si…',
    vet: 'Para tu veterinario',
    yourContext: 'Lo que contaste',
    footer: 'Informativo.',
  };

  it('incluye solo las secciones con contenido', () => {
    const text = buildShareText(
      {
        summary: 'Una molestia leve.',
        possible_causes: ['Un golpe.'],
        recommendations: ['Reposo.'],
        warning_signs: [],
        vet_questions: null,
        user_context: 'Cojea desde ayer.',
      },
      labels
    );
    assert.equal(
      text,
      [
        'Orientación para Luna',
        'Fecha: 13 nov',
        'Nivel: Observar',
        'Señales: Cojera',
        '',
        'Lo que contaste',
        'Cojea desde ayer.',
        '',
        'En resumen',
        'Una molestia leve.',
        '',
        'Posibles causas',
        '• Un golpe.',
        '',
        'Qué hacer',
        '• Reposo.',
        '',
        'Informativo.',
      ].join('\n')
    );
  });
});

describe('signCategoryLabel', () => {
  it('boca y piel según la especie; el resto, igual', () => {
    assert.equal(signCategoryLabel('oral', 'dog'), 'oralTeeth');
    assert.equal(signCategoryLabel('skin', 'cat'), 'skinFur');
    assert.equal(signCategoryLabel('oral', 'bird_other'), 'oralBeak');
    assert.equal(signCategoryLabel('skin', 'bird_other'), 'skinFeathers');
    assert.equal(signCategoryLabel('oral', 'reptile_other'), 'oralReptile');
    assert.equal(signCategoryLabel('skin', 'reptile_other'), 'skinScales');
    assert.equal(signCategoryLabel('skin', 'other'), 'skin');
    assert.equal(signCategoryLabel('oral', null), 'oral');
    assert.equal(signCategoryLabel('digestive', 'dog'), 'digestive');
  });
});
