import type { KeyValueStorage, LocalCollection } from '@/lib/local-store/local-store';

import { LOCAL_STORE_KEY_VERSION, LOCAL_STORE_NAMESPACE, createLocalStore } from './local-store.ts';

/**
 * Comprobación de un almacenamiento real (`deviceStorage`) a través de `LocalStore`: escribe, lee,
 * lista, sobrescribe y borra datos de prueba bajo usuarios reservados (`self-check-*`, que no
 * coinciden con ningún UUID de usuario) y lo limpia todo al acabar. Módulo puro: recibe el
 * almacenamiento por parámetro, así que sirve igual en un test, en el navegador o en un dispositivo.
 *
 * No es parte de la app: se ejecuta a mano desde un build de desarrollo. El resultado solo lleva
 * nombres de pasos, nunca contenido.
 *
 * Fases: `all` lo hace todo en una ejecución. Para comprobar que los datos sobreviven a un reinicio
 * de la app: `write` (deja los datos), reiniciar, y `verify` (los lee y limpia).
 */

export type LocalStoreCheckPhase = 'all' | 'write' | 'verify';

export type LocalStoreCheckResult = {
  ok: boolean;
  phase: LocalStoreCheckPhase;
  /** Pasos ejecutados, en orden, con su resultado. */
  steps: { name: string; ok: boolean }[];
};

type Probe = { owner: string; text: string; version: string };

const USER_A = 'self-check-a';
const USER_B = 'self-check-b';

const probes: LocalCollection<Probe> = {
  name: 'probe',
  version: 1,
  parse: (data) => {
    const value = data as Partial<Probe> | null;
    return value && typeof value.owner === 'string' && typeof value.text === 'string' && typeof value.version === 'string'
      ? { owner: value.owner, text: value.text, version: value.version }
      : null;
  },
  matchesKey: (value, key) => value.owner === key.userId,
};

/** Texto con acentos, emoji y saltos de línea, del tamaño de una nota larga. */
const LONG_TEXT = `ñandú 🐾 «notas»\n${'á'.repeat(2000)}`;
/** Como un `updated_at` de PostgREST: debe volver carácter a carácter. */
const VERSION = '2026-10-13T09:14:26.89152+00:00';

const first: Probe = { owner: USER_A, text: LONG_TEXT, version: VERSION };
const second: Probe = { owner: USER_A, text: 'segundo', version: VERSION };

const same = (a: Probe, b: Probe) => a.owner === b.owner && a.text === b.text && a.version === b.version;

export async function checkLocalStore(
  storage: KeyValueStorage,
  phase: LocalStoreCheckPhase = 'all'
): Promise<LocalStoreCheckResult> {
  const steps: LocalStoreCheckResult['steps'] = [];
  const step = async (name: string, run: () => Promise<boolean>) => {
    let ok = false;
    try {
      ok = await run();
    } catch {
      // Un fallo del almacenamiento es un paso fallido, no una excepción.
    }
    steps.push({ name, ok });
  };

  const storeA = createLocalStore(storage, USER_A);
  const storeB = createLocalStore(storage, USER_B);
  const clean = async () => {
    for (const store of [storeA, storeB]) {
      for (const id of await store.list(probes)) await store.remove(probes, id);
    }
    return (await storeA.list(probes)).length === 0 && (await storeB.list(probes)).length === 0;
  };
  const found = async (store: typeof storeA, id: string[], expected: Probe) => {
    const read = await store.read(probes, id);
    return read.status === 'found' && same(read.value, expected);
  };

  if (phase !== 'verify') {
    await step('clean_before', clean);
    await step('write', async () => {
      await storeA.write(probes, ['one', '2026-10-13'], first);
      await storeA.write(probes, ['two', '2026-10-13'], second);
      return true;
    });
  }

  await step('read_exact', async () =>
    (await found(storeA, ['one', '2026-10-13'], first)) && (await found(storeA, ['two', '2026-10-13'], second))
  );
  await step('list', async () => {
    const ids = await storeA.list(probes);
    return ids.length === 2 && ids[0].join('/') === 'one/2026-10-13' && ids[1].join('/') === 'two/2026-10-13';
  });
  // Otra instancia del almacén sobre el mismo almacenamiento ve lo mismo.
  await step('read_from_new_store', () => found(createLocalStore(storage, USER_A), ['one', '2026-10-13'], first));
  await step('user_isolation', async () => {
    const read = await storeB.read(probes, ['one', '2026-10-13']);
    return read.status === 'missing' && (await storeB.list(probes)).length === 0;
  });

  if (phase !== 'write') {
    await step('overwrite_one_key', async () => {
      await storeA.write(probes, ['two', '2026-10-13'], { ...second, text: 'editado' });
      return (
        (await found(storeA, ['two', '2026-10-13'], { ...second, text: 'editado' })) &&
        (await found(storeA, ['one', '2026-10-13'], first))
      );
    });
    await step('corrupt_is_reported', async () => {
      const key = [LOCAL_STORE_NAMESPACE, `v${LOCAL_STORE_KEY_VERSION}`, USER_A, probes.name, 'broken'].join(':');
      await storage.setItem(key, '{"v":1,"data":');
      const read = await storeA.read(probes, ['broken']);
      return read.status === 'corrupt' && read.reason === 'invalid_json';
    });
    await step('remove', async () => {
      await storeA.remove(probes, ['one', '2026-10-13']);
      return (await storeA.read(probes, ['one', '2026-10-13'])).status === 'missing';
    });
    await step('clean_after', clean);
  }

  return { ok: steps.every((item) => item.ok), phase, steps };
}
