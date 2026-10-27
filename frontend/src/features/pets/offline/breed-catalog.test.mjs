// Pruebas del catálogo de razas sin conexión (fase 9, `npm test`): copia en el dispositivo
// (`breed-catalog-repository.ts`), query (`breed-catalog-queries.ts`) con el QueryClient real de
// `@tanstack/query-core` montada como en `hooks/use-breeds.ts`, vista (`breed-catalog-view.ts`),
// búsqueda y filtros, y alta/edición sin conexión con una raza del catálogo guardado
// (motor de `pet-sync-engine.ts` con el servidor falso). Discos en memoria que sobreviven a «reiniciar».
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, it } from 'node:test';

import { onlineManager, QueryClient, QueryObserver } from '@tanstack/query-core';

import { localQueryOptions } from '../../daily-logs/offline/daily-log-cache.ts';
import { queryDefaultOptions } from '../../../lib/query-defaults.ts';
import { createLocalStore } from '../../../lib/local-store/local-store.ts';
import { createMemoryStorage } from '../../../lib/local-store/memory-storage.ts';
import { SessionUnavailableError } from '../../../lib/user-token-fetch.ts';
import { searchBreeds } from '../breed-search.ts';
import { hasPetFormErrors, toPetFields, toPetFormValues, validatePetForm, withSpecies } from '../pet-form.ts';
import { breedKeys } from '../query-keys.ts';
import { BreedCatalogError, createBreedCatalogRepository } from './breed-catalog-repository.ts';
import { fetchBreedCatalogThroughCache, shouldRetryBreedCatalog } from './breed-catalog-queries.ts';
import { findBreed, needsLocalBreedCatalog, resolveBreedCatalogView, selectableBreeds } from './breed-catalog-view.ts';
import { createFakePetServer } from './fake-pet-server.mjs';
import { createPetCacheRepository } from './pet-cache-repository.ts';
import { createPetOperationRepository } from './pet-operation-repository.ts';
import { createPetSyncEngine } from './pet-sync-engine.ts';
import { deferred, fakeClock, SPECIES, USER_A, USER_B } from './pet-test-helpers.mjs';

const DOG = SPECIES;
const CAT = '44444444-4444-4444-8444-444444444444';
const ID = {
  bichon: 'b0000000-0000-4000-8000-000000000001',
  shepherd: 'b0000000-0000-4000-8000-000000000002',
  labrador: 'b0000000-0000-4000-8000-000000000003',
  waterDog: 'b0000000-0000-4000-8000-000000000004',
  retired: 'b0000000-0000-4000-8000-000000000005',
  persian: 'b0000000-0000-4000-8000-000000000006',
  siamese: 'b0000000-0000-4000-8000-000000000007',
};

const breed = (id, speciesId, code, name, aliases = [], isActive = true) => ({ id, code, speciesId, isActive, name, aliases });
const sorted = (breeds, locale) => [...breeds].sort((a, b) => a.name.localeCompare(b.name, locale));

/** Catálogo tal como lo devuelve `fetchBreedCatalog` (todas las especies, activas e inactivas). */
const CATALOG = {
  es: sorted(
    [
      breed(ID.bichon, DOG, 'bichon_maltese', 'Bichón maltés', ['Maltés']),
      breed(ID.shepherd, DOG, 'german_shepherd', 'Pastor alemán', ['Alsaciano']),
      breed(ID.labrador, DOG, 'labrador_retriever', 'Labrador retriever'),
      breed(ID.waterDog, DOG, 'spanish_water_dog', 'Perro de agua español', ['Turco andaluz']),
      breed(ID.retired, DOG, 'retired_breed', 'Raza retirada', [], false),
      breed(ID.persian, CAT, 'persian', 'Persa', ['Himalayo']),
      breed(ID.siamese, CAT, 'siamese', 'Siamés'),
    ],
    'es'
  ),
  en: sorted(
    [
      breed(ID.bichon, DOG, 'bichon_maltese', 'Maltese', ['Bichon Maltese']),
      breed(ID.shepherd, DOG, 'german_shepherd', 'German Shepherd Dog', ['Alsatian']),
      breed(ID.labrador, DOG, 'labrador_retriever', 'Labrador Retriever'),
      breed(ID.waterDog, DOG, 'spanish_water_dog', 'Spanish Water Dog'),
      breed(ID.retired, DOG, 'retired_breed', 'Retired breed', [], false),
      breed(ID.persian, CAT, 'persian', 'Persian', ['Himalayan']),
      breed(ID.siamese, CAT, 'siamese', 'Siamese'),
    ],
    'en'
  ),
};

