import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatBirthDate, isoDateToLocalDate, localDateToIsoDate, pickerInitialDate } from './birth-date.ts';

describe('fecha de nacimiento', () => {
  it('AAAA-MM-DD ↔ fecha local, sin desfase de zona', () => {
    const date = isoDateToLocalDate('2024-03-15');
    assert.equal(date.getFullYear(), 2024);
    assert.equal(date.getMonth(), 2);
    assert.equal(date.getDate(), 15);
    assert.equal(localDateToIsoDate(date), '2024-03-15');
    assert.equal(localDateToIsoDate(new Date(2024, 0, 5, 23, 59)), '2024-01-05');
  });

  it('fechas inválidas o mal formadas → null', () => {
    assert.equal(isoDateToLocalDate('2024-02-30'), null);
    assert.equal(isoDateToLocalDate('15/03/2024'), null);
    assert.equal(isoDateToLocalDate(''), null);
  });

  it('el selector abre en la fecha elegida o hace un año', () => {
    const now = new Date(2026, 9, 30);
    assert.equal(localDateToIsoDate(pickerInitialDate('2020-06-01', now)), '2020-06-01');
    assert.equal(localDateToIsoDate(pickerInitialDate('', now)), '2025-10-30');
  });

  it('se muestra con el idioma de la app', () => {
    assert.match(formatBirthDate('2024-03-15', 'es'), /15.*marzo.*2024/);
    assert.match(formatBirthDate('2024-03-15', 'en'), /March 15, 2024/);
    assert.equal(formatBirthDate('', 'es'), null);
  });
});
