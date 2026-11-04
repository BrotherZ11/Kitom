import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { en } from '../../i18n/locales/en.ts';
import { es } from '../../i18n/locales/es.ts';
import { validatePetForm } from './pet-form.ts';
import { isPlausibleBirthDate, isPlausibleWeight } from './pet-plausibility.ts';

const form = (overrides) => ({
  name: 'Atom',
  speciesId: 'dog-id',
  sex: 'unknown',
  breedStatus: null,
  breedSource: 'catalog',
  breedId: '',
  breedText: '',
  birthDate: '',
  weightKg: '',
  isSterilized: 'unknown',
  allergies: '',
  temperamentNotes: '',
  ...overrides,
});

describe('isPlausibleWeight', () => {
  it('un perro no pesa 7000 kg, pero sí lo que pesan los perros reales', () => {
    assert.equal(isPlausibleWeight(7000, 'dog'), false);
    assert.equal(isPlausibleWeight(161, 'dog'), false);
    for (const kg of [0.5, 7, 40, 95, 160]) assert.equal(isPlausibleWeight(kg, 'dog'), true, String(kg));
  });

  it('el límite depende de la especie', () => {
    assert.equal(isPlausibleWeight(30, 'cat'), false);
    assert.equal(isPlausibleWeight(6, 'cat'), true);
    assert.equal(isPlausibleWeight(600, 'horse'), true);
    assert.equal(isPlausibleWeight(2, 'hamster'), false);
  });

  it('con una especie desconocida solo frena lo imposible', () => {
    assert.equal(isPlausibleWeight(1500, undefined), true);
    assert.equal(isPlausibleWeight(1500, 'other'), true);
    assert.equal(isPlausibleWeight(1500, 'especie_nueva'), true);
    assert.equal(isPlausibleWeight(3000, undefined), false);
  });
});

describe('isPlausibleBirthDate', () => {
  it('rechaza una fecha más antigua que la edad máxima de la especie', () => {
    assert.equal(isPlausibleBirthDate('1950-01-01', '2026-11-04', 'dog'), false);
    assert.equal(isPlausibleBirthDate('1991-11-03', '2026-11-04', 'dog'), false);
    assert.equal(isPlausibleBirthDate('1991-11-04', '2026-11-04', 'dog'), true);
    assert.equal(isPlausibleBirthDate('2020-05-10', '2026-11-04', 'cat'), true);
  });

  it('las aves y los reptiles longevos caben', () => {
    assert.equal(isPlausibleBirthDate('1950-01-01', '2026-11-04', 'bird_other'), true);
    assert.equal(isPlausibleBirthDate('1950-01-01', '2026-11-04', 'reptile_other'), true);
  });
});

describe('validatePetForm con la especie', () => {
  it('marca el peso y la fecha imposibles para esa especie', () => {
    const errors = validatePetForm(form({ weightKg: '7000', birthDate: '1950-01-01' }), { speciesCode: 'dog' });
    assert.equal(errors.weightKg, 'implausible_weight');
    assert.equal(errors.birthDate, 'implausible_birth_date');
  });

  it('acepta los valores normales y la coma decimal', () => {
    const errors = validatePetForm(form({ weightKg: '7,5', birthDate: '2022-03-01' }), { speciesCode: 'dog' });
    assert.deepEqual(errors, {});
  });

  it('el formato sigue teniendo su propio error', () => {
    assert.equal(validatePetForm(form({ weightKg: '-2' }), { speciesCode: 'dog' }).weightKg, 'invalid_weight');
    assert.equal(validatePetForm(form({ birthDate: '2999-01-01' }), { speciesCode: 'dog' }).birthDate, 'future_date');
  });

  it('los dos mensajes existen en todos los idiomas', () => {
    for (const locale of [es, en]) {
      assert.ok(locale.pets.validation.implausible_weight.length > 0);
      assert.ok(locale.pets.validation.implausible_birth_date.length > 0);
    }
  });
});