const networkError = () => new TypeError('Network request failed');
const isOfflineError = (error) => error instanceof TypeError || error instanceof SessionUnavailableError;
const settle = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
const catalogKey = (userId, locale) => `kitom:v1:${userId}:breed-catalog:${locale}`;

/** Un dispositivo: disco compartido y una copia del catálogo por usuario sobre él. */
function device(disk = new Map()) {
  const problems = [];
  return {
    disk,
    problems,
    repository(userId, { storage = createMemoryStorage(disk) } = {}) {
      return createBreedCatalogRepository(createLocalStore(storage, userId), {
        now: fakeClock(),
        onProblem: (problem) => problems.push(problem),
      });
    },
  };
}

/** Servidor del catálogo: red que se puede cortar, cuenta peticiones y responde con copias. */
function catalogServer(catalogs = CATALOG) {
  const state = { online: true, fail: null, catalogs, calls: 0 };
  return {
    state,
    fetchCatalog: async (locale) => {
      state.calls += 1;
      if (!state.online) throw networkError();
      if (state.fail) throw state.fail;
      return structuredClone(state.catalogs[locale]);
    },
  };
}

function fakeSession(userId) {
  const state = { userId, usable: true };
  return {
    state,
    isCurrentUser: (id) => state.userId === id,
    serverCall: (call) => (state.usable ? call() : Promise.reject(new SessionUnavailableError())),
  };
}

const deps = ({ repository, fetchCatalog, session, userId = USER_A }) => ({
  repository,
  fetchCatalog,
  serverCall: session.serverCall,
  isOwnerSession: () => session.isCurrentUser(userId),
});

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

/**
 * Las dos queries de `useBreedCatalog` (servidor y copia) y su vista. `net.usable` = sesión utilizable y
 * conexión según el sistema (`serverUsable`); `sync()` vuelve a calcular `enabled` como un render.
 */
function mountCatalog(client, { userId = USER_A, locale = 'es', session, repository, fetchCatalog, net }) {
  const remoteOptions = () => ({
    queryKey: breedKeys.catalog(userId, locale),
    enabled: net.usable,
    queryFn: () =>
      fetchBreedCatalogThroughCache(
        {
          ...deps({ repository, fetchCatalog, session, userId }),
          onStored: () => void client.invalidateQueries({ queryKey: breedKeys.localCatalog(userId, locale) }),
        },
        locale
      ),
    staleTime: Infinity,
    retry: (failureCount, error) => shouldRetryBreedCatalog(failureCount, error, isOfflineError),
    retryDelay: 1,
  });
  const remote = new QueryObserver(client, remoteOptions());
  const localOptions = () => ({
    queryKey: breedKeys.localCatalog(userId, locale),
    enabled: needsLocalBreedCatalog(remote.getCurrentResult(), net.usable),
    queryFn: () => repository.read(locale),
    ...localQueryOptions,
  });
  const local = new QueryObserver(client, localOptions());
  const unsubscribe = [remote.subscribe(() => {}), local.subscribe(() => {})];
  const sync = () => {
    remote.setOptions(remoteOptions());
    local.setOptions(localOptions());
  };
  return {
    remote,
    local,
    sync,
    async settle() {
      for (let i = 0; i < 5; i += 1) {
        sync();
        await settle();
      }
    },
    view: () =>
      resolveBreedCatalogView({
        remote: remote.getCurrentResult(),
        local: local.getCurrentResult(),
        serverUsable: net.usable,
        isOfflineError,
      }),
    unmount: () => unsubscribe.forEach((stop) => stop()),
  };
}

