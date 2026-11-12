import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { addCoverage, coveringRange } from '../daily-logs/offline/daily-log-coverage.ts';
import { resolveDailyLogRange } from '../daily-logs/offline/daily-log-view.ts';
import { computeObservations } from './wellness-observations.ts';
import {
  MIN_VALUES,
  dailySeries,
  fetchRange,
  periodWindow,
  previousWindow,
  scaleGroup,
  summarizeWellness,
  weeklyDistributions,
} from './wellness-stats.ts';

const TODAY = '2026-11-11';

const addDays = (date, days) => {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
};

/** Registro de un día (`daysAgo` = 0 es hoy) con las escalas indicadas; el resto, sin indicar. */
function log(daysAgo, values = {}, extra = {}) {
  return {
    log: {
      log_date: addDays(TODAY, -daysAgo),
      energy_level: null,
      appetite_level: null,
      mood_level: null,
      activity_level: null,
      sleep_quality: null,
      vocalization_level: null,
      social_interaction_level: null,
      unusual_behavior: false,
      tags: [],
      species_data: {},
      ...values,
    },
    syncStatus: 'synced',
    ...extra,
  };
}

const summarize = (items, period = 7, speciesCode = 'dog') => summarizeWellness({ items, today: TODAY, period, speciesCode });

describe('periodos', () => {
  it('7, 30 y 90 días que terminan hoy (incluido) y el periodo anterior', () => {
    const week = periodWindow(TODAY, 7);
    assert.equal(week.start, '2026-11-05');
    assert.equal(week.end, TODAY);
    assert.equal(week.dates.length, 7);
    assert.equal(periodWindow(TODAY, 90).dates.length, 90);
    const before = previousWindow(TODAY, 7);
    assert.equal(before.end, '2026-11-04');
    assert.equal(before.start, '2026-10-29');
    assert.deepEqual(fetchRange(TODAY, 90), { start: addDays(TODAY, -179), end: TODAY });
  });

  it('las semanas del cambio de hora siguen teniendo 7 fechas', () => {
    assert.equal(periodWindow('2026-10-26', 7).dates.length, 7);
    assert.equal(periodWindow('2026-03-30', 7).dates.length, 7);
  });

  it('grupos: 1–2 por debajo, 3 como siempre, 4–5 por encima; lo demás, nada', () => {
    assert.deepEqual([1, 2, 3, 4, 5].map(scaleGroup), ['below', 'below', 'usual', 'above', 'above']);
    assert.equal(scaleGroup(null), null);
    assert.equal(scaleGroup(0), null);
  });
});

