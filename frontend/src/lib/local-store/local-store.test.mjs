// Pruebas de `local-store.ts` y sus adaptadores con el runner de Node (`npm test`). Ver frontend/CLAUDE.md.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

import { createAsyncStorageAdapter } from './async-storage-adapter.ts';
import { checkLocalStore } from './local-store-check.ts';
import { LocalStoreError, createLocalStore } from './local-store.ts';
import { createMemoryStorage } from './memory-storage.ts';

const USER_A = 'a0000000-0000-4000-8000-000000000001';
const USER_B = 'a0000000-0000-4000-8000-000000000002';
const PET = 'b0000000-0000-4000-8000-000000000001';
const OTHER_PET = 'b0000000-0000-4000-8000-000000000002';

/** Colección de prueba: `{ owner, text }`; `owner` debe ser el usuario de la clave. */
const notes = {
  name: 'notes',
  version: 2,
  parse: (data) =>
    data && typeof data.owner === 'string' && typeof data.text === 'string'
      ? { owner: data.owner, text: data.text }
      : null,
  matchesKey: (value, key) => value.owner === key.userId,
};

const rejects = (promise, code) =>
  assert.rejects(promise, (error) => error instanceof LocalStoreError && error.code === code);

describe('LocalStore: leer, escribir, eliminar y enumerar', () => {
  it('lo escrito se lee; lo que no existe es `missing`', async () => {
    const store = createLocalStore(createMemoryStorage(), USER_A);
    assert.deepEqual(await store.read(notes, [PET, '2026-10-13']), { status: 'missing' });

    await store.write(notes, [PET, '2026-10-13'], { owner: USER_A, text: 'hola' });
    assert.deepEqual(await store.read(notes, [PET, '2026-10-13']), {
      status: 'found',
      value: { owner: USER_A, text: 'hola' },
    });
  });

  it('una clave por elemento, con prefijo versionado y usuario', async () => {
    const disk = new Map();
    const store = createLocalStore(createMemoryStorage(disk), USER_A);
    await store.write(notes, [PET, '2026-10-12'], { owner: USER_A, text: 'ayer' });
    await store.write(notes, [PET, '2026-10-13'], { owner: USER_A, text: 'hoy' });
    assert.deepEqual([...disk.keys()].sort(), [
      `kitom:v1:${USER_A}:notes:${PET}:2026-10-12`,
      `kitom:v1:${USER_A}:notes:${PET}:2026-10-13`,
    ]);

    // Reescribir un elemento no toca el otro.
    const untouched = disk.get(`kitom:v1:${USER_A}:notes:${PET}:2026-10-12`);
    await store.write(notes, [PET, '2026-10-13'], { owner: USER_A, text: 'hoy, editado' });
    assert.equal(disk.get(`kitom:v1:${USER_A}:notes:${PET}:2026-10-12`), untouched);
    assert.equal(disk.size, 2);
  });

  it('eliminar borra solo ese elemento', async () => {
    const store = createLocalStore(createMemoryStorage(), USER_A);
    await store.write(notes, [PET, '2026-10-12'], { owner: USER_A, text: 'ayer' });
    await store.write(notes, [PET, '2026-10-13'], { owner: USER_A, text: 'hoy' });
    await store.remove(notes, [PET, '2026-10-12']);
    assert.equal((await store.read(notes, [PET, '2026-10-12'])).status, 'missing');
    assert.equal((await store.read(notes, [PET, '2026-10-13'])).status, 'found');
    await store.remove(notes, [PET, '2026-10-12']); // borrar lo que no existe no falla
  });

  it('enumera los ids de la colección, completos o por prefijo', async () => {
    const disk = new Map([['otra-app:clave', 'x'], [`kitom:v0:${USER_A}:notes:${PET}:2026-10-01`, 'x']]);
    const store = createLocalStore(createMemoryStorage(disk), USER_A);
    await store.write(notes, [OTHER_PET, '2026-10-13'], { owner: USER_A, text: 'c' });
    await store.write(notes, [PET, '2026-10-13'], { owner: USER_A, text: 'b' });
    await store.write(notes, [PET, '2026-10-12'], { owner: USER_A, text: 'a' });
    await store.write({ ...notes, name: 'drafts' }, [PET], { owner: USER_A, text: 'd' });

    assert.deepEqual(await store.list(notes), [
      [PET, '2026-10-12'],
      [PET, '2026-10-13'],
      [OTHER_PET, '2026-10-13'],
    ]);
    assert.deepEqual(await store.list(notes, [PET]), [[PET, '2026-10-12'], [PET, '2026-10-13']]);
    assert.deepEqual(await store.list({ name: 'empty' }), []);
  });

  it('rechaza claves con caracteres fuera del formato', async () => {
    const storage = createMemoryStorage();
    assert.throws(() => createLocalStore(storage, 'a:b'), LocalStoreError);
    assert.throws(() => createLocalStore(storage, ''), LocalStoreError);
    const store = createLocalStore(storage, USER_A);
    await rejects(store.read(notes, []), 'invalid_key');
    await rejects(store.read(notes, ['a:b']), 'invalid_key');
    await rejects(store.write(notes, [PET, '../x'], { owner: USER_A, text: '' }), 'invalid_key');
    await rejects(store.list({ name: 'no valido' }), 'invalid_key');
  });

  it('no guarda un valor que después no se podría leer', async () => {
    const disk = new Map();
    const store = createLocalStore(createMemoryStorage(disk), USER_A);
    await rejects(store.write(notes, [PET], { owner: USER_A }), 'invalid_value');
    await rejects(store.write(notes, [PET], { owner: USER_B, text: 'de otro' }), 'invalid_value');
    const cyclic = { owner: USER_A, text: 'x' };
    cyclic.self = cyclic;
    await rejects(store.write(notes, [PET], cyclic), 'invalid_value');
    assert.equal(disk.size, 0);
  });

  it('un fallo del proveedor es `storage_failed` y conserva la causa', async () => {
    const failure = new Error('QuotaExceededError');
    const broken = {
      getItem: () => Promise.reject(failure),
      setItem: () => Promise.reject(failure),
      removeItem: () => Promise.reject(failure),
      getAllKeys: () => Promise.reject(failure),
    };
    const store = createLocalStore(broken, USER_A);
    await rejects(store.read(notes, [PET]), 'storage_failed');
    await rejects(store.write(notes, [PET], { owner: USER_A, text: 'x' }), 'storage_failed');
    await rejects(store.remove(notes, [PET]), 'storage_failed');
    await assert.rejects(store.list(notes), (error) => error.cause === failure);
  });
});

