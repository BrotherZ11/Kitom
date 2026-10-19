import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { computeWeekOverview, dayCardMessage } from './week-overview.ts';

const item = (log_date, values = {}, syncStatus = 'synced') => ({
  log: { log_date, energy_level: 3, appetite_level: 3, mood_level: 3, activity_level: 3, ...values },
  syncStatus,
});

const TODAY = '2026-10-16';

describe('computeWeekOverview', () => {
  it('sin registros: anillo vacío, hoy pendiente', () => {
    const overview = computeWeekOverview([], TODAY);
    assert.deepEqual(overview.dates, ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']);
    assert.deepEqual(overview.days, ['off', 'off', 'off', 'off', 'off', 'off']);
    assert.equal(overview.today, null);
    assert.equal(overview.weekCount, 0);
    assert.deepEqual(dayCardMessage(overview), { kind: 'first' });
  });

  it('cuenta los días de la semana (hoy incluido) y marca el anillo', () => {
    const overview = computeWeekOverview([item('2026-10-16'), item('2026-10-15'), item('2026-10-12'), item('2026-10-01')], TODAY);
    assert.deepEqual(overview.days, ['off', 'off', 'on', 'off', 'off', 'on']);
    assert.equal(overview.weekCount, 3);
    assert.equal(overview.loggedCount, 4);
    assert.equal(overview.streak, 2);
    assert.deepEqual(dayCardMessage(overview), { kind: 'done', weekCount: 3, streak: 2 });
  });

  it('un registro pendiente de sincronizar cuenta igual (sin duplicar)', () => {
    const overview = computeWeekOverview([item('2026-10-16', {}, 'pending'), item('2026-10-16')], TODAY);
    assert.equal(overview.weekCount, 1);
    assert.equal(overview.today.syncStatus, 'synced');
  });

  it('ignora fechas futuras', () => {
    const overview = computeWeekOverview([item('2026-10-17')], TODAY);
    assert.equal(overview.loggedCount, 0);
  });

  it('ayer sin registro tras una racha: «empezáis otra racha»', () => {
    const overview = computeWeekOverview([item('2026-10-14'), item('2026-10-13')], TODAY);
    assert.equal(overview.yesterdayLogged, false);
    assert.equal(overview.streak, 0);
    assert.deepEqual(dayCardMessage(overview), { kind: 'restart' });
  });

  it('pendiente con ayer registrado: días de la semana', () => {
    const overview = computeWeekOverview([item('2026-10-15'), item('2026-10-14')], TODAY);
    assert.deepEqual(dayCardMessage(overview), { kind: 'pending', weekCount: 2 });
    assert.equal(overview.streak, 2);
  });

  it('no afirma una racha que llega al límite de lo cargado si hay más historial', () => {
    const items = ['2026-10-16', '2026-10-15', '2026-10-14'].map((date) => item(date));
    assert.equal(computeWeekOverview(items, TODAY, { hasMore: true }).streak, null);
    assert.equal(computeWeekOverview(items, TODAY, { hasMore: false }).streak, 3);
  });

  it('series alineadas con los días, con huecos donde no hay registro', () => {
    const overview = computeWeekOverview([item('2026-10-16', { energy_level: 4 }), item('2026-10-14', { energy_level: null })], TODAY);
    assert.deepEqual(overview.series.energy, [null, null, null, null, null, null, 4]);
  });
});
