import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { computeChangeSignals, SIGNAL_MIN_BASELINE } from './change-signals.ts';

const TODAY = '2026-11-03';

function dayBefore(days) {
  const date = new Date(Date.UTC(2026, 10, 3 - days));
  return date.toISOString().slice(0, 10);
}

function item(daysAgo, overrides = {}) {
  return {
    log: {
      log_date: dayBefore(daysAgo),
      appetite_level: 3,
      mood_level: 3,
      energy_level: 3,
      activity_level: 3,
      unusual_behavior: false,
      ...overrides,
    },
  };
}

/** Lo normal: `count` días, todos en 3, a partir de hace 3 días (los recientes son 0, 1 y 2). */
function baseline(count = 10, overrides = {}) {
  return Array.from({ length: count }, (_, index) => item(3 + index, overrides));
}

describe('computeChangeSignals', () => {
  it('sin cambios no hay señales', () => {
    assert.deepEqual(computeChangeSignals([item(0), item(1), item(2), ...baseline()], TODAY), []);
  });

  it('avisa si una escala baja varios días seguidos respecto a lo normal', () => {
    const items = [item(0, { appetite_level: 1 }), item(1, { appetite_level: 2 }), item(2, { appetite_level: 2 }), ...baseline()];
    const [signal, ...rest] = computeChangeSignals(items, TODAY);
    assert.equal(signal.metric, 'appetite');
    assert.equal(signal.direction, 'lower');
    assert.ok(Math.abs(signal.delta - 4 / 3) < 1e-9);
    assert.deepEqual(rest, []);
  });

  it('también si sube, salvo el ánimo: mejorar no es motivo de aviso', () => {
    const items = [
      item(0, { energy_level: 5, mood_level: 5 }),
      item(1, { energy_level: 5, mood_level: 5 }),
      ...baseline(),
    ];
    assert.deepEqual(
      computeChangeSignals(items, TODAY).map((signal) => [signal.metric, signal.direction]),
      [['energy', 'higher']]
    );
    const worse = [item(0, { mood_level: 1 }), item(1, { mood_level: 1 }), ...baseline()];
    assert.equal(computeChangeSignals(worse, TODAY)[0].metric, 'mood');
  });

  it('un solo día distinto no es un cambio', () => {
    assert.deepEqual(computeChangeSignals([item(0, { appetite_level: 1 }), ...baseline()], TODAY), []);
    // Dos días, pero uno en lo normal: la media cae, pero no es un cambio sostenido.
    const mixed = [item(0, { appetite_level: 1 }), item(1, { appetite_level: 3 }), ...baseline()];
    assert.deepEqual(computeChangeSignals(mixed, TODAY), []);
  });

  it('sin historial suficiente no se compara', () => {
    const recent = [item(0, { appetite_level: 1, unusual_behavior: true }), item(1, { appetite_level: 1, unusual_behavior: true })];
    assert.deepEqual(computeChangeSignals([...recent, ...baseline(SIGNAL_MIN_BASELINE - 1)], TODAY), []);
    assert.equal(computeChangeSignals([...recent, ...baseline(SIGNAL_MIN_BASELINE)], TODAY).length, 2);
  });

  it('cuenta lo normal de cada escala: las no indicadas no suman', () => {
    const items = [
      item(0, { appetite_level: 1 }),
      item(1, { appetite_level: 1 }),
      ...baseline(10, { appetite_level: null }),
    ];
    assert.deepEqual(computeChangeSignals(items, TODAY), []);
  });

  it('conducta inusual en al menos dos días recientes, primero en la lista', () => {
    const items = [
      item(0, { unusual_behavior: true, energy_level: 1 }),
      item(1, { unusual_behavior: true, energy_level: 1 }),
      ...baseline(),
    ];
    assert.deepEqual(
      computeChangeSignals(items, TODAY).map((signal) => signal.kind),
      ['unusual', 'scale']
    );
    assert.deepEqual(computeChangeSignals([item(0, { unusual_behavior: true }), ...baseline()], TODAY), []);
  });

  it('ordena las escalas de más a menos marcadas y no mira fuera de la ventana', () => {
    const items = [
      item(0, { energy_level: 2, appetite_level: 1 }),
      item(1, { energy_level: 2, appetite_level: 1 }),
      ...baseline(),
    ];
    assert.deepEqual(
      computeChangeSignals(items, TODAY).map((signal) => signal.metric),
      ['appetite', 'energy']
    );
    // Lo normal con registros muy antiguos (fuera de los 28 días) no cuenta.
    const old = Array.from({ length: 10 }, (_, index) => item(40 + index));
    assert.deepEqual(computeChangeSignals([item(0, { energy_level: 1 }), item(1, { energy_level: 1 }), ...old], TODAY), []);
    // Un registro con fecha futura no cuenta como reciente.
    const future = { log: { ...item(0).log, log_date: '2026-11-04', energy_level: 1 } };
    assert.deepEqual(computeChangeSignals([future, item(0, { energy_level: 1 }), ...baseline()], TODAY), []);
  });
});