describe('copia del catálogo en el dispositivo', () => {
  it('1. primera descarga con conexión: se guarda el catálogo completo, solo con los campos del catálogo', async () => {
    const dev = device();
    const server = catalogServer();
    const repository = dev.repository(USER_A);
    const shown = await fetchBreedCatalogThroughCache(deps({ repository, fetchCatalog: server.fetchCatalog, session: fakeSession(USER_A) }), 'es');

    assert.deepEqual(shown, CATALOG.es);
    assert.deepEqual([...dev.disk.keys()], [catalogKey(USER_A, 'es')]);
    const stored = JSON.parse(dev.disk.get(catalogKey(USER_A, 'es')));
    assert.equal(stored.v, 1);
    assert.deepEqual(Object.keys(stored.data).sort(), ['breeds', 'locale', 'savedAt']);
    assert.equal(stored.data.locale, 'es');
    assert.deepEqual(stored.data.breeds, CATALOG.es, 'mismos ids de raza y especie, nombres, alias y estado');
    for (const item of stored.data.breeds) {
      assert.deepEqual(Object.keys(item).sort(), ['aliases', 'code', 'id', 'isActive', 'name', 'speciesId']);
    }
    assert.doesNotMatch(dev.disk.get(catalogKey(USER_A, 'es')), /token|https?:|Bearer/i);
    assert.deepEqual(await repository.read('es'), { status: 'loaded', savedAt: stored.data.savedAt, breeds: CATALOG.es });
  });

  it('2. cerrar y volver a abrir la app sin conexión: el catálogo sigue disponible', async () => {
    const dev = device();
    const server = catalogServer();
    await fetchBreedCatalogThroughCache(deps({ repository: dev.repository(USER_A), fetchCatalog: server.fetchCatalog, session: fakeSession(USER_A) }), 'es');

    // «Reinicio»: nada en memoria, mismo disco, sin red.
    server.state.online = false;
    const reopened = dev.repository(USER_A);
    const saved = await reopened.read('es');
    assert.equal(saved.status, 'loaded');
    assert.deepEqual(saved.breeds, CATALOG.es);
    await assert.rejects(
      fetchBreedCatalogThroughCache(deps({ repository: reopened, fetchCatalog: server.fetchCatalog, session: fakeSession(USER_A) }), 'es'),
      TypeError
    );
    assert.deepEqual((await dev.repository(USER_A).read('es')).breeds, CATALOG.es, 'el fallo no toca la copia');
  });

  it('6. traducciones ES/EN: una copia por idioma, cada una con sus nombres y alias', async () => {
    const dev = device();
    const server = catalogServer();
    const repository = dev.repository(USER_A);
    const session = fakeSession(USER_A);
    await fetchBreedCatalogThroughCache(deps({ repository, fetchCatalog: server.fetchCatalog, session }), 'es');
    await fetchBreedCatalogThroughCache(deps({ repository, fetchCatalog: server.fetchCatalog, session }), 'en');

    const reopened = dev.repository(USER_A);
    const es = await reopened.read('es');
    const en = await reopened.read('en');
    assert.equal(findBreed({ state: 'ready', breeds: es.breeds }, ID.shepherd).name, 'Pastor alemán');
    assert.equal(findBreed({ state: 'ready', breeds: en.breeds }, ID.shepherd).name, 'German Shepherd Dog');
    assert.deepEqual(findBreed({ state: 'ready', breeds: en.breeds }, ID.shepherd).aliases, ['Alsatian']);
    assert.deepEqual(en.breeds.map((item) => item.name), CATALOG.en.map((item) => item.name), 'orden alfabético del idioma');
    assert.deepEqual((await reopened.read('fr')).status, 'never_loaded');
  });

  it('8a. si falla la lectura del almacenamiento es un error del dispositivo, nunca «sin catálogo» ni vacío', async () => {
    const storage = createMemoryStorage();
    storage.getItem = async () => {
      throw new Error('disk I/O');
    };
    const repository = device().repository(USER_A, { storage });
    await assert.rejects(repository.read('es'), (error) => error instanceof BreedCatalogError && error.reason === 'storage_failed');

    const view = resolveBreedCatalogView({
      remote: { status: 'pending', data: undefined, error: null },
      local: { status: 'error', data: undefined, error: new BreedCatalogError() },
      serverUsable: false,
      isOfflineError,
    });
    assert.equal(view.state, 'local_error');
  });

  it('8b. si falla la escritura: se muestra lo recibido, se registra el motivo y queda en memoria (nada a medias en disco)', async () => {
    const dev = device();
    const storage = createMemoryStorage(dev.disk);
    storage.setItem = async () => {
      throw new Error('quota');
    };
    const repository = dev.repository(USER_A, { storage });
    const shown = await fetchBreedCatalogThroughCache(deps({ repository, fetchCatalog: catalogServer().fetchCatalog, session: fakeSession(USER_A) }), 'es');
    assert.deepEqual(shown, CATALOG.es);
    assert.deepEqual(dev.problems, ['write_failed']);
    assert.equal((await repository.read('es')).status, 'loaded', 'en este proceso sigue disponible');
    assert.equal(dev.disk.size, 0);
    assert.deepEqual(await dev.repository(USER_A).read('es'), { status: 'never_loaded' }, 'tras reiniciar no se inventa nada');
  });

  it('9. copia corrupta o de otro formato: no válida (se registra solo el motivo) y la sustituye la siguiente respuesta', async () => {
    const cases = [
      ['{no es json', 'invalid_data'],
      [JSON.stringify({ v: 1, data: { locale: 'es', savedAt: 'x', breeds: [{ id: ID.persian, name: 'Persa' }] } }), 'invalid_data'],
      [JSON.stringify({ v: 1, data: { locale: 'es', savedAt: 'x', breeds: [CATALOG.es[0], CATALOG.es[0]] } }), 'invalid_data'],
      [JSON.stringify({ v: 1, data: { locale: 'en', savedAt: 'x', breeds: CATALOG.en } }), 'invalid_data'],
      [JSON.stringify({ v: 2, data: {} }), 'unknown_version'],
    ];
    for (const [raw, reason] of cases) {
      const dev = device(new Map([[catalogKey(USER_A, 'es'), raw]]));
      const repository = dev.repository(USER_A);
      assert.deepEqual(await repository.read('es'), { status: 'invalid', reason });
      assert.deepEqual(dev.problems, [reason]);
      assert.equal(
        resolveBreedCatalogView({
          remote: { status: 'error', data: undefined, error: networkError() },
          local: { status: 'success', data: await repository.read('es'), error: null },
          serverUsable: true,
          isOfflineError,
        }).state,
        'offline_unavailable',
        'una copia no válida no es un catálogo vacío'
      );

      const shown = await fetchBreedCatalogThroughCache(deps({ repository, fetchCatalog: catalogServer().fetchCatalog, session: fakeSession(USER_A) }), 'es');
      assert.deepEqual(shown, CATALOG.es);
      assert.deepEqual((await dev.repository(USER_A).read('es')).breeds, CATALOG.es);
    }
  });

  it('una respuesta con filas que no se podrían volver a leer se muestra, pero no se guarda', async () => {
    const dev = device();
    const repository = dev.repository(USER_A);
    const rows = [...CATALOG.es, { id: 'no-uuid', code: 'x', speciesId: DOG, isActive: true, name: 'X', aliases: [] }];
    assert.deepEqual(await repository.apply(repository.beginRead(), 'es', rows), rows);
    assert.equal(dev.disk.size, 0);
  });

  it('11. una respuesta antigua que llega tarde no sustituye a la más reciente', async () => {
    const dev = device();
    const repository = dev.repository(USER_A);
    const session = fakeSession(USER_A);
    const newer = CATALOG.es.map((item) => (item.id === ID.labrador ? { ...item, name: 'Labrador (nuevo)' } : item));
    const slow = deferred();
    const first = fetchBreedCatalogThroughCache(deps({ repository, fetchCatalog: () => slow.promise, session }), 'es');
    const second = await fetchBreedCatalogThroughCache(deps({ repository, fetchCatalog: async () => structuredClone(newer), session }), 'es');
    assert.deepEqual(second, newer);

    slow.resolve(structuredClone(CATALOG.es));
    assert.deepEqual(await first, newer, 'la respuesta tardía devuelve la más reciente');
    assert.deepEqual((await dev.repository(USER_A).read('es')).breeds, newer, 'y no se escribe');
  });

  it('15. aislamiento: cada cuenta tiene su copia, y una respuesta que termina con otra sesión no se guarda', async () => {
    const dev = device();
    const server = catalogServer();
    await fetchBreedCatalogThroughCache(deps({ repository: dev.repository(USER_A), fetchCatalog: server.fetchCatalog, session: fakeSession(USER_A) }), 'es');
    assert.deepEqual(await dev.repository(USER_B).read('es'), { status: 'never_loaded' }, 'B no ve la copia de A');

    // B pide el catálogo y, antes de que llegue, entra A en el mismo dispositivo.
    const session = fakeSession(USER_B);
    const slow = deferred();
    const pending = fetchBreedCatalogThroughCache(deps({ repository: dev.repository(USER_B), fetchCatalog: () => slow.promise, session, userId: USER_B }), 'es');
    session.state.userId = USER_A;
    slow.resolve(structuredClone(CATALOG.es));
    assert.deepEqual(await pending, CATALOG.es, 'se devuelve a su query (clave de B)');
    assert.deepEqual(await dev.repository(USER_B).read('es'), { status: 'never_loaded' }, 'pero no se guarda');
    assert.deepEqual([...dev.disk.keys()], [catalogKey(USER_A, 'es')]);
  });
});

