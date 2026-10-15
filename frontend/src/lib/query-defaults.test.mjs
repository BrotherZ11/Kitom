// Pruebas de `query-defaults.ts` con el runner de Node (`npm test`) y el QueryClient real de
// `@tanstack/query-core` (el mismo que usa `@tanstack/react-query`). Ver frontend/CLAUDE.md.
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { MutationObserver, QueryClient, QueryObserver, onlineManager } from '@tanstack/query-core';

import { queryDefaultOptions } from './query-defaults.ts';

const settle = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
const networkError = () => Promise.reject(new TypeError('Network request failed'));

/** Cliente con las opciones de la app para `platform`, montado como lo monta QueryClientProvider. */
function mountClient(platform) {
  const client = new QueryClient({ defaultOptions: queryDefaultOptions(platform) });
  client.mount();
  return client;
}

const clients = [];
function client(platform) {
  const created = mountClient(platform);
  clients.push(created);
  return created;
}

/** Observa una query como lo hace `useQuery`. */
function observe(queryClient, options) {
  const observer = new QueryObserver(queryClient, { retryDelay: 1, ...options });
  const unsubscribe = observer.subscribe(() => {});
  return { observer, unsubscribe };
}

afterEach(() => {
  onlineManager.setOnline(true);
  for (const created of clients.splice(0)) {
    created.clear();
    created.unmount();
  }
});

describe('queryDefaultOptions', () => {
  it('conserva los valores que ya tenía el QueryClient', () => {
    for (const platform of ['web', 'native']) {
      const { queries, mutations } = queryDefaultOptions(platform);
      assert.equal(queries.staleTime, 30_000);
      assert.equal(queries.retry, 1);
      assert.equal(mutations.retry, 0);
    }
  });

  it('móvil: `always` en queries y mutaciones; web: el modo por defecto de TanStack Query', () => {
    assert.equal(queryDefaultOptions('native').queries.networkMode, 'always');
    assert.equal(queryDefaultOptions('native').mutations.networkMode, 'always');
    assert.equal(queryDefaultOptions('web').queries.networkMode, undefined);
    assert.equal(queryDefaultOptions('web').mutations.networkMode, undefined);
  });

  it('no añade revalidaciones nuevas: al reconectar, en móvil no se vuelve a pedir nada', () => {
    assert.equal('refetchOnReconnect' in queryDefaultOptions('native').queries, false);
    assert.equal(client('native').defaultQueryOptions({ queryKey: ['x'] }).refetchOnReconnect, false);
    assert.equal(client('web').defaultQueryOptions({ queryKey: ['x'] }).refetchOnReconnect, true);
  });
});

describe('móvil con la señal de red: mismo comportamiento que sin ella', () => {
  it('sin conexión, una query se intenta y termina en error (no se queda cargando)', async () => {
    onlineManager.setOnline(false);
    let calls = 0;
    const { observer, unsubscribe } = observe(client('native'), {
      queryKey: ['pets', 'list'],
      queryFn: () => {
        calls += 1;
        return networkError();
      },
    });
    await settle(60);
    const result = observer.getCurrentResult();
    assert.equal(calls, 2); // intento + 1 reintento (`retry: 1`), como hasta ahora
    assert.equal(result.status, 'error');
    assert.equal(result.fetchStatus, 'idle');
    assert.equal(result.isPaused, false);
    unsubscribe();
  });

  it('sin conexión, una mutación se ejecuta en el momento y falla: no queda en cola', async () => {
    onlineManager.setOnline(false);
    let calls = 0;
    const mutation = new MutationObserver(client('native'), {
      mutationFn: () => {
        calls += 1;
        return networkError();
      },
    });
    await assert.rejects(mutation.mutate(), TypeError);
    assert.equal(calls, 1);
    assert.equal(mutation.getCurrentResult().isPaused, false);
    assert.equal(mutation.getCurrentResult().status, 'error');

    // Al volver la red no se reenvía nada por su cuenta.
    onlineManager.setOnline(true);
    await settle();
    assert.equal(calls, 1);
  });

  it('al volver la red no se revalida ninguna query (antes no existía ese evento)', async () => {
    let calls = 0;
    const { unsubscribe } = observe(client('native'), {
      queryKey: ['daily-logs', 'detail'],
      staleTime: 0,
      queryFn: () => {
        calls += 1;
        return Promise.resolve('fila');
      },
    });
    await settle();
    assert.equal(calls, 1);
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    await settle();
    assert.equal(calls, 1);
    unsubscribe();
  });

  it('con conexión todo sigue igual: la query carga y la mutación guarda', async () => {
    const queryClient = client('native');
    const { observer, unsubscribe } = observe(queryClient, { queryKey: ['x'], queryFn: () => Promise.resolve(1) });
    await settle();
    assert.equal(observer.getCurrentResult().data, 1);
    assert.equal(await new MutationObserver(queryClient, { mutationFn: () => Promise.resolve('ok') }).mutate(), 'ok');
    unsubscribe();
  });
});

// Comportamiento previo de web (modo por defecto), que NO se cambia. Queda fijado aquí porque es el
// riesgo pendiente de decidir en la fase 2: una mutación en pausa se envía sola al reconectar.
describe('web: modo por defecto de TanStack Query (sin cambios)', () => {
  it('sin conexión, una query queda en pausa sin llamar al servidor y se lanza al reconectar', async () => {
    onlineManager.setOnline(false);
    let calls = 0;
    const { observer, unsubscribe } = observe(client('web'), {
      queryKey: ['pets', 'list'],
      queryFn: () => {
        calls += 1;
        return Promise.resolve([]);
      },
    });
    await settle();
    assert.equal(calls, 0);
    assert.equal(observer.getCurrentResult().status, 'pending');
    assert.equal(observer.getCurrentResult().fetchStatus, 'paused');

    onlineManager.setOnline(true);
    await settle();
    assert.equal(calls, 1);
    assert.equal(observer.getCurrentResult().status, 'success');
    unsubscribe();
  });

  it('sin conexión, una mutación queda en pausa y se envía sola al reconectar', async () => {
    onlineManager.setOnline(false);
    let calls = 0;
    const mutation = new MutationObserver(client('web'), {
      mutationFn: () => {
        calls += 1;
        return Promise.resolve('guardado');
      },
    });
    const pending = mutation.mutate();
    await settle();
    assert.equal(calls, 0);
    assert.equal(mutation.getCurrentResult().isPaused, true);

    onlineManager.setOnline(true);
    assert.equal(await pending, 'guardado');
    assert.equal(calls, 1);
  });
});
