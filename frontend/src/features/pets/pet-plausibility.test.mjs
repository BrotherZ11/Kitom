import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { en } from '../../i18n/locales/en.ts';
import { es } from '../../i18n/locales/es.ts';
import { toPetFields, toPetFormValues, validatePetForm, weightToKg, withSpecies } from './pet-form.ts';
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
  weightUnit: 'kg',
  sterilized: 'unknown',
  knownConditions: '',
  allergies: '',
  temperamentNotes: '',
  species: { data: {}, text: {} },
  speciesIndicated: true,
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

describe('peso por especie: unidad y mínimos', () => {
  it('los animales pequeños se pesan en gramos y se guardan en kg', () => {
    const hamster = form({ speciesId: 'hamster-id', weightUnit: 'g', weightKg: '45' });
    assert.equal(weightToKg(hamster), 0.045);
    assert.deepEqual(validatePetForm(hamster, { speciesCode: 'hamster' }), {});
    assert.equal(toPetFields(hamster, { speciesCode: 'hamster' }).weight_kg, 0.045);
    // En gramos no hay decimales.
    assert.equal(validatePetForm(form({ weightUnit: 'g', weightKg: '45,5' }), { speciesCode: 'hamster' }).weightKg, 'invalid_weight');
  });

  it('una errata de unidad se detecta por arriba y por abajo', () => {
    assert.equal(validatePetForm(form({ weightKg: '30' }), { speciesCode: 'hamster' }).weightKg, 'implausible_weight');
    assert.equal(validatePetForm(form({ weightKg: '3' }), { speciesCode: 'horse' }).weightKg, 'implausible_weight');
    assert.equal(isPlausibleWeight(450, 'horse'), true);
  });

  it('cambiar de especie convierte el peso a la nueva unidad y vacía los campos de la anterior', () => {
    const dog = form({ weightKg: '0.12', species: { data: { microchip: 'yes' }, text: {} } });
    const next = withSpecies(dog, 'hamster-id', 'hamster');
    assert.equal(next.weightUnit, 'g');
    assert.equal(next.weightKg, '120');
    assert.deepEqual(next.species.data, {});
    assert.equal(withSpecies(next, 'dog-id', 'dog').weightKg, '0.12');
  });

  it('el valor inicial respeta la unidad de la especie', () => {
    const pet = { name: 'Bolita', species_id: 'h', weight_kg: 0.05, species_data: { lives_alone: true } };
    const values = toPetFormValues(pet, 'hamster');
    assert.equal(values.weightUnit, 'g');
    assert.equal(values.weightKg, '50');
    assert.deepEqual(values.species.data, { lives_alone: true });
    assert.equal(values.speciesIndicated, true);
  });
});

describe('campos de la especie en la ficha', () => {
  it('se envían los válidos y un número mal escrito impide guardar', () => {
    const ok = form({ species: { data: { microchip: 'yes' }, text: { meals_per_day: '2' } } });
    assert.deepEqual(validatePetForm(ok, { speciesCode: 'dog' }), {});
    assert.deepEqual(toPetFields(ok, { speciesCode: 'dog' }).species_data, { meals_per_day: 2, microchip: 'yes' });
    const bad = form({ species: { data: {}, text: { meals_per_day: '9' } } });
    assert.equal(validatePetForm(bad, { speciesCode: 'dog' }).species, 'species_invalid');
  });

  it('una ficha leída sin la columna no envía species_data hasta tocarla', () => {
    const values = toPetFormValues({ name: 'Kika', species_id: 'd', weight_kg: null }, 'dog');
    assert.equal(values.speciesIndicated, false);
    assert.equal('species_data' in toPetFields(values, { speciesCode: 'dog' }), false);
  });

  it('el mensaje existe en todos los idiomas', () => {
    for (const locale of [es, en]) assert.ok(locale.pets.validation.species_invalid.length > 0);
  });
});
