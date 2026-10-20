// Pruebas de `query-defaults.ts` con el runner de Node (`npm test`) y el QueryClient real de
// `@tanstack/query-core` (el mismo que usa `@tanstack/react-query`). Ver frontend/CLAUDE.md.
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { MutationObserver, QueryClient, QueryObserver, focusManager, onlineManager } from '@tanstack/query-core';

import { createAuthSessionController } from '../features/auth/auth-session-controller.ts';
import { createFakeSupabaseAuth, makeSession } from '../features/auth/fake-supabase-auth.mjs';
import { localQueryOptions } from '../features/daily-logs/offline/daily-log-cache.ts';
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
  focusManager.setFocused(undefined);
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

  it('móvil: revalidación al reconectar activada (2026-10-20); web: sin tocar, la de TanStack Query', () => {
    assert.equal(queryDefaultOptions('native').queries.refetchOnReconnect, true);
    assert.equal(client('native').defaultQueryOptions({ queryKey: ['x'] }).refetchOnReconnect, true);
    assert.equal('refetchOnReconnect' in queryDefaultOptions('web').queries, false);
    assert.equal(client('web').defaultQueryOptions({ queryKey: ['x'] }).refetchOnReconnect, true);
  });

  it('web: las opciones son exactamente las de antes', () => {
    assert.deepEqual(queryDefaultOptions('web'), {
      queries: { staleTime: 30_000, retry: 1, networkMode: undefined },
      mutations: { retry: 0, networkMode: undefined },
    });
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

  it('al volver la red se revalidan las queries caducadas, no las vigentes (2026-10-20)', async () => {
    const queryClient = client('native');
    let stale = 0;
    let fresh = 0;
    const a = observe(queryClient, { queryKey: ['caducada'], staleTime: 0, queryFn: () => Promise.resolve((stale += 1)) });
    const b = observe(queryClient, { queryKey: ['vigente'], queryFn: () => Promise.resolve((fresh += 1)) });
    await settle();
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    await settle();
    assert.equal(stale, 2);
    assert.equal(fresh, 1); // `staleTime` de 30 s: no se vuelve a pedir
    a.unsubscribe();
    b.unsubscribe();
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

// Reconexión en móvil (2026-10-20) con la sesión de la app: QueryClient real con las opciones de móvil,
// controlador de sesión real (`auth-session-controller.ts`) sobre el `supabase.auth` falso y, como en
// AuthProvider, las queries por `serverCall` y `invalidateQueries` al recuperar la sesión. `network`
// cuenta las peticiones que llegarían al servidor.
describe('móvil: reconexión con la sesión de la app', () => {
  const KEY = 'sb-test-auth-token';
  const USER = 'a0000000-0000-4000-8000-000000000001';
  const NOW = Date.now();
  const sessions = [];
  afterEach(() => {
    for (const stop of sessions.splice(0)) stop();
  });

  /** App con la sesión guardada (`expired`: token caducado) y la red cortada; arranca y se asienta. */
  async function app({ expired }) {
    const net = { online: false };
    const disk = new Map();
    const expiresAt = Math.floor(NOW / 1000) + (expired ? -600 : 1800);
    disk.set(KEY, JSON.stringify(makeSession(USER, { expiresAt })));
    const auth = createFakeSupabaseAuth({ disk, key: KEY, clock: { now: NOW }, net });
    const controller = createAuthSessionController({
      auth,
      storage: auth.storage,
      storageKey: KEY,
      subscribeOnline: (listener) => onlineManager.subscribe(listener),
      canAttemptRecovery: () => onlineManager.isOnline(),
      startupTimeoutMs: 50,
      recoveryIntervalMs: 3_600_000,
    });
    const queryClient = client('native');
    // AuthProvider: sesión recuperada (misma cuenta) → se vuelven a pedir las queries.
    controller.subscribe((next, previous) => {
      if (previous.status === 'offline' && next.status === 'signed_in') void queryClient.invalidateQueries();
    });
    onlineManager.setOnline(false);
    sessions.push(controller.start());
    await settle(80);

    const network = { calls: 0 };
    // Como `usePets`: la petición solo existe dentro de `serverCall`.
    const { observer, unsubscribe } = observe(queryClient, {
      queryKey: ['pets', 'list'],
      retryDelay: 100,
      queryFn: () =>
        controller.serverCall(async () => {
          network.calls += 1;
          if (!net.online) throw new TypeError('Network request failed');
          return ['Atom'];
        }),
    });
    await settle(250);
    sessions.push(unsubscribe);
    return { net, auth, controller, queryClient, observer, network };
  }

  const reconnect = (net) => {
    net.online = true;
    onlineManager.setOnline(true);
  };

  it('token vigente: la lista que falló sin red se recupera sola al volver la red (sin «Reintentar»)', async () => {
    const { net, controller, observer, network } = await app({ expired: false });
    assert.equal(controller.getState().status, 'signed_in');
    assert.equal(observer.getCurrentResult().status, 'error');
    assert.equal(network.calls, 2); // intento + 1 reintento, sin red

    reconnect(net);
    await settle(50);
    assert.equal(observer.getCurrentResult().status, 'success');
    assert.deepEqual(observer.getCurrentResult().data, ['Atom']);
    assert.equal(network.calls, 3);
  });

  it('sesión sin comprobar (token caducado): sin sesión no sale ninguna petición; al renovarla, una sola', async () => {
    const { net, auth, controller, observer, network } = await app({ expired: true });
    assert.equal(controller.getState().status, 'offline');
    assert.equal(observer.getCurrentResult().status, 'error');
    assert.equal(network.calls, 0); // `serverCall` corta antes de la red

    // La red vuelve pero la renovación tarda: la revalidación al reconectar no envía nada.
    auth.net.hang = true;
    reconnect(net);
    await settle(150);
    assert.equal(controller.getState().status, 'offline');
    assert.equal(network.calls, 0);

    auth.release(); // renovada → AuthProvider vuelve a pedir las queries
    await settle(50);
    assert.equal(controller.getState().status, 'signed_in');
    assert.equal(observer.getCurrentResult().status, 'success');
    assert.equal(network.calls, 1);
    await settle(400); // ningún reintento pendiente añade otra
    assert.equal(network.calls, 1);
  });

  it('red, primer plano y recuperación de la sesión a la vez: una renovación y una petición', async () => {
    const { net, auth, controller, observer, network } = await app({ expired: true });
    const refreshes = auth.calls.refresh;
    reconnect(net);
    focusManager.setFocused(true);
    void controller.recover();
    void controller.recover();
    await settle(400);
    assert.equal(controller.getState().status, 'signed_in');
    assert.equal(observer.getCurrentResult().status, 'success');
    assert.equal(auth.calls.refresh - refreshes, 1);
    assert.equal(network.calls, 1);
  });

  it('token vigente con red y primer plano a la vez (vuelta de la app): una sola petición', async () => {
    const { net, network, observer } = await app({ expired: false });
    const before = network.calls;
    reconnect(net);
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await settle(100);
    assert.equal(observer.getCurrentResult().status, 'success');
    assert.equal(network.calls - before, 1);
  });

  it('las queries locales de Daily Logs (vigentes indefinidamente) no se vuelven a leer al reconectar', async () => {
    const queryClient = client('native');
    let reads = 0;
    const { unsubscribe } = observe(queryClient, {
      queryKey: ['daily-logs', 'local'],
      queryFn: () => Promise.resolve((reads += 1)),
      ...localQueryOptions,
    });
    await settle();
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    await settle();
    assert.equal(reads, 1);
    unsubscribe();
  });
});