describe('vista, búsqueda y filtros', () => {
  const ready = (breeds) => ({ state: 'ready', breeds, source: 'device', savedAt: null });

  it('3. búsqueda por nombre y alias sin distinguir mayúsculas ni tildes, sobre el catálogo recuperado tras reiniciar', async () => {
    const dev = device();
    await dev.repository(USER_A).apply(1, 'es', CATALOG.es);
    const { breeds } = await dev.repository(USER_A).read('es');
    const dogs = selectableBreeds(breeds, DOG);

    assert.deepEqual(searchBreeds(dogs, 'BICHON').map((item) => item.id), [ID.bichon]);
    assert.deepEqual(searchBreeds(dogs, 'pastor ALEMAN').map((item) => item.id), [ID.shepherd]);
    assert.deepEqual(searchBreeds(dogs, 'alsaciano').map((item) => item.id), [ID.shepherd], 'por alias');
    assert.deepEqual(searchBreeds(dogs, 'maltes').map((item) => item.id), [ID.bichon], 'nombre o alias con tilde');
    assert.deepEqual(searchBreeds(dogs, 'Turco Andalúz').map((item) => item.id), [ID.waterDog]);
    assert.deepEqual(searchBreeds(dogs, 'zzz'), []);
  });

  it('4. cada especie solo ofrece sus razas', () => {
    assert.deepEqual(selectableBreeds(CATALOG.es, CAT).map((item) => item.id), [ID.persian, ID.siamese]);
    assert.ok(selectableBreeds(CATALOG.es, DOG).every((item) => item.speciesId === DOG));
    assert.deepEqual(searchBreeds(selectableBreeds(CATALOG.es, DOG), 'persa'), [], 'un gato no aparece buscando en perros');
    assert.deepEqual(selectableBreeds(CATALOG.es, randomUUID()), []);
  });

  it('5. las razas inactivas no se ofrecen, pero se siguen encontrando por id (la raza guardada de una mascota)', () => {
    const dogs = selectableBreeds(CATALOG.es, DOG);
    assert.equal(dogs.some((item) => item.id === ID.retired), false);
    assert.deepEqual(searchBreeds(dogs, 'retirada'), []);
    assert.equal(findBreed(ready(CATALOG.es), ID.retired).name, 'Raza retirada');
    assert.equal(findBreed(ready(CATALOG.es), randomUUID()), undefined);
    assert.equal(findBreed({ state: 'offline_unavailable' }, ID.retired), undefined);
  });

  it('7. sin conexión y sin copia: «no disponible», nunca un catálogo vacío', () => {
    const view = resolveBreedCatalogView({
      remote: { status: 'pending', data: undefined, error: null },
      local: { status: 'success', data: { status: 'never_loaded' }, error: null },
      serverUsable: false,
      isOfflineError,
    });
    assert.deepEqual(view, { state: 'offline_unavailable' });
  });

  it('vacío confirmado por el servidor ≠ no disponible; error del servidor sin copia = error', () => {
    const confirmedEmpty = resolveBreedCatalogView({
      remote: { status: 'success', data: [], error: null },
      local: { status: 'pending', data: undefined, error: null },
      serverUsable: true,
      isOfflineError,
    });
    assert.deepEqual(confirmedEmpty, { state: 'ready', breeds: [], source: 'server', savedAt: null });

    const serverError = new Error('500');
    const noCopy = resolveBreedCatalogView({
      remote: { status: 'error', data: undefined, error: serverError },
      local: { status: 'success', data: { status: 'never_loaded' }, error: null },
      serverUsable: true,
      isOfflineError,
    });
    assert.deepEqual(noCopy, { state: 'error', error: serverError });

    const loading = resolveBreedCatalogView({
      remote: { status: 'pending', data: undefined, error: null },
      local: { status: 'success', data: { status: 'loaded', savedAt: 'x', breeds: CATALOG.es }, error: null },
      serverUsable: true,
      isOfflineError,
    });
    assert.deepEqual(loading, { state: 'loading' }, 'con conexión se espera al servidor, no se enseña la copia');
  });
});