describe('LocalStore: aislamiento entre usuarios', () => {
  it('cada usuario solo ve, lista y borra lo suyo en el mismo dispositivo', async () => {
    const disk = new Map();
    const storeA = createLocalStore(createMemoryStorage(disk), USER_A);
    const storeB = createLocalStore(createMemoryStorage(disk), USER_B);
    await storeA.write(notes, [PET, '2026-10-13'], { owner: USER_A, text: 'de A' });

    assert.deepEqual(await storeB.read(notes, [PET, '2026-10-13']), { status: 'missing' });
    assert.deepEqual(await storeB.list(notes), []);

    await storeB.write(notes, [PET, '2026-10-13'], { owner: USER_B, text: 'de B' });
    await storeB.remove(notes, [PET, '2026-10-13']);
    assert.deepEqual(await storeA.read(notes, [PET, '2026-10-13']), {
      status: 'found',
      value: { owner: USER_A, text: 'de A' },
    });
    assert.deepEqual(await storeA.list(notes), [[PET, '2026-10-13']]);
  });

  it('un usuario cuyo id es prefijo de otro no ve sus claves', async () => {
    const disk = new Map();
    await createLocalStore(createMemoryStorage(disk), 'user-10').write(notes, ['x'], { owner: 'user-10', text: '' });
    assert.deepEqual(await createLocalStore(createMemoryStorage(disk), 'user-1').list(notes), []);
  });

  it('un valor copiado bajo la clave de otro usuario no se acepta', async () => {
    const disk = new Map();
    await createLocalStore(createMemoryStorage(disk), USER_A).write(notes, [PET], { owner: USER_A, text: 'de A' });
    disk.set(`kitom:v1:${USER_B}:notes:${PET}`, disk.get(`kitom:v1:${USER_A}:notes:${PET}`));
    assert.deepEqual(await createLocalStore(createMemoryStorage(disk), USER_B).read(notes, [PET]), {
      status: 'corrupt',
      reason: 'key_mismatch',
    });
  });
});

