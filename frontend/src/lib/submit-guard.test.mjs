// Pruebas de `submit-guard.ts` con el runner de Node (`npm test`). Ver frontend/CLAUDE.md.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createSubmitGuard } from './submit-guard.ts';

describe('createSubmitGuard', () => {
  it('un segundo envío mientras el primero está en curso no se ejecuta', async () => {
    const guard = createSubmitGuard();
    let calls = 0;
    let release;
    const task = () => {
      calls += 1;
      return new Promise((resolve) => {
        release = resolve;
      });
    };

    const first = guard.run(task);
    const second = guard.run(task);
    assert.notEqual(first, null);
    assert.equal(second, null);
    assert.equal(calls, 1);
    assert.equal(guard.isRunning(), true);

    release('ok');
    assert.equal(await first, 'ok');
    assert.equal(guard.isRunning(), false);
  });

  it('se libera también si la operación falla, y se puede reintentar', async () => {
    const guard = createSubmitGuard();
    await assert.rejects(guard.run(() => Promise.reject(new Error('rpc'))));
    assert.equal(guard.isRunning(), false);
    assert.equal(await guard.run(() => Promise.resolve(2)), 2);
  });
});