describe('query del catálogo (como useBreedCatalog)', () => {
  it('sin conexión no se pide nada al servidor; un fallo de red no se reintenta', async () => {
    const client = mountClient();
    const dev = device();
    const server = catalogServer();
    const net = { usable: false };
    const query = mountCatalog(client, { session: fakeSession(USER_A), repository: dev.repository(USER_A), fetchCatalog: server.fetchCatalog, net });
    await query.settle();
    assert.equal(server.state.calls, 0);
    assert.deepEqual(query.view(), { state: 'offline_unavailable' });

    // El sistema dice que hay red, pero no la hay: una sola petición.
    server.state.online = false;
    net.usable = true;
    await query.settle();
    assert.equal(server.state.calls, 1);
    assert.deepEqual(query.view(), { state: 'offline_unavailable' });
    query.unmount();
  });

  it('10. un fallo remoto (red o servidor) no borra una copia válida: se sigue mostrando', async () => {
    const dev = device();
    await dev.repository(USER_A).apply(1, 'es', CATALOG.es);

    for (const failure of [networkError(), Object.assign(new Error('Internal'), { code: 'PGRST000' })]) {
      const client = mountClient();
      const server = catalogServer();
      server.state.fail = failure;
      const query = mountCatalog(client, { session: fakeSession(USER_A), repository: dev.repository(USER_A), fetchCatalog: server.fetchCatalog, net: { usable: true } });
      await query.settle();
      const view = query.view();
      assert.equal(view.state, 'ready');
      assert.equal(view.source, 'device');
      assert.deepEqual(view.breeds, CATALOG.es);
      assert.deepEqual((await dev.repository(USER_A).read('es')).breeds, CATALOG.es);
      query.unmount();
    }
  });

  it('sesión `offline` (sin comprobar): nada sale y se usa la copia', async () => {
    const client = mountClient();
    const dev = device();
    await dev.repository(USER_A).apply(1, 'es', CATALOG.es);
    const server = catalogServer();
    const session = fakeSession(USER_A);
    session.state.usable = false;
    const query = mountCatalog(client, { session, repository: dev.repository(USER_A), fetchCatalog: server.fetchCatalog, net: { usable: true } });
    await query.settle();
    assert.equal(server.state.calls, 0);
    assert.equal(query.view().source, 'device');
    query.unmount();
  });

  it('12. al volver la conexión se actualiza el catálogo sin perder la raza elegida ni la copia', async () => {
    const client = mountClient();
    const dev = device();
    await dev.repository(USER_A).apply(1, 'es', CATALOG.es);
    const updated = CATALOG.es.map((item) =>
      item.id === ID.labrador ? { ...item, isActive: false } : item.id === ID.persian ? { ...item, aliases: ['Himalayo', 'Exótico'] } : item
    );
    const server = catalogServer({ ...CATALOG, es: updated });
    server.state.online = false;
    const net = { usable: false };

    // Arranque sin conexión: copia del dispositivo; el usuario elige el labrador.
    onlineManager.setOnline(false);
    const query = mountCatalog(client, { session: fakeSession(USER_A), repository: dev.repository(USER_A), fetchCatalog: server.fetchCatalog, net });
    await query.settle();
    assert.equal(query.view().source, 'device');
    const chosen = searchBreeds(selectableBreeds(query.view().breeds, DOG), 'labrador')[0].id;
    assert.equal(chosen, ID.labrador);

    // Vuelve la red: se pide una vez y pasa a ser el catálogo del servidor.
    server.state.online = true;
    net.usable = true;
    onlineManager.setOnline(true);
    await query.settle();
    const view = query.view();
    assert.equal(view.source, 'server');
    assert.equal(server.state.calls, 1);
    assert.deepEqual(findBreed(view, ID.persian).aliases, ['Himalayo', 'Exótico']);
    assert.equal(findBreed(view, chosen).name, 'Labrador retriever', 'la raza elegida sigue teniendo nombre aunque ya no se ofrezca');
    assert.deepEqual((await dev.repository(USER_A).read('es')).breeds, updated, 'la copia se actualiza');

    // Ya cargado, otra caída de red no lo vuelve a pedir ni lo pierde.
    net.usable = false;
    await query.settle();
    assert.equal(query.view().source, 'server');
    assert.equal(server.state.calls, 1);
    query.unmount();
  });
});

