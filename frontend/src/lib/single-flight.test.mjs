// Pruebas de `single-flight.ts` (`npm test`).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { singleFlight } from './single-flight.ts';

describe('singleFlight', () => {
  it('dos llamadas simultáneas comparten una sola ejecución (p. ej. dos cierres de sesión)', async () => {
    let runs = 0;
    let release;
    const signOut = singleFlight(async () => {
      runs += 1;
      await new Promise((resolve) => (release = resolve));
      return { error: null };
    });
    const first = signOut();
    const second = signOut();
    assert.equal(first, second);
    release();
    assert.deepEqual(await first, { error: null });
    assert.equal(runs, 1);
  });

  it('al terminar (también con error) se puede volver a ejecutar', async () => {
    let runs = 0;
    const task = singleFlight(async () => {
      runs += 1;
      if (runs === 1) throw new Error('falló');
      return runs;
    });
    await assert.rejects(task(), /falló/);
    assert.equal(await task(), 2);
  });
});
