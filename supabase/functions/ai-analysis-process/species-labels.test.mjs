import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { speciesFieldsEs } from '../../../frontend/src/i18n/locales/species-fields-es.ts';
import { describeSpeciesData, buildUserPrompt } from './guidance.ts';
import { SCALE3_LABELS, SPECIES_FIELD_LABELS, UNIT_LABELS } from './species-labels.ts';

describe('textos de los campos por especie', () => {
  it('son una copia exacta de los de la app (español)', () => {
    assert.deepEqual(SPECIES_FIELD_LABELS, speciesFieldsEs.fields);
    assert.deepEqual(SCALE3_LABELS, speciesFieldsEs.scale3);
    assert.deepEqual(UNIT_LABELS, speciesFieldsEs.units);
  });
});

describe('describeSpeciesData', () => {
  const meta = {
    walks: { kind: 'integer', unit: 'count' },
    walk_minutes: { kind: 'integer', unit: 'min' },
    water: { kind: 'scale3', unit: null },
    stool: { kind: 'choice', unit: null },
    vomit: { kind: 'boolean', unit: null },
    lives_with: { kind: 'multi_choice', unit: null },
  };

  it('escribe cada dato con su etiqueta, en el orden del catálogo', () => {
    const lines = describeSpeciesData(
      { vomit: false, walks: 2, walk_minutes: 45, water: 4, stool: 'soft', lives_with: ['children', 'cats'] },
      meta
    );
    assert.deepEqual(lines, [
      'Paseos: 2',
      'Minutos de paseo: 45 min',
      'Agua: Más',
      'Deposiciones: Blandas',
      'Vómito: no',
      'Convive con: Niños, Gatos',
    ]);
  });

  it('omite lo que no es de su especie o no se entiende (nunca inventa)', () => {
    assert.deepEqual(describeSpeciesData({ hay_eaten: 'none', stool: 'rainbow', water: 9 }, meta), []);
    assert.deepEqual(describeSpeciesData(null, meta), []);
    assert.deepEqual(describeSpeciesData([], meta), []);
  });

  it('el perfil y los registros los incluyen en el prompt', () => {
    const prompt = buildUserPrompt({
      pet: {
        species: 'perro',
        ageMonths: 24,
        sex: 'female',
        sterilized: true,
        weightKg: 12,
        breed: null,
        knownConditions: [],
        allergies: [],
        speciesDetails: ['Microchip: Sí'],
      },
      symptoms: [],
      logs: [
        {
          date: '2026-11-10',
          energy: 3,
          appetite: 3,
          mood: 3,
          activity: 3,
          unusualBehavior: false,
          unusualNotes: null,
          tags: [],
          speciesDetails: ['Deposiciones: Blandas'],
        },
      ],
      hasPhoto: false,
      minimumLevel: 'observe',
    });
    assert.match(prompt, /- Microchip: Sí/);
    assert.match(prompt, /deposiciones: Blandas/);
    assert.doesNotMatch(prompt, /diagn[oó]stic/i);
  });
});