describe('alta y edición sin conexión con una raza del catálogo guardado', () => {
  /** Dispositivo con motor de Pets y copia del catálogo sobre el mismo disco. */
  function petDevice({ disk = new Map(), server, online }) {
    const storage = createMemoryStorage(disk);
    const engine = createPetSyncEngine({
      operations: createPetOperationRepository(createLocalStore(storage, USER_A)),
      cache: createPetCacheRepository(createLocalStore(storage, USER_A)),
      remote: server.remoteFor(USER_A),
      isOnline: () => online.value,
      now: Date.now,
      createOperationId: randomUUID,
      random: () => 0,
    });
    engine.start();
    engine.setSessionUserId(USER_A);
    return { engine, catalog: createBreedCatalogRepository(createLocalStore(storage, USER_A)) };
  }

  /** El formulario con una raza elegida del catálogo, validado como `PetForm`. */
  function fieldsWithBreed(values, catalog, query, speciesId) {
    const picked = searchBreeds(selectableBreeds(catalog, speciesId), query)[0];
    const next = { ...values, breedStatus: 'known', breedSource: 'catalog', breedId: picked.id, breedText: '' };
    const errors = validatePetForm(next, { breedSpeciesId: findBreed({ state: 'ready', breeds: catalog }, next.breedId)?.speciesId });
    assert.equal(hasPetFormErrors(errors), false);
    return toPetFields(next);
  }

  it('13. crear sin conexión tras reiniciar, con una raza del catálogo guardado, y sincronizar al volver la red', async () => {
    const server = createFakePetServer({ owner: USER_A });
    const online = { value: true };
    const disk = new Map();
    // Una sesión con conexión guardó el catálogo.
    await petDevice({ disk, server, online }).catalog.apply(1, 'es', CATALOG.es);

    // Reinicio sin conexión: el catálogo sale del dispositivo.
    online.value = false;
    const offline = petDevice({ disk, server, online });
    const saved = await offline.catalog.read('es');
    const values = { ...toPetFormValues(), name: 'Kira', speciesId: DOG };
    const fields = fieldsWithBreed(values, saved.breeds, 'alsaciano', DOG);
    assert.deepEqual([fields.breed_status, fields.breed_id, fields.breed], ['known', ID.shepherd, null]);
    await offline.engine.saveCreate(fields);
    await offline.engine.idle();
    assert.equal(server.calls.length, 0);

    online.value = true;
    await petDevice({ disk, server, online }).engine.requestSync();
    const [pet] = server.pets.values();
    assert.deepEqual([pet.species_id, pet.breed_status, pet.breed_id, pet.breed], [DOG, 'known', ID.shepherd, null]);
  });

  it('13b. editar sin conexión: de mestizo a una raza del catálogo guardado', async () => {
    const server = createFakePetServer({ owner: USER_A });
    const base = server.insertElsewhere({
      ...toPetFields({ ...toPetFormValues(), name: 'Misu', speciesId: CAT, breedStatus: 'mixed' }),
      id: randomUUID(),
      owner_id: USER_A,
    });
    const online = { value: false };
    const disk = new Map();
    const dev = petDevice({ disk, server, online });
    await dev.catalog.apply(1, 'es', CATALOG.es);

    const fields = fieldsWithBreed(toPetFormValues(base), (await petDevice({ disk, server, online }).catalog.read('es')).breeds, 'siames', CAT);
    await dev.engine.saveEdit(base.id, fields, base);
    online.value = true;
    await dev.engine.requestSync();
    assert.deepEqual(
      [server.rowOf(base.id).breed_status, server.rowOf(base.id).breed_id, server.rowOf(base.id).breed],
      ['known', ID.siamese, null]
    );
  });
});

