import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PROFILE_FIELDS, currentStreak, missingProfileFields, petAge } from './pet-profile.ts';

const empty = {
  photo_path: null,
  breed_status: null,
  birth_date: null,
  weight_kg: null,
  sex: 'unknown',
  sterilized: null,
  allergies: [],
  known_conditions: null,
  temperament_notes: '  ',
};

describe('missingProfileFields', () => {
  it('sin datos opcionales faltan los 9, en orden', () => {
    assert.deepEqual(missingProfileFields(empty), [...PROFILE_FIELDS]);
    assert.equal(PROFILE_FIELDS.length, 9);
  });

  it('cuenta lo contestado; «raza desconocida» es una respuesta, «sexo: no lo sé» no', () => {
    const pet = {
      ...empty,
      photo_path: 'a/b.jpg',
      breed_status: 'unknown',
      birth_date: '2021-03-01',
      weight_kg: 12.4,
      sterilized: false,
      allergies: ['pollo'],
      temperament_notes: 'Tranquila',
    };
    assert.deepEqual(missingProfileFields(pet), ['sex', 'knownConditions']);
  });
});

describe('petAge', () => {
  it('años cumplidos', () => {
    assert.deepEqual(petAge('2021-03-15', '2026-10-16'), { unit: 'years', count: 5 });
    assert.deepEqual(petAge('2021-10-17', '2026-10-16'), { unit: 'years', count: 4 });
  });

  it('meses por debajo del año y «recién nacida» por debajo del mes', () => {
    assert.deepEqual(petAge('2026-04-20', '2026-10-16'), { unit: 'months', count: 5 });
    assert.deepEqual(petAge('2026-10-01', '2026-10-16'), { unit: 'newborn' });
  });

  it('sin fecha, con formato raro o futura: null', () => {
    assert.equal(petAge(null, '2026-10-16'), null);
    assert.equal(petAge('03/2021', '2026-10-16'), null);
    assert.equal(petAge('2026-11-01', '2026-10-16'), null);
  });
});

describe('currentStreak', () => {
  it('vigente si el último registro es de hoy o de ayer', () => {
    assert.equal(currentStreak({ current_streak: 4, last_log_date: '2026-10-16' }, '2026-10-15'), 4);
    assert.equal(currentStreak({ current_streak: 4, last_log_date: '2026-10-15' }, '2026-10-15'), 4);
  });

  it('caducada (el servidor no la pone a 0 sola) o sin datos: 0', () => {
    assert.equal(currentStreak({ current_streak: 4, last_log_date: '2026-10-13' }, '2026-10-15'), 0);
    assert.equal(currentStreak({ current_streak: 0, last_log_date: null }, '2026-10-15'), 0);
    assert.equal(currentStreak(null, '2026-10-15'), 0);
  });
});
