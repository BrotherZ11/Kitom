import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { en } from '../../i18n/locales/en.ts';
import { es } from '../../i18n/locales/es.ts';
import {
  CORE_SCALES,
  MAX_DAILY_SPECIES_FIELDS,
  SPECIES_CODES,
  SPECIES_DEFINITIONS,
  dailyDefinition,
  findField,
  isValidSpeciesValue,
  mergeSpeciesData,
  normalizeSpeciesData,
  parseSpeciesData,
  sameSpeciesData,
  setSpeciesValue,
  speciesDataBytes,
  speciesDefinition,
} from './species-fields.ts';

const allFields = () =>
  SPECIES_CODES.flatMap((code) =>
    ['profile', 'daily'].flatMap((scope) => SPECIES_DEFINITIONS[code][scope].map((field) => ({ species: code, scope, field })))
  );

describe('catálogo de campos por especie', () => {
  it('un mismo código significa lo mismo en todas las especies', () => {
    const byCode = new Map();
    for (const { field } of allFields()) {
      const signature = JSON.stringify({ kind: field.kind, options: field.options ?? null, unit: field.unit ?? null });
      const seen = byCode.get(field.code);
      if (seen) assert.equal(signature, seen, field.code);
      else byCode.set(field.code, signature);
    }
  });

  it('sin códigos repetidos dentro de una especie y ámbito', () => {
    for (const code of SPECIES_CODES) {
      for (const scope of ['profile', 'daily']) {
        const codes = SPECIES_DEFINITIONS[code][scope].map((field) => field.code);
        assert.equal(new Set(codes).size, codes.length, `${code}/${scope}`);
      }
    }
  });

  it('códigos en snake_case y nunca el de una escala común', () => {
    for (const { field } of allFields()) {
      assert.match(field.code, /^[a-z][a-z0-9_]{0,39}$/);
      assert.ok(!CORE_SCALES.includes(field.code), field.code);
    }
  });

  it('como mucho 6 campos diarios por especie y al menos una escala principal', () => {
    for (const code of SPECIES_CODES) {
      assert.ok(SPECIES_DEFINITIONS[code].daily.length <= MAX_DAILY_SPECIES_FIELDS, code);
      assert.ok(CORE_SCALES.some((scale) => SPECIES_DEFINITIONS[code].core[scale] === 'primary'), code);
    }
  });

  it('perro y gato conservan las 4 principales y los 3 detalles de siempre', () => {
    for (const code of ['dog', 'cat']) {
      const { core } = SPECIES_DEFINITIONS[code];
      assert.deepEqual(
        CORE_SCALES.filter((scale) => core[scale] === 'primary'),
        ['energy', 'appetite', 'mood', 'activity']
      );
      assert.deepEqual(
        CORE_SCALES.filter((scale) => core[scale] === 'optional'),
        ['sleep', 'vocalization', 'social']
      );
    }
  });

  it('elecciones con opciones y números con rango y unidad', () => {
    for (const { field } of allFields()) {
      if (field.kind === 'choice' || field.kind === 'multi_choice') assert.ok(field.options?.length, field.code);
      else assert.equal(field.options, undefined, field.code);
      if (field.kind === 'integer' || field.kind === 'decimal') {
        assert.ok(field.min !== undefined && field.max !== undefined && field.min < field.max, field.code);
        assert.ok(field.unit, field.code);
      }
    }
  });

  it('cada campo y opción tiene texto en español e inglés', () => {
    for (const locale of [es, en]) {
      for (const { field } of allFields()) {
        const entry = locale.speciesFields.fields[field.code];
        assert.ok(entry && typeof entry.label === 'string' && entry.label !== '', `${field.code}`);
        for (const option of field.options ?? []) {
          assert.equal(typeof entry.options?.[option], 'string', `${field.code}.${option}`);
        }
      }
      for (const code of SPECIES_CODES) assert.equal(typeof locale.speciesFields.about[code], 'string', code);
    }
  });

  it('una especie desconocida es «Otro»; sin especie, el registro de siempre', () => {
    assert.equal(speciesDefinition('unicorn'), SPECIES_DEFINITIONS.other);
    assert.equal(speciesDefinition(null), SPECIES_DEFINITIONS.other);
    assert.equal(dailyDefinition(null).core.mood, 'primary');
    assert.equal(dailyDefinition(null).daily.length, 0);
    assert.equal(dailyDefinition('reptile_other').core.mood, 'hidden');
  });
});