describe('resumen', () => {
  it('sin registros: cobertura 0 y ninguna escala suficiente', () => {
    const summary = summarize([]);
    assert.equal(summary.loggedDays, 0);
    assert.equal(summary.totalLogged, 0);
    assert.ok(summary.scales.every((scale) => !scale.sufficient && scale.n === 0));
  });

  it('un solo registro: cuenta como día, pero no alcanza el mínimo', () => {
    const summary = summarize([log(0, { energy_level: 4 })]);
    assert.equal(summary.loggedDays, 1);
    assert.equal(summary.todayLogged, true);
    const energy = summary.scales.find((scale) => scale.field === 'energy');
    assert.equal(energy.n, 1);
    assert.equal(energy.sufficient, false);
    assert.deepEqual(energy.last, { date: TODAY, value: 4 });
  });

  it('reparto con n propio por escala; los días sin indicar no cuentan', () => {
    const items = [
      log(0, { energy_level: 3, appetite_level: 2 }),
      log(1, { energy_level: 2 }),
      log(2, { energy_level: 4 }),
      log(4, { energy_level: 5, appetite_level: 3 }),
      log(6, { notes: 'solo nota' }),
    ];
    const summary = summarize(items);
    const energy = summary.scales.find((scale) => scale.field === 'energy');
    assert.deepEqual(energy.distribution, { below: 1, usual: 1, above: 2 });
    assert.equal(energy.n, 4);
    assert.equal(energy.sufficient, true);
    const appetite = summary.scales.find((scale) => scale.field === 'appetite');
    assert.equal(appetite.n, 2);
    assert.equal(appetite.sufficient, false);
    // Un registro sin escalas cuenta como día registrado.
    assert.equal(summary.loggedDays, 5);
  });

  it('mínimos exactos: justo por debajo no, en el mínimo sí', () => {
    for (const period of [7, 30, 90]) {
      const min = MIN_VALUES[period];
      const below = Array.from({ length: min - 1 }, (_, i) => log(i, { mood_level: 3 }));
      const at = Array.from({ length: min }, (_, i) => log(i, { mood_level: 3 }));
      assert.equal(summarize(below, period).scales.find((s) => s.field === 'mood').sufficient, false, `${period} - 1`);
      assert.equal(summarize(at, period).scales.find((s) => s.field === 'mood').sufficient, true, `${period}`);
    }
  });

  it('comparación solo si los dos periodos llegan al mínimo', () => {
    const current = Array.from({ length: 4 }, (_, i) => log(i, { energy_level: 2 }));
    const previous3 = Array.from({ length: 3 }, (_, i) => log(7 + i, { energy_level: 3 }));
    assert.equal(summarize([...current, ...previous3]).scales[0].comparison, null);
    const previous4 = Array.from({ length: 4 }, (_, i) => log(7 + i, { energy_level: 3 }));
    assert.deepEqual(summarize([...current, ...previous4]).scales[0].comparison, {
      previous: { below: 0, usual: 4, above: 0 },
      previousN: 4,
    });
  });

  it('detalles con valores antiguos 1 y 5 entran en su grupo', () => {
    const items = [1, 5, 2, 4].map((value, i) => log(i, { sleep_quality: value }));
    const sleep = summarize(items).scales.find((scale) => scale.field === 'sleep');
    assert.deepEqual(sleep.distribution, { below: 2, usual: 0, above: 2 });
  });

  it('las escalas que no aplican a la especie no se resumen (reptil sin ánimo)', () => {
    const fields = summarize([log(0, { mood_level: 3 })], 7, 'reptile_other').scales.map((scale) => scale.field);
    assert.deepEqual(fields, ['energy', 'appetite', 'activity']);
    // Sin especie conocida: las de siempre.
    assert.equal(summarize([], 7, null).scales.length, 7);
  });

  it('campos de la especie: reparto, sí/no, elecciones y cantidades con mediana', () => {
    const items = [
      log(0, { species_data: { water: 2, vomit: false, stool: 'soft', walks: 2, walk_minutes: 30 } }),
      log(1, { species_data: { water: 3, vomit: true, stool: 'normal', walks: 3, walk_minutes: 60 } }),
      log(2, { species_data: { water: 4, vomit: false, stool: 'normal', walks: 1 } }),
      log(3, { species_data: { water: 3, walks: 2 } }),
    ];
    const fields = Object.fromEntries(summarize(items).speciesFields.map((field) => [field.code, field]));
    assert.deepEqual(fields.water.distribution, { below: 1, usual: 2, above: 1 });
    assert.equal(fields.vomit.yes, 1);
    assert.equal(fields.vomit.n, 3);
    assert.deepEqual(fields.stool.counts, { soft: 1, normal: 2 });
    assert.equal(fields.walks.median, 2);
    assert.equal(fields.walks.min, 1);
    assert.equal(fields.walks.max, 3);
    assert.equal(fields.walk_minutes.median, 45);
    assert.equal(fields.walk_minutes.n, 2);
  });

  it('comportamiento inusual, etiquetas, cambios sin sincronizar y registros anteriores', () => {
    const items = [
      log(0, { unusual_behavior: true, tags: ['vet_visit'] }, { syncStatus: 'pending' }),
      log(2, { tags: ['vet_visit', 'home_change'] }),
      log(3, { unusual_behavior: true }, { syncStatus: 'conflict' }),
      log(20, { energy_level: 3 }),
    ];
    const summary = summarize(items);
    assert.deepEqual(summary.unusualDates, [addDays(TODAY, -3), TODAY]);
    assert.deepEqual(summary.tags[0], { tag: 'vet_visit', dates: [addDays(TODAY, -2), TODAY] });
    assert.equal(summary.unsyncedDays, 2);
    assert.equal(summary.hasEarlierLogs, true);
    assert.equal(summary.loggedDays, 3);
  });

  it('un registro de hoy de otra zona (mañana para mí) no cuenta en el periodo', () => {
    const summary = summarize([log(-1, { energy_level: 3 })]);
    assert.equal(summary.loggedDays, 0);
  });
});

