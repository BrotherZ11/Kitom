// Pruebas de la lógica pura de ai-analysis-process (Node, sin Deno):
//   node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON supabase/functions/ai-analysis-process/guidance.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ageInMonths,
  applyUrgencyFloor,
  finalizeGuidance,
  minimumUrgency,
  buildUserPrompt,
  estimateCostUsd,
  GUIDANCE_JSON_SCHEMA,
  isUuid,
  parseGuidance,
  SYSTEM_PROMPT,
} from './guidance.ts';

describe('parseGuidance', () => {
  it('acepta una respuesta válida y recorta listas y espacios', () => {
    const result = parseGuidance({
      urgency_level: 'consult_soon',
      possible_causes: ['  Una  molestia   leve ', 'b', 'c', 'd', 'e'],
      recommendations: ['Pide cita con tu veterinario.'],
    });
    assert.equal(result.ok, true);
    assert.equal(result.guidance.urgencyLevel, 'consult_soon');
    assert.deepEqual(result.guidance.possibleCauses, ['Una molestia leve', 'b', 'c', 'd']);
  });

  it('descarta las frases con «diagnóstico» y falla si no queda nada útil', () => {
    const mixed = parseGuidance({
      urgency_level: 'observe',
      possible_causes: ['Diagnóstico: otitis', 'Una molestia en el oído'],
      recommendations: ['Vigila si se rasca.'],
    });
    assert.deepEqual(mixed.guidance.possibleCauses, ['Una molestia en el oído']);
    assert.deepEqual(
      parseGuidance({ urgency_level: 'observe', possible_causes: ['Te diagnostico gripe'], recommendations: ['x'] }),
      { ok: false, reason: 'invalid_output' }
    );
  });

  it('rechaza niveles desconocidos, listas vacías y salidas que no son objeto', () => {
    assert.equal(parseGuidance({ urgency_level: 'grave', possible_causes: ['a'], recommendations: ['b'] }).ok, false);
    assert.equal(parseGuidance({ urgency_level: 'observe', possible_causes: [], recommendations: ['b'] }).ok, false);
    assert.equal(parseGuidance(null).ok, false);
    assert.equal(parseGuidance('texto').ok, false);
  });
});

describe('applyUrgencyFloor', () => {
  it('sube el nivel con combinaciones de señales que no pueden quedarse bajas', () => {
    assert.equal(applyUrgencyFloor('observe', ['lethargy', 'appetite_loss']), 'consult_soon');
    assert.equal(applyUrgencyFloor('urgent', ['lethargy', 'appetite_loss']), 'urgent');
    assert.equal(applyUrgencyFloor('observe', ['lethargy']), 'observe');
  });

  it('el mínimo va en el prompt y, si las reglas suben el nivel, la primera recomendación lo acompaña', () => {
    assert.equal(minimumUrgency(['lethargy', 'appetite_loss']), 'consult_soon');
    assert.equal(minimumUrgency(['limping']), 'observe');
    const raised = finalizeGuidance(
      { urgencyLevel: 'observe', possibleCauses: ['a'], recommendations: ['1', '2', '3', '4', '5'] },
      ['lethargy', 'appetite_loss']
    );
    assert.equal(raised.urgencyLevel, 'consult_soon');
    assert.match(raised.recommendations[0], /pide cita con tu veterinario/);
    assert.equal(raised.recommendations.length, 5);
    const kept = finalizeGuidance({ urgencyLevel: 'urgent', possibleCauses: ['a'], recommendations: ['1'] }, [
      'lethargy',
      'appetite_loss',
    ]);
    assert.deepEqual(kept.recommendations, ['1']);
  });
});

describe('prompt', () => {
  it('el sistema prohíbe diagnosticar y el usuario no lleva nombres', () => {
    assert.match(SYSTEM_PROMPT, /No diagnosticas/);
    const user = buildUserPrompt({
      pet: {
        species: 'perro',
        ageMonths: 30,
        sex: 'female',
        sterilized: true,
        weightKg: 12.5,
        breed: 'beagle',
        knownConditions: ['Otitis'],
        allergies: [],
      },
      symptoms: ['Ojos llorosos'],
      logs: [
        { date: '2026-10-22', energy: 2, appetite: 3, mood: null, activity: 3, unusualBehavior: true, unusualNotes: 'Se rasca', tags: [] },
      ],
      hasPhoto: true,
      minimumLevel: 'consult_soon',
    });
    assert.match(user, /Especie: perro/);
    assert.match(user, /Edad: 30 meses/);
    assert.match(user, /Sexo: hembra/);
    assert.match(user, /Ojos llorosos/);
    assert.match(user, /2026-10-22: energía 2; apetito 3; ánimo -; actividad 3; comportamiento inusual: Se rasca/);
    assert.match(user, /Se adjunta una foto/);
    assert.match(user, /no puede ser menor que consult_soon/);
  });

  it('el esquema es estricto (todas las propiedades obligatorias, sin extras)', () => {
    assert.equal(GUIDANCE_JSON_SCHEMA.additionalProperties, false);
    assert.deepEqual([...GUIDANCE_JSON_SCHEMA.required].sort(), Object.keys(GUIDANCE_JSON_SCHEMA.properties).sort());
  });
});

describe('auxiliares', () => {
  it('coste solo con precios configurados', () => {
    assert.equal(estimateCostUsd({ inputTokens: 1000, outputTokens: 200 }, { inputPerMillion: 0.5, outputPerMillion: 2 }), 0.0009);
    assert.equal(estimateCostUsd({ inputTokens: 1000, outputTokens: 200 }, { inputPerMillion: null, outputPerMillion: 2 }), null);
    assert.equal(estimateCostUsd(null, { inputPerMillion: 1, outputPerMillion: 1 }), null);
  });

  it('edad en meses y formato de UUID', () => {
    assert.equal(ageInMonths('2024-03-15', '2026-10-23'), 31);
    assert.equal(ageInMonths('2024-03-25', '2026-10-23'), 30);
    assert.equal(ageInMonths(null, '2026-10-23'), null);
    assert.equal(isUuid('f1000000-0000-4000-8000-000000000001'), true);
    assert.equal(isUuid('nope'), false);
  });
});
