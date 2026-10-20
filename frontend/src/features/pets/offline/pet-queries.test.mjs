// Pruebas de `pet-queries.ts` (`npm test`) con el QueryClient real de `@tanstack/query-core` y las
// opciones de la app, montadas como en `hooks/use-pets.ts`: errores, cambio de cuenta en vuelo,
// sesión `offline` (con el controlador de sesión real) y reconexión.
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { onlineManager, QueryClient, QueryObserver } from '@tanstack/query-core';

import { createAuthSessionController } from '../../auth/auth-session-controller.ts';
import { makeSession, sessionStorageOn } from '../../auth/fake-supabase-auth.mjs';
import { queryDefaultOptions } from '../../../lib/query-defaults.ts';
import { SessionUnavailableError } from '../../../lib/user-token-fetch.ts';
import { petKeys } from '../query-keys.ts';
import { fetchPetListThroughCache, fetchPetThroughCache, storePetWrite } from './pet-queries.ts';
import { resolvePetListView } from './pet-view.ts';
import { deferred, device, makePet, USER_A, USER_B } from './pet-test-helpers.mjs';

const settle = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
const networkError = () => new TypeError('Network request failed');

const clients = [];
function mountClient(platform = 'native') {
  const client = new QueryClient({ defaultOptions: queryDefaultOptions(platform) });
  client.mount();
  clients.push(client);
  return client;
}

afterEach(() => {
  onlineManager.setOnline(true);
  for (const client of clients.splice(0)) {
    client.clear();
    client.unmount();
  }
});

/** Sesión de la app simplificada: quién tiene la sesión y si es utilizable (como `serverCall`). */
function fakeSession(userId) {
  const state = { userId, usable: true };
  return {
    state,
    isCurrentUser: (id) => state.userId === id,
    serverCall: (call) => (state.usable ? call() : Promise.reject(new SessionUnavailableError())),
  };
}

/** Servidor falso de lecturas: cuenta peticiones y responde con `handler` (o lo que se le retenga). */
function fakeReads(handler) {
  const calls = { list: 0, detail: 0 };
  return {
    calls,
    reads: {
      list: async () => {
        calls.list += 1;
        return handler('list');
      },
      detail: async (petId) => {
        calls.detail += 1;
        return handler('detail', petId);
      },
    },
  };
}

/** La query de la lista tal como la monta `usePets`. */
function listQuery(client, { userId, session, repository, reads, enabled = true }) {
  const observer = new QueryObserver(client, {
    queryKey: petKeys.lists(userId),
    enabled,
    retryDelay: 1,
    queryFn: () =>
      fetchPetListThroughCache({
        repository,
        reads,
        serverCall: session.serverCall,
        isOwnerSession: () => session.isCurrentUser(userId),
        onStored: () => void client.invalidateQueries({ queryKey: petKeys.local(userId) }),
      }),
  });
  const unsubscribe = observer.subscribe(() => {});
  return { observer, unsubscribe };
}