describe('LocalStore: datos corruptos y versiones desconocidas', () => {
  const key = `kitom:v1:${USER_A}:notes:${PET}`;
  const readRaw = (raw) => createLocalStore(createMemoryStorage(new Map([[key, raw]])), USER_A).read(notes, [PET]);

  it('JSON roto, sobre incorrecto o datos no válidos son `corrupt`, nunca un valor', async () => {
    assert.deepEqual(await readRaw('{"v":2,"data":{"owner"'), { status: 'corrupt', reason: 'invalid_json' });
    assert.deepEqual(await readRaw(''), { status: 'corrupt', reason: 'invalid_json' });
    for (const raw of ['null', '[]', '"texto"', '{"data":{}}', '{"v":"2","data":{}}', '{"v":2}']) {
      assert.deepEqual(await readRaw(raw), { status: 'corrupt', reason: 'invalid_envelope' }, raw);
    }
    assert.deepEqual(await readRaw(JSON.stringify({ v: 2, data: { owner: USER_A } })), {
      status: 'corrupt',
      reason: 'invalid_data',
    });
  });

  it('una versión distinta de la colección no se interpreta', async () => {
    const data = { owner: USER_A, text: 'x' };
    assert.deepEqual(await readRaw(JSON.stringify({ v: 3, data })), { status: 'unknown_version', version: 3 });
    assert.deepEqual(await readRaw(JSON.stringify({ v: 1, data })), { status: 'unknown_version', version: 1 });
  });

  it('leer datos inservibles no los borra: lo decide quien lee', async () => {
    const disk = new Map([[key, 'no es json']]);
    const store = createLocalStore(createMemoryStorage(disk), USER_A);
    assert.equal((await store.read(notes, [PET])).status, 'corrupt');
    assert.equal(disk.get(key), 'no es json');
    assert.deepEqual(await store.list(notes), [[PET]]);
    await store.remove(notes, [PET]);
    assert.equal(disk.size, 0);
  });
});

