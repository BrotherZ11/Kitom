import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatMonthTitle, formatReminderDay, formatReminderLongDay, formatReminderTime, relativeDay } from './reminder-format.ts';

const at = (y, m, d, h = 10, min = 0) => new Date(y, m - 1, d, h, min);
const now = at(2026, 10, 16, 12);

describe('reminder-format', () => {
  it('hora en 24 h', () => {
    assert.equal(formatReminderTime(at(2026, 10, 16, 7, 5)), '07:05');
  });

  it('ayer, hoy, mañana o nada', () => {
    assert.equal(relativeDay(at(2026, 10, 15, 23), now), 'yesterday');
    assert.equal(relativeDay(at(2026, 10, 16, 0), now), 'today');
    assert.equal(relativeDay(at(2026, 10, 17, 23, 59), now), 'tomorrow');
    assert.equal(relativeDay(at(2026, 10, 18), now), null);
  });

  it('día corto en español: mismo mes, otro mes, otro año', () => {
    assert.equal(formatReminderDay(at(2026, 10, 18), now, 'es'), 'domingo 18');
    assert.equal(formatReminderDay(at(2026, 11, 2), now, 'es'), 'lunes 2 nov');
    assert.equal(formatReminderDay(at(2027, 11, 2), now, 'es'), '2 nov 2027');
  });

  it('día largo y título del mes con mayúscula inicial', () => {
    assert.equal(formatReminderLongDay(at(2026, 10, 28), now, 'es'), 'Miércoles, 28 de octubre');
    assert.equal(formatMonthTitle(2026, 9, 'es'), 'Octubre de 2026');
  });
});

describe('formatFullDate', () => {
  it('día, mes y año', async () => {
    const { formatFullDate } = await import('./reminder-format.ts');
    assert.equal(formatFullDate(new Date(2026, 9, 16), 'es'), '16 de octubre de 2026');
  });
});
