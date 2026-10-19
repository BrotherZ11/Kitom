import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULT_SERIES, dayRows, monthDates, needsOlderPages, seriesValues, toggleSeries } from './history-view.ts';

const log = (log_date, values = {}) => ({
  log_date,
  energy_level: null,
  appetite_level: null,
  mood_level: null,
  activity_level: null,
  sleep_quality: null,
  ...values,
});

describe('toggleSeries', () => {
  it('como mucho 3 a la vez: con 3, añadir otra no cambia nada', () => {
    assert.deepEqual(toggleSeries(DEFAULT_SERIES, 'sleep'), ['energy', 'appetite', 'mood']);
  });

  it('quitar una deja sitio y se añade en el orden de las series', () => {
    const two = toggleSeries(DEFAULT_SERIES, 'appetite');
    assert.deepEqual(two, ['energy', 'mood']);
    assert.deepEqual(toggleSeries(two, 'activity'), ['energy', 'mood', 'activity']);
  });

  it('la última no se puede quitar', () => {
    assert.deepEqual(toggleSeries(['mood'], 'mood'), ['mood']);
  });
});

describe('seriesValues', () => {
  it('huecos donde no hay registro o no se indicó: nada se rellena', () => {
    const items = [log('2026-10-14', { energy_level: 4 }), log('2026-10-16', { energy_level: null })];
    assert.deepEqual(seriesValues(items, ['2026-10-14', '2026-10-15', '2026-10-16'], 'energy_level'), [4, null, null]);
  });
});

describe('dayRows', () => {
  it('7 días con huecos (hoy primero) y después los registros más antiguos', () => {
    const item = (date) => ({ log: { log_date: date } });
    const rows = dayRows([item('2026-10-16'), item('2026-10-12'), item('2026-10-01')], '2026-10-16');
    assert.equal(rows.length, 8);
    assert.deepEqual(
      rows.slice(0, 7).map((row) => [row.date, row.item !== null]),
      [
        ['2026-10-16', true],
        ['2026-10-15', false],
        ['2026-10-14', false],
        ['2026-10-13', false],
        ['2026-10-12', true],
        ['2026-10-11', false],
        ['2026-10-10', false],
      ]
    );
    assert.equal(rows[7].date, '2026-10-01');
  });
});

describe('mes', () => {
  it('todas las fechas del mes', () => {
    const dates = monthDates(2026, 9);
    assert.equal(dates.length, 31);
    assert.equal(dates[0], '2026-10-01');
    assert.equal(dates[30], '2026-10-31');
    assert.equal(monthDates(2028, 1).length, 29);
  });

  it('carga más páginas mientras lo más antiguo sea posterior al día 1 y haya más', () => {
    assert.equal(needsOlderPages([log('2026-10-05')], '2026-10-01', true), true);
    assert.equal(needsOlderPages([log('2026-09-30')], '2026-10-01', true), false);
    assert.equal(needsOlderPages([log('2026-10-05')], '2026-10-01', false), false);
    assert.equal(needsOlderPages([], '2026-10-01', true), true);
  });
});