describe('LocalStore: persistencia tras reconstruir el adaptador', () => {
  it('memoria: un adaptador nuevo sobre el mismo disco ve lo guardado', async () => {
    const disk = new Map();
    await createLocalStore(createMemoryStorage(disk), USER_A).write(notes, [PET], { owner: USER_A, text: 'x' });
    const reopened = createLocalStore(createMemoryStorage(disk), USER_A);
    assert.deepEqual(await reopened.read(notes, [PET]), { status: 'found', value: { owner: USER_A, text: 'x' } });
    assert.deepEqual(await reopened.list(notes), [[PET]]);
  });

  // La implementación web de AsyncStorage (la que resuelve Node) sobre un `localStorage` falso:
  // comprueba el adaptador contra la librería instalada, sin dispositivo ni credenciales.
  it('AsyncStorage: lee, lista y borra lo que guardó otra instancia del adaptador', async () => {
    const disk = new Map();
    globalThis.window = {
      localStorage: {
        getItem: (key) => (disk.has(key) ? disk.get(key) : null),
        setItem: (key, value) => void disk.set(key, String(value)),
        removeItem: (key) => void disk.delete(key),
        key: (index) => [...disk.keys()][index] ?? null,
        get length() {
          return disk.size;
        },
      },
    };
    try {
      const AsyncStorage = createRequire(import.meta.url)('@react-native-async-storage/async-storage').default;

      const first = createLocalStore(createAsyncStorageAdapter(AsyncStorage), USER_A);
      await first.write(notes, [PET, '2026-10-13'], { owner: USER_A, text: 'ñandú 🐾' });
      assert.deepEqual([...disk.keys()], [`kitom:v1:${USER_A}:notes:${PET}:2026-10-13`]);

      const second = createLocalStore(createAsyncStorageAdapter(AsyncStorage), USER_A);
      assert.deepEqual(await second.read(notes, [PET, '2026-10-13']), {
        status: 'found',
        value: { owner: USER_A, text: 'ñandú 🐾' },
      });
      assert.deepEqual(await second.list(notes), [[PET, '2026-10-13']]);
      await second.remove(notes, [PET, '2026-10-13']);
      assert.equal(disk.size, 0);
    } finally {
      delete globalThis.window;
    }
  });
});

// `checkLocalStore` es la comprobación que se ejecuta a mano contra el almacenamiento real
// (navegador o dispositivo). Aquí solo se prueba que la comprobación funciona y detecta fallos:
// pasarla en memoria NO equivale a probar AsyncStorage en Android.
describe('checkLocalStore', () => {
  it('pasa sobre un almacenamiento correcto y no deja datos', async () => {
    const disk = new Map([['kitom:v1:a0000000-0000-4000-8000-000000000001:notes:x', 'de un usuario real']]);
    const result = await checkLocalStore(createMemoryStorage(disk));
    assert.deepEqual(result.steps.filter((step) => !step.ok), []);
    assert.equal(result.ok, true);
    assert.deepEqual(result.steps.map((step) => step.name), [
      'clean_before',
      'write',
      'read_exact',
      'list',
      'read_from_new_store',
      'user_isolation',
      'overwrite_one_key',
      'corrupt_is_reported',
      'remove',
      'clean_after',
    ]);
    // Solo toca sus claves de prueba.
    assert.deepEqual([...disk.keys()], ['kitom:v1:a0000000-0000-4000-8000-000000000001:notes:x']);
  });

  it('en dos fases comprueba que los datos sobreviven a un reinicio', async () => {
    const disk = new Map();
    assert.equal((await checkLocalStore(createMemoryStorage(disk), 'write')).ok, true);
    assert.equal(disk.size, 2);
    // "Reinicio": otro adaptador sobre el mismo disco.
    const verified = await checkLocalStore(createMemoryStorage(disk), 'verify');
    assert.equal(verified.ok, true);
    assert.equal(disk.size, 0);
    // Sin la fase de escritura previa (o si el disco se borró), la verificación falla.
    assert.equal((await checkLocalStore(createMemoryStorage(new Map()), 'verify')).ok, false);
  });

  it('detecta un almacenamiento que no guarda, que altera los valores o que no lista', async () => {
    const failing = async (override) => {
      const result = await checkLocalStore({ ...createMemoryStorage(), ...override });
      assert.equal(result.ok, false);
      return result.steps.filter((step) => !step.ok).map((step) => step.name);
    };
    assert.ok((await failing({ setItem: async () => {} })).includes('read_exact'));
    const truncating = createMemoryStorage();
    assert.ok(
      (await failing({ ...truncating, setItem: (key, value) => truncating.setItem(key, value.slice(0, 1024)) })).includes(
        'read_exact'
      )
    );
    assert.ok((await failing({ getAllKeys: async () => [] })).includes('list'));
    assert.ok((await failing({ setItem: () => Promise.reject(new Error('disco lleno')) })).includes('write'));
  });
});
