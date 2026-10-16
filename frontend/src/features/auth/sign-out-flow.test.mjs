// Pruebas de `sign-out-flow.ts` (`npm test`) con dependencias falsas: cuándo se cierra la sesión y
// cuándo no. El flujo completo con el motor, el servidor falso y el cambio de cuenta está en
// `features/daily-logs/offline/daily-log-session.test.mjs`.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createSignOutFlow, unsyncedTotal } from './sign-out-flow.ts';

const NONE = { pending: 0, failed: 0, conflict: 0 };

function setup({ summaries = [NONE], sync = async () => ({ status: 'completed' }), signOutError = null } = {}) {
  const calls = { check: 0, sync: 0, signOut: 0 };
  const queue = [...summaries];
  const flow = createSignOutFlow({
    async checkUnsynced() {
      calls.check += 1;
      const next = queue.length > 1 ? queue.shift() : queue[0];
      if (next instanceof Error) throw next;
      return next;
    },
    async syncNow() {
      calls.sync += 1;
      return sync();
    },
    async signOut() {
      calls.signOut += 1;
      return { error: signOutError };
    },
  });
  return { flow, calls };
}

describe('createSignOutFlow', () => {
  it('1. sin cambios sin sincronizar: cierra sesión como siempre, sin preguntar ni sincronizar', async () => {
    const { flow, calls } = setup();
    assert.deepEqual(await flow.request(), { status: 'signed_out', error: null });
    assert.deepEqual(calls, { check: 1, sync: 0, signOut: 1 });
    assert.equal(flow.getState(), 'idle');
  });

  it('2. con pendientes: no cierra; «Cancelar» no cambia nada', async () => {
    const { flow, calls } = setup({ summaries: [{ pending: 2, failed: 0, conflict: 1 }] });
    assert.deepEqual(await flow.request(), {
      status: 'needs_decision',
      summary: { pending: 2, failed: 0, conflict: 1 },
      attempt: null,
    });
    flow.cancel();
    assert.deepEqual(calls, { check: 1, sync: 0, signOut: 0 });
    assert.equal(flow.getState(), 'idle');
  });

  it('no se puede leer el dispositivo: no se da por hecho que no hay nada (pide decisión)', async () => {
    const { flow, calls } = setup({ summaries: [new Error('storage_failed')] });
    assert.deepEqual(await flow.request(), { status: 'needs_decision', summary: null, attempt: null });
    assert.equal(calls.signOut, 0);
  });

  it('3. sincronizar y cerrar: solo cierra si después no queda nada', async () => {
    const { flow, calls } = setup({ summaries: [NONE] });
    assert.deepEqual(await flow.syncAndSignOut(), { status: 'signed_out', error: null });
    assert.deepEqual(calls, { check: 1, sync: 1, signOut: 1 });
  });

  it('si queda algo, vuelve a pedir la decisión con lo que queda y por qué', async () => {
    const left = { pending: 0, failed: 1, conflict: 1 };
    for (const [sync, attempt] of [
      [{ status: 'completed' }, 'incomplete'],
      [{ status: 'timed_out' }, 'timed_out'],
      [{ status: 'unavailable', reason: 'offline' }, 'offline'],
      [{ status: 'unavailable', reason: 'session' }, 'session'],
      [{ status: 'unavailable', reason: 'stopped' }, 'session'],
    ]) {
      const { flow, calls } = setup({ summaries: [left], sync: async () => sync });
      assert.deepEqual(await flow.syncAndSignOut(), { status: 'needs_decision', summary: left, attempt }, attempt);
      assert.equal(calls.signOut, 0);
    }
  });

  it('13. un fallo del almacén durante el intento no cierra la sesión ni da nada por sincronizado', async () => {
    const { flow, calls } = setup({
      summaries: [new Error('storage_failed')],
      sync: async () => Promise.reject(new Error('storage_failed')),
    });
    assert.deepEqual(await flow.syncAndSignOut(), { status: 'needs_decision', summary: null, attempt: 'incomplete' });
    assert.equal(calls.signOut, 0);
  });

  it('4. conservar y cerrar: cierra sesión sin sincronizar ni comprobar nada', async () => {
    const { flow, calls } = setup({ summaries: [{ pending: 1, failed: 0, conflict: 0 }] });
    assert.deepEqual(await flow.keepAndSignOut(), { status: 'signed_out', error: null });
    assert.deepEqual(calls, { check: 0, sync: 0, signOut: 1 });
  });

  it('el error del cierre de sesión se devuelve (informativo)', async () => {
    const { flow } = setup({ signOutError: 'network' });
    assert.deepEqual(await flow.keepAndSignOut(), { status: 'signed_out', error: 'network' });
  });

  it('11. una operación a la vez: un segundo cierre mientras hay uno en curso es `busy`', async () => {
    let release;
    const { flow, calls } = setup({ sync: () => new Promise((resolve) => (release = () => resolve({ status: 'completed' }))) });
    const first = flow.syncAndSignOut();
    assert.equal(flow.getState(), 'syncing');
    assert.deepEqual(await flow.request(), { status: 'busy' });
    assert.deepEqual(await flow.keepAndSignOut(), { status: 'busy' });
    assert.deepEqual(await flow.syncAndSignOut(), { status: 'busy' });
    while (!release) await new Promise((resolve) => setImmediate(resolve));
    release();
    assert.equal((await first).status, 'signed_out');
    assert.deepEqual(calls, { check: 1, sync: 1, signOut: 1 });
  });

  it('dos toques seguidos en «Cerrar sesión» (sin pendientes) cierran una sola vez', async () => {
    const { flow, calls } = setup();
    const [a, b] = await Promise.all([flow.request(), flow.request()]);
    assert.deepEqual([a.status, b.status].sort(), ['busy', 'signed_out']);
    assert.equal(calls.signOut, 1);
  });

  it('cancelar durante el intento: la pasada sigue, pero al terminar ya no cierra sesión', async () => {
    let release;
    const { flow, calls } = setup({ sync: () => new Promise((resolve) => (release = () => resolve({ status: 'completed' }))) });
    const states = [];
    flow.subscribe(() => states.push(flow.getState()));
    const pending = flow.syncAndSignOut();
    while (!release) await new Promise((resolve) => setImmediate(resolve));
    flow.cancel();
    assert.equal(flow.getState(), 'idle');
    release();
    assert.deepEqual(await pending, { status: 'cancelled' });
    assert.equal(calls.signOut, 0);
    assert.deepEqual(states, ['syncing', 'idle']);
  });

  it('cancelar mientras se cierra la sesión no lo deshace (ya no se puede)', async () => {
    let release;
    const flow = createSignOutFlow({
      checkUnsynced: async () => NONE,
      syncNow: async () => ({ status: 'completed' }),
      signOut: () => new Promise((resolve) => (release = () => resolve({ error: null }))),
    });
    const pending = flow.keepAndSignOut();
    assert.equal(flow.getState(), 'signing_out');
    flow.cancel();
    assert.equal(flow.getState(), 'signing_out');
    release();
    assert.equal((await pending).status, 'signed_out');
    assert.equal(flow.getState(), 'idle');
  });

  it('unsyncedTotal suma pendientes, fallidos y conflictos', () => {
    assert.equal(unsyncedTotal({ pending: 1, failed: 2, conflict: 3 }), 6);
  });
});