describe('valores', () => {
  const field = (species, scope, code) => findField(species, scope, code);

  it('scale3 solo 2, 3 o 4', () => {
    const water = field('dog', 'daily', 'water');
    assert.ok(isValidSpeciesValue(water, 2));
    assert.ok(isValidSpeciesValue(water, 4));
    assert.ok(!isValidSpeciesValue(water, 5));
    assert.ok(!isValidSpeciesValue(water, '3'));
  });

  it('choice y multi_choice', () => {
    assert.ok(isValidSpeciesValue(field('dog', 'profile', 'microchip'), 'yes'));
    assert.ok(!isValidSpeciesValue(field('dog', 'profile', 'microchip'), 'maybe'));
    const livesWith = field('cat', 'profile', 'lives_with');
    assert.ok(isValidSpeciesValue(livesWith, ['cats', 'children']));
    assert.ok(!isValidSpeciesValue(livesWith, []));
    assert.ok(!isValidSpeciesValue(livesWith, ['cats', 'cats']));
    assert.ok(!isValidSpeciesValue(livesWith, ['horses']));
  });

  it('enteros y decimales con su rango', () => {
    const meals = field('dog', 'profile', 'meals_per_day');
    assert.ok(isValidSpeciesValue(meals, 1));
    assert.ok(!isValidSpeciesValue(meals, 0));
    assert.ok(!isValidSpeciesValue(meals, 2.5));
    const temp = field('reptile_other', 'daily', 'basking_temp');
    assert.ok(isValidSpeciesValue(temp, 32.5));
    assert.ok(isValidSpeciesValue(temp, 32.55));
    assert.ok(!isValidSpeciesValue(temp, 32.555));
    assert.ok(!isValidSpeciesValue(temp, 60));
    assert.ok(!isValidSpeciesValue(temp, Number.NaN));
  });

  it('fechas reales y nunca futuras', () => {
    const uvb = field('reptile_other', 'profile', 'uvb_changed_on');
    assert.ok(isValidSpeciesValue(uvb, '2026-01-15', '2026-11-11'));
    assert.ok(!isValidSpeciesValue(uvb, '2026-02-30', '2026-11-11'));
    assert.ok(!isValidSpeciesValue(uvb, '2026-12-01', '2026-11-11'));
    assert.ok(!isValidSpeciesValue(uvb, '1899-12-31', '2026-11-11'));
  });

  it('el mismo código con rangos distintos por especie (peso diario)', () => {
    assert.ok(isValidSpeciesValue(field('guinea_pig', 'daily', 'weight_g'), 900));
    assert.ok(!isValidSpeciesValue(field('hamster', 'daily', 'weight_g'), 900));
  });

  it('forma canónica: claves ordenadas, multi en el orden de las opciones y claves desconocidas conservadas', () => {
    const data = normalizeSpeciesData({ zeta_future: 1, lives_with: ['cats', 'children', 'cats'], microchip: 'yes' }, 'dog');
    assert.deepEqual(Object.keys(data), ['lives_with', 'microchip', 'zeta_future']);
    assert.deepEqual(data.lives_with, ['children', 'cats']);
    assert.equal(data.zeta_future, 1);
  });

  it('lectura: solo objetos planos con valores simples o listas de textos', () => {
    assert.deepEqual(parseSpeciesData({ a: 1, b: 'x', c: true, d: ['y'] }), { a: 1, b: 'x', c: true, d: ['y'] });
    assert.equal(parseSpeciesData([]), null);
    assert.equal(parseSpeciesData({ a: { b: 1 } }), null);
    assert.equal(parseSpeciesData({ a: null }), null);
    assert.equal(parseSpeciesData(null), null);
  });

  it('comparar y cambiar valores', () => {
    assert.ok(sameSpeciesData({ a: ['x', 'y'] }, { a: ['y', 'x'] }));
    assert.ok(!sameSpeciesData({ a: 1 }, {}));
    assert.deepEqual(setSpeciesValue({ a: 1 }, 'a', undefined), {});
    assert.deepEqual(setSpeciesValue({}, 'b', []), {});
    assert.deepEqual(setSpeciesValue({}, 'b', true), { b: true });
  });

  it('fusión a tres bandas por campo', () => {
    const base = { water: 3, stool: 'normal' };
    const local = { water: 2, stool: 'normal' };
    const remote = { water: 3, stool: 'soft', vomit: true };
    assert.deepEqual(mergeSpeciesData(base, local, remote), {
      merged: { stool: 'soft', vomit: true, water: 2 },
      conflicts: [],
    });
    const conflict = mergeSpeciesData(base, { water: 2 }, { water: 4, stool: 'normal' });
    assert.deepEqual(conflict.conflicts, ['water']);
    // Quitado en local y sin cambios en remoto: queda quitado.
    assert.deepEqual(mergeSpeciesData(base, { water: 3 }, base).merged, { water: 3 });
  });

  it('tamaño en bytes UTF-8', () => {
    assert.equal(speciesDataBytes({}), 2);
    assert.equal(speciesDataBytes({ a: 'ñ' }), JSON.stringify({ a: 'n' }).length + 1);
  });
});
