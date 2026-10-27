// Pruebas de `connectivity.ts` con el runner de Node (`npm test`). Ver frontend/CLAUDE.md.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createConnectivityListener, isOnline } from './connectivity.ts';

/** Fuente de red falsa: `emit` simula un cambio; `initial` es una promesa o una función que lanza. */
function fakeSource(initial) {
  const listeners = new Set();
  return {
    listeners,
    removed: 0,
    emit(state) {
      for (const listener of [...listeners]) listener(state);
    },
    getState() {
      return typeof initial === 'function' ? initial() : initial;
    },
    addListener(listener) {
      listeners.add(listener);
      return {
        remove: () => {
          this.removed += 1;
          listeners.delete(listener);
        },
      };
    },
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

function start(source) {
  const values = [];
  const cleanup = createConnectivityListener(source)((online) => values.push(online));
  return { values, cleanup };
}

describe('isOnline', () => {
  it('solo hay "sin conexión" cuando el sistema lo afirma', () => {
    assert.equal(isOnline({ isConnected: true, isInternetReachable: true }), true);
    assert.equal(isOnline({ isConnected: false, isInternetReachable: false }), false);
    assert.equal(isOnline({}), true);
    assert.equal(isOnline(null), true);
    assert.equal(isOnline(undefined), true);
  });

  it('una red sin salida validada a internet sigue contando como conectada', () => {
    assert.equal(isOnline({ isConnected: true, isInternetReachable: false }), true);
  });
});

describe('createConnectivityListener', () => {
  it('publica el estado inicial y después cada cambio', async () => {
    const source = fakeSource(Promise.resolve({ isConnected: false }));
    const { values } = start(source);
    await settle();
    assert.deepEqual(values, [false]);

    source.emit({ isConnected: true });
    source.emit({ isConnected: false });
    assert.deepEqual(values, [false, true, false]);
  });

  it('el estado inicial no pisa un evento que llegó antes', async () => {
    let resolveInitial;
    const source = fakeSource(new Promise((resolve) => (resolveInitial = resolve)));
    const { values } = start(source);
    source.emit({ isConnected: false });
    resolveInitial({ isConnected: true });
    await settle();
    assert.deepEqual(values, [false]);
  });

  it('si no se puede leer el estado, no se da por perdido la conexión y los eventos siguen llegando', async () => {
    for (const initial of [
      Promise.reject(new Error('ERR_NETWORK_NO_ACCESS_NETWORKINFO')),
      () => {
        throw new Error('módulo no disponible');
      },
    ]) {
      const source = fakeSource(initial);
      const { values } = start(source);
      await settle();
      assert.deepEqual(values, []);
      source.emit({ isConnected: false });
      assert.deepEqual(values, [false]);
    }
  });

  it('si no se puede suscribir, queda el estado inicial y la limpieza no falla', async () => {
    const source = {
      getState: () => Promise.resolve({ isConnected: true }),
      addListener: () => {
        throw new Error('sin eventos');
      },
    };
    const { values, cleanup } = start(source);
    await settle();
    assert.deepEqual(values, [true]);
    cleanup();
  });

  it('la limpieza quita la suscripción y descarta lo que llegue después', async () => {
    let resolveInitial;
    const source = fakeSource(new Promise((resolve) => (resolveInitial = resolve)));
    const { values, cleanup } = start(source);
    assert.equal(source.listeners.size, 1);

    cleanup();
    assert.equal(source.listeners.size, 0);
    assert.equal(source.removed, 1);

    resolveInitial({ isConnected: false });
    await settle();
    assert.deepEqual(values, []);

    cleanup(); // llamarla dos veces no falla ni vuelve a quitar nada
    assert.equal(source.removed, 1);
  });

  it('cada arranque crea su propia suscripción (TanStack Query lo reinicia al volver a tener suscriptores)', async () => {
    const source = fakeSource(Promise.resolve({ isConnected: true }));
    const setup = createConnectivityListener(source);
    const first = [];
    const stopFirst = setup((online) => first.push(online));
    stopFirst();
    const second = [];
    setup((online) => second.push(online));
    await settle();
    source.emit({ isConnected: false });
    assert.deepEqual(first, []);
    assert.deepEqual(second, [true, false]);
    assert.equal(source.listeners.size, 1);
  });
});

describe('relecturas del estado (fase 11: el último evento puede quedarse atrás)', () => {
  /** Fuente cuyo estado actual (`current`) puede no coincidir con el último evento emitido. */
  function staleSource(current) {
    const source = fakeSource(null);
    source.current = current;
    source.reads = 0;
    source.getState = () => {
      source.reads += 1;
      return Promise.resolve(source.current);
    };
    return source;
  }

  /** Temporizadores manuales y aviso de primer plano controlable. */
  function rechecks() {
    const timers = new Map();
    let next = 0;
    const foreground = new Set();
    return {
      timers,
      foreground,
      fire: () => {
        const pending = [...timers.values()];
        timers.clear();
        for (const callback of pending) callback();
      },
      toForeground: () => [...foreground].forEach((listener) => listener()),
      options: {
        subscribeForeground: (listener) => {
          foreground.add(listener);
          return () => foreground.delete(listener);
        },
        offlineRecheckMs: 10_000,
        setTimer: (callback) => {
          next += 1;
          timers.set(next, callback);
          return next;
        },
        clearTimer: (handle) => timers.delete(handle),
      },
    };
  }

  const begin = (source, extra) => {
    const values = [];
    const cleanup = createConnectivityListener(source, extra.options)((online) => values.push(online));
    return { values, cleanup };
  };

  it('al volver a primer plano se relee: un «sin conexión» atrasado se corrige', async () => {
    const source = staleSource({ isConnected: true });
    const extra = rechecks();
    const { values } = begin(source, extra);
    await settle();
    source.emit({ isConnected: false }); // evento atrasado: la Wi-Fi ya está conectada
    assert.deepEqual(values, [true, false]);

    extra.toForeground();
    await settle();
    assert.deepEqual(values, [true, false, true]);
  });

  it('mientras dice «sin conexión», se relee cada cierto tiempo; con conexión deja de releer', async () => {
    const source = staleSource({ isConnected: false });
    const extra = rechecks();
    const { values } = begin(source, extra);
    await settle();
    assert.deepEqual(values, [false]);
    assert.equal(extra.timers.size, 1, 'programada la relectura');

    extra.fire();
    await settle();
    assert.deepEqual(values, [false, false], 'sigue sin conexión: se vuelve a programar');
    assert.equal(extra.timers.size, 1);

    source.current = { isConnected: true };
    extra.fire();
    await settle();
    assert.deepEqual(values, [false, false, true]);
    assert.equal(extra.timers.size, 0, 'con conexión no hay más relecturas');
  });

  it('una relectura no pisa un evento que llegó mientras se leía', async () => {
    const source = staleSource({ isConnected: true });
    const extra = rechecks();
    const { values } = begin(source, extra);
    await settle();
    let resolveRead;
    source.getState = () => new Promise((resolve) => (resolveRead = resolve));
    extra.toForeground();
    await Promise.resolve(); // la lectura ya empezó
    assert.equal(typeof resolveRead, 'function');
    source.emit({ isConnected: false });
    resolveRead({ isConnected: true });
    await settle();
    assert.deepEqual(values, [true, false]);
  });

  it('un error al releer no cambia nada', async () => {
    const source = staleSource({ isConnected: false });
    const extra = rechecks();
    const { values } = begin(source, extra);
    await settle();
    source.getState = () => Promise.reject(new Error('no disponible'));
    extra.toForeground();
    extra.fire();
    await settle();
    assert.deepEqual(values, [false]);
  });

  it('la limpieza cancela la relectura pendiente y el aviso de primer plano', async () => {
    const source = staleSource({ isConnected: false });
    const extra = rechecks();
    const { values, cleanup } = begin(source, extra);
    await settle();
    cleanup();
    assert.equal(extra.timers.size, 0);
    assert.equal(extra.foreground.size, 0);
    source.current = { isConnected: true };
    extra.toForeground();
    await settle();
    assert.deepEqual(values, [false]);
  });
});