describe('14. coherencia de breed_id, breed y breed_status', () => {
  const base = { ...toPetFormValues(), name: 'Luna', speciesId: DOG };

  it('cada respuesta produce una combinación válida para pets_breed_status_check', () => {
    const fields = (values) => {
      const { breed_status, breed_id, breed } = toPetFields({ ...base, ...values });
      return { breed_status, breed_id, breed };
    };
    assert.deepEqual(fields({ breedStatus: 'known', breedSource: 'catalog', breedId: ID.bichon, breedText: 'resto' }), {
      breed_status: 'known',
      breed_id: ID.bichon,
      breed: null,
    });
    assert.deepEqual(fields({ breedStatus: 'known', breedSource: 'other', breedId: ID.bichon, breedText: ' Ratonero ' }), {
      breed_status: 'known',
      breed_id: null,
      breed: 'Ratonero',
    });
    for (const status of ['mixed', 'unknown', null]) {
      assert.deepEqual(fields({ breedStatus: status, breedId: ID.bichon, breedText: 'x' }), { breed_status: status, breed_id: null, breed: null });
    }
  });

  it('cambiar de especie quita la raza concreta y conserva mestizo/desconocida', () => {
    const known = { ...base, breedStatus: 'known', breedSource: 'catalog', breedId: ID.bichon };
    assert.deepEqual(
      (({ breedStatus, breedSource, breedId, breedText }) => ({ breedStatus, breedSource, breedId, breedText }))(withSpecies(known, CAT)),
      { breedStatus: null, breedSource: 'catalog', breedId: '', breedText: '' }
    );
    assert.equal(withSpecies({ ...base, breedStatus: 'known', breedSource: 'other', breedText: 'X' }, CAT).breedText, '');
    assert.equal(withSpecies({ ...base, breedStatus: 'mixed' }, CAT).breedStatus, 'mixed');
    assert.equal(withSpecies({ ...base, breedStatus: 'unknown' }, CAT).breedStatus, 'unknown');
  });

  it('nunca se envía una raza de otra especie según el catálogo', () => {
    const catPicked = { ...base, breedStatus: 'known', breedSource: 'catalog', breedId: ID.persian };
    assert.equal(validatePetForm(catPicked, { breedSpeciesId: CAT }).breedId, 'breed_species_mismatch');
    assert.equal(validatePetForm(catPicked, { breedSpeciesId: DOG }).breedId, undefined);
    // Sin catálogo (nunca descargado) no se puede comprobar aquí: lo hace la FK del servidor.
    assert.equal(validatePetForm(catPicked).breedId, undefined);
    assert.equal(validatePetForm({ ...catPicked, breedSource: 'other', breedText: 'Persa' }, { breedSpeciesId: CAT }).breedId, undefined);
    assert.equal(validatePetForm({ ...base, breedStatus: 'known', breedSource: 'catalog', breedId: '' }).breedId, 'breed_required');
  });
});