describe('lecturas a través de la copia', () => {
  it('1. primera carga online: lo devuelto se muestra y queda guardado', async () => {
    const { repository } = device();
    const repo = repository(USER_A);
    const luna = makePet();
    const { reads } = fakeReads(() => [luna]);
    const client = mountClient();
    const { observer } = listQuery(client, { userId: USER_A, session: fakeSession(USER_A), repository: repo, reads });
    await settle();
    assert.deepEqual(observer.getCurrentResult().data, [luna]);
    assert.deepEqual((await repo.readList()).pets, [luna]);
  });

  it('4. un error de red (o sin sesión) al refrescar no sobrescribe ni vacía la copia', async () => {
    const { repository } = device();
    const repo = repository(USER_A);
    const luna = makePet();
    let fail = null;
    const { reads } = fakeReads(() => {
      if (fail) throw fail;
      return [luna];
    });
    const session = fakeSession(USER_A);
    const client = mountClient();
    const { observer } = listQuery(client, { userId: USER_A, session, repository: repo, reads });
    await settle();

    fail = networkError();
    await observer.refetch();
    assert.equal(observer.getCurrentResult().status, 'error');
    assert.deepEqual(observer.getCurrentResult().data, [luna]);
    assert.deepEqual((await repo.readList()).pets, [luna]);

    session.state.usable = false;
    await observer.refetch();
    assert.deepEqual((await repo.readList()).pets, [luna]);
  });

  it('una respuesta de error nunca llega al almacén (ni como lista vacía)', async () => {
    const calls = [];
    const repo = { beginRead: () => 1, applyList: async (...args) => calls.push(args), applyPet: async () => null };
    const { reads } = fakeReads(() => {
      throw { code: 'PGRST301', message: 'JWT expired' };
    });
    await assert.rejects(
      fetchPetListThroughCache({ repository: repo, reads, serverCall: (call) => call(), isOwnerSession: () => true })
    );
    await assert.rejects(
      fetchPetThroughCache({ repository: repo, reads, serverCall: (call) => call(), isOwnerSession: () => true }, makePet().id)
    );
    assert.equal(calls.length, 0);
  });

  it('7. dos lecturas de la lista en vuelo que responden al revés: se muestra y guarda la más reciente', async () => {
    const { repository } = device();
    const repo = repository(USER_A);
    const luna = makePet({ updated_at: '2026-10-01T09:00:01.000001+00:00' });
    const first = deferred();
    const second = deferred();
    const responses = [first.promise, second.promise];
    const { reads } = fakeReads(() => responses.shift());
    const deps = { repository: repo, reads, serverCall: (call) => call(), isOwnerSession: () => true };

    const older = fetchPetListThroughCache(deps);
    const newer = fetchPetListThroughCache(deps);
    second.resolve([{ ...luna, name: 'Luna (editada)', updated_at: '2026-10-01T09:00:02.000001+00:00' }]);
    assert.equal((await newer)[0].name, 'Luna (editada)');
    first.resolve([luna, makePet({ name: 'Ya no visible' })]);
    assert.deepEqual((await older).map((pet) => pet.name), ['Luna (editada)']);
    assert.deepEqual((await repo.readList()).pets.map((pet) => pet.name), ['Luna (editada)']);
  });
});

describe('8. cambio de usuario con una consulta en vuelo', () => {
  it('la respuesta tardía de la cuenta anterior no se guarda ni aparece en la cuenta nueva', async () => {
    const { repository } = device();
    const repoA = repository(USER_A);
    const repoB = repository(USER_B);
    const lunaA = makePet({ owner_id: USER_A });
    const kiraB = makePet({ owner_id: USER_B, name: 'Kira' });
    const heldA = deferred();
    const session = fakeSession(USER_A);
    const { reads } = fakeReads(() => (session.state.userId === USER_A ? heldA.promise : [kiraB]));
    const client = mountClient();

    listQuery(client, { userId: USER_A, session, repository: repoA, reads });
    await settle();
    // Cambio de cuenta: AuthProvider vacía la caché en el mismo instante del evento de Auth.
    session.state.userId = USER_B;
    client.clear();
    const b = listQuery(client, { userId: USER_B, session, repository: repoB, reads });
    await settle();

    heldA.resolve([lunaA]);
    await settle();

    assert.deepEqual(b.observer.getCurrentResult().data, [kiraB]);
    assert.equal(client.getQueryData(petKeys.lists(USER_B)).some((pet) => pet.id === lunaA.id), false);
    assert.deepEqual(await repoA.readList(), { status: 'never_loaded' });
    assert.deepEqual((await repoB.readList()).pets, [kiraB]);
  });

  it('tampoco una escritura que termina después del cambio', async () => {
    const { repository } = device();
    const repoA = repository(USER_A);
    const session = fakeSession(USER_A);
    const deps = { repository: repoA, isOwnerSession: () => session.isCurrentUser(USER_A) };
    const mark = repoA.beginRead();
    session.state.userId = USER_B;
    const pet = makePet();
    assert.deepEqual(await storePetWrite(deps, mark, pet.id, pet), pet);
    assert.equal(await repoA.readPet(pet.id), null);
  });
});

