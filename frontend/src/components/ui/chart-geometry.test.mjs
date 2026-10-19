import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { addDays, lastDays, linePath, monthGrid, pointX, pointY } from './chart-geometry.ts';

const box = { width: 100, height: 50, padX: 0, padY: 0, min: 1, max: 5 };

describe('pointX / pointY', () => {
  it('reparte los puntos en el ancho y pone los valores altos arriba', () => {
    assert.equal(pointX(0, 3, box), 0);
    assert.equal(pointX(2, 3, box), 100);
    assert.equal(pointY(5, box), 0);
    assert.equal(pointY(1, box), 50);
    assert.equal(pointY(3, box), 25);
  });
});

describe('linePath', () => {
  it('une los valores consecutivos', () => {
    assert.equal(linePath([1, 5], box), 'M0.0 50.0 L100.0 0.0');
  });

  it('corta la línea en los huecos (nunca interpola)', () => {
    assert.equal(linePath([1, null, 5], box), 'M0.0 50.0 L0.0 50.0 M100.0 0.0 L100.0 0.0');
  });

  it('sin valores, no dibuja nada', () => {
    assert.equal(linePath([null, null], box), '');
  });
});

describe('monthGrid', () => {
  it('empieza en lunes y tiene 42 celdas', () => {
    const cells = monthGrid(2026, 9); // octubre de 2026: el 1 es jueves
    assert.equal(cells.length, 42);
    assert.deepEqual(cells[0], { date: '2026-09-28', day: 28, inMonth: false });
    assert.deepEqual(cells[3], { date: '2026-10-01', day: 1, inMonth: true });
    assert.equal(cells.filter((cell) => cell.inMonth).length, 31);
  });
});

describe('addDays / lastDays', () => {
  it('cruza meses y años', () => {
    assert.equal(addDays('2026-01-01', -1), '2025-12-31');
    assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  });

  it('devuelve los días que terminan en la fecha, del más antiguo al más reciente', () => {
    assert.deepEqual(lastDays('2026-10-16', 3), ['2026-10-14', '2026-10-15', '2026-10-16']);
  });
});