describe('evolución', () => {
  it('serie diaria con huecos, sin rellenar', () => {
    const dates = periodWindow(TODAY, 7).dates;
    const values = dailySeries([log(0, { energy_level: 4 }), log(3, { energy_level: 2 })], dates, { kind: 'core', field: 'energy' });
    assert.deepEqual(values, [null, null, null, 2, null, null, 4]);
    const species = dailySeries([log(1, { species_data: { water: 3 } })], dates, { kind: 'species', code: 'water' });
    assert.deepEqual(species, [null, null, null, null, null, 3, null]);
  });

  it('semanas con su reparto y los días sin dato', () => {
    const items = [log(0, { mood_level: 2 }), log(1, { mood_level: 3 }), log(8, { mood_level: 5 })];
    const weeks = weeklyDistributions(items, TODAY, { kind: 'core', field: 'mood' }, 13);
    assert.equal(weeks.length, 13);
    assert.equal(weeks.at(-1).end, TODAY);
    assert.deepEqual(weeks.at(-1).distribution, { below: 1, usual: 1, above: 0 });
    assert.equal(weeks.at(-1).withoutValue, 5);
    assert.deepEqual(weeks.at(-2).distribution, { below: 0, usual: 0, above: 1 });
  });
});

describe('observaciones', () => {
  const observe = (items, period = 7, speciesCode = 'dog') => computeObservations({ items, today: TODAY, period, speciesCode });

  it('tramo de 3 días seguidos fuera de lo habitual; un hueco lo corta', () => {
    const run = observe([log(0, { appetite_level: 2 }), log(1, { appetite_level: 1 }), log(2, { appetite_level: 2 })]);
    assert.deepEqual(run[0], {
      kind: 'run',
      series: { kind: 'core', field: 'appetite' },
      group: 'below',
      start: addDays(TODAY, -2),
      end: TODAY,
      days: 3,
    });
    const gap = observe([log(0, { appetite_level: 2 }), log(1, { appetite_level: 2 }), log(3, { appetite_level: 2 })]);
    assert.equal(gap.filter((item) => item.kind === 'run').length, 0);
    // «Como siempre» no es un tramo.
    const usual = observe([0, 1, 2].map((i) => log(i, { appetite_level: 3 })));
    assert.equal(usual.filter((item) => item.kind === 'run').length, 0);
  });

  it('un tramo no cruza el inicio del periodo', () => {
    const items = [6, 7, 8].map((i) => log(i, { energy_level: 5 }));
    assert.equal(observe(items).filter((item) => item.kind === 'run').length, 0);
  });

  it('sí/no de la especie varios días seguidos, comportamiento inusual y etiquetas', () => {
    const items = [
      log(0, { unusual_behavior: true, species_data: { hiding: true } }),
      log(1, { unusual_behavior: true, species_data: { hiding: true }, tags: ['home_change'] }),
      log(2, { species_data: { hiding: true } }),
    ];
    const kinds = observe(items, 7, 'cat').map((item) => item.kind);
    // 3 de 7 días registrados: también avisa de la cobertura.
    assert.deepEqual(kinds, ['yes_run', 'unusual', 'tag', 'low_coverage']);
  });

  it('cobertura baja solo con datos y en periodos de una semana o más', () => {
    const low = observe([log(0, { energy_level: 3 }), log(10, { energy_level: 3 })], 30);
    assert.deepEqual(low.at(-1), { kind: 'low_coverage', logged: 2, total: 30 });
    const enough = observe([0, 1, 2, 3].map((i) => log(i, { energy_level: 3 })), 7);
    assert.equal(enough.some((item) => item.kind === 'low_coverage'), false);
    assert.equal(observe([], 30).length, 0);
  });
});