describe('9. sesión `offline`: ninguna petición de datos', () => {
  const KEY = 'sb-test-auth-token';

  async function offlineController() {
    const disk = new Map([[KEY, JSON.stringify(makeSession(USER_A, { expiresAt: 0 }))]]);
    const controller = createAuthSessionController({
      auth: {
        onAuthStateChange(callback) {
          // auth-js sin red y con el token caducado: INITIAL_SESSION sin sesión, pero la conserva.
          queueMicrotask(() => callback('INITIAL_SESSION', null));
          return { data: { subscription: { unsubscribe() {} } } };
        },
        getSession: async () => ({ data: { session: null }, error: { name: 'AuthRetryableFetchError', status: 0 } }),
        signOut: async () => ({ error: null }),
      },
      storage: sessionStorageOn(disk),
      storageKey: KEY,
      canAttemptRecovery: () => false,
    });
    const stop = controller.start();
    await settle();
    assert.equal(controller.getState().status, 'offline');
    return { controller, stop };
  }

  it('la query no se ejecuta (`enabled: canUseServer`), y aunque se forzara, `serverCall` no envía nada', async () => {
    const { controller, stop } = await offlineController();
    const { repository } = device();
    const repo = repository(USER_A);
    const luna = makePet();
    await repo.applyList(repo.beginRead(), [luna]);
    const { reads, calls } = fakeReads(() => [luna]);
    const session = { serverCall: controller.serverCall, isCurrentUser: controller.isCurrentUser };
    const client = mountClient();

    const { observer } = listQuery(client, {
      userId: USER_A,
      session,
      repository: repo,
      reads,
      enabled: controller.getState().status === 'signed_in',
    });
    await settle();
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    await settle();
    assert.equal(observer.getCurrentResult().status, 'pending');
    assert.equal(calls.list, 0);

    await assert.rejects(
      fetchPetListThroughCache({ repository: repo, reads, serverCall: controller.serverCall, isOwnerSession: () => true }),
      SessionUnavailableError
    );
    assert.equal(calls.list, 0);

    // Lo que se muestra: la copia del dispositivo de ese usuario.
    const view = resolvePetListView({
      remote: observer.getCurrentResult(),
      local: { status: 'success', data: await repo.readList(), error: null },
      serverUsable: false,
      isOfflineError: () => true,
    });
    assert.deepEqual(view.state === 'ready' && view.pets, [luna]);
    assert.equal(view.source, 'device');
    stop();
  });
});

describe('10. recuperación de la red (móvil)', () => {
  it('la lista que falló sin red se vuelve a pedir al reconectar, una sola vez, y actualiza la copia', async () => {
    const { repository } = device();
    const repo = repository(USER_A);
    const luna = makePet();
    let online = false;
    const { reads, calls } = fakeReads(() => {
      if (!online) throw networkError();
      return [luna];
    });
    const session = fakeSession(USER_A);
    const client = mountClient('native');
    onlineManager.setOnline(false);

    // Dos pantallas observan la lista (la mascota activa y «Mis mascotas»).
    const first = listQuery(client, { userId: USER_A, session, repository: repo, reads });
    listQuery(client, { userId: USER_A, session, repository: repo, reads });
    await settle(50);
    assert.equal(first.observer.getCurrentResult().status, 'error');
    assert.deepEqual(await repo.readList(), { status: 'never_loaded' });
    const failedCalls = calls.list;

    online = true;
    onlineManager.setOnline(true);
    await settle(50);
    assert.equal(calls.list, failedCalls + 1);
    assert.deepEqual(first.observer.getCurrentResult().data, [luna]);
    assert.deepEqual((await repo.readList()).pets, [luna]);
  });
});