describe('cobertura de las copias locales', () => {
  it('funde rangos que se tocan y conserva el instante más antiguo', () => {
    let coverage = addCoverage(null, { start: '2026-10-01', end: '2026-10-31', fetchedAt: 100 });
    coverage = addCoverage(coverage, { start: '2026-11-01', end: '2026-11-11', fetchedAt: 200 });
    assert.deepEqual(coverage.ranges, [{ start: '2026-10-01', end: '2026-11-11', fetchedAt: 100 }]);
    assert.equal(coveringRange(coverage, '2026-10-15', '2026-11-11').fetchedAt, 100);
    assert.equal(coveringRange(coverage, '2026-09-30', '2026-11-11'), null);
    // Una lectura nueva que lo cubre entero lo renueva.
    coverage = addCoverage(coverage, { start: '2026-09-01', end: '2026-11-11', fetchedAt: 300 });
    assert.deepEqual(coverage.ranges, [{ start: '2026-09-01', end: '2026-11-11', fetchedAt: 300 }]);
  });

  it('rangos separados se guardan aparte', () => {
    const coverage = addCoverage(addCoverage(null, { start: '2026-01-01', end: '2026-01-07', fetchedAt: 1 }), {
      start: '2026-02-01',
      end: '2026-02-07',
      fetchedAt: 2,
    });
    assert.equal(coverage.ranges.length, 2);
  });
});

describe('vista de un rango (servidor + dispositivo)', () => {
  const range = { start: '2026-11-05', end: TODAY };
  // Contenido de un registro (sin `log_date`: lo pone la clave).
  const contentOf = ({ log_date: _date, ...content }) => content;
  const row = (date, energy) => ({ ...log(0).log, id: date, pet_id: 'p', log_date: date, energy_level: energy, updated_at: 'v', created_at: 'v' });
  const localRecord = (date, energy, pending) => ({
    userId: 'u',
    petId: 'p',
    logDate: date,
    serverRow: pending ? null : row(date, energy),
    status: pending ? 'pending' : 'synced',
    pending: pending ? { content: { ...contentOf(log(0).log), energy_level: energy } } : null,
  });

  it('con conexión: lo del servidor dentro del rango, con lo pendiente encima', () => {
    const view = resolveDailyLogRange({
      remote: { status: 'success', data: [row(TODAY, 3), row('2026-11-01', 3)] },
      local: { status: 'ready', data: [localRecord('2026-11-06', 2, true)] },
      syncingKey: null,
      range,
    });
    assert.equal(view.state, 'ready');
    assert.deepEqual(view.items.map((item) => [item.log.log_date, item.syncStatus]), [
      [TODAY, 'synced'],
      ['2026-11-06', 'pending'],
    ]);
  });

  it('sin conexión: solo lo del dispositivo dentro del rango', () => {
    const view = resolveDailyLogRange({
      remote: { status: 'unavailable', error: new Error('offline') },
      local: { status: 'ready', data: [localRecord(TODAY, 3, false), localRecord('2026-10-01', 3, false)] },
      syncingKey: null,
      range,
    });
    assert.equal(view.offline, true);
    assert.deepEqual(view.items.map((item) => item.log.log_date), [TODAY]);
  });
});
