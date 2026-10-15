/**
 * Almacén local de Kitom: datos de la app guardados en el dispositivo, aislados por usuario y
 * validados al leerlos. Módulo puro (sin imports): se prueba con `npm test` y un almacenamiento en
 * memoria. El proveedor real (AsyncStorage) se conecta con `KeyValueStorage`
 * (`async-storage-adapter.ts`); nada aquí depende de él.
 *
 * Claves: `kitom:v1:<userId>:<colección>:<id>[:<id>…]`, una por elemento: cambiar un elemento no
 * reescribe los demás. Valor: JSON `{ "v": <versión de la colección>, "data": … }`.
 *
 * No es un almacén seguro: AsyncStorage no cifra en reposo y en web es `localStorage`. Aquí no se
 * guardan tokens ni credenciales (la sesión vive en `secure-session-storage.ts`). Este módulo no
 * escribe nada en logs: el contenido puede ser privado (notas).
 */

/** Almacenamiento clave-valor de cadenas que aporta el proveedor. */
export type KeyValueStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
};

export const LOCAL_STORE_NAMESPACE = 'kitom';
/** Versión del formato de las claves y del sobre. Cambiarla deja de ver las claves anteriores. */
export const LOCAL_STORE_KEY_VERSION = 1;

const SEPARATOR = ':';
/** Un segmento de clave no puede contener el separador (UUID y fechas `YYYY-MM-DD` cumplen). */
const SEGMENT = /^[A-Za-z0-9_-]+$/;

/** Identificador de un elemento dentro de su colección: uno o más segmentos. */
export type LocalId = readonly string[];

/** Tipo de dato guardado: nombre (segmento de la clave), versión de sus datos y validador. */
export type LocalCollection<T> = {
  name: string;
  version: number;
  /** Valida lo leído (JSON ya analizado). `null` si no es un valor válido de esta versión. */
  parse(data: unknown): T | null;
  /** Si se define: el valor debe pertenecer a la clave bajo la que estaba guardado. */
  matchesKey?(value: T, key: { userId: string; id: LocalId }): boolean;
};

export type LocalCorruptReason = 'invalid_json' | 'invalid_envelope' | 'invalid_data' | 'key_mismatch';

/**
 * Resultado de una lectura. Los datos que no se pueden usar nunca se devuelven como válidos ni se
 * borran solos: quien lee decide (p. ej. `remove`). `unknown_version`: lo escribió otra versión de
 * la app (posiblemente más nueva); no se interpreta.
 */
export type LocalReadResult<T> =
  | { status: 'found'; value: T }
  | { status: 'missing' }
  | { status: 'corrupt'; reason: LocalCorruptReason }
  | { status: 'unknown_version'; version: number };

export type LocalStoreErrorCode = 'invalid_key' | 'invalid_value' | 'storage_failed';

/** Error de uso (clave o valor no válidos) o del proveedor. Nunca incluye el contenido guardado. */
export class LocalStoreError extends Error {
  readonly code: LocalStoreErrorCode;

  constructor(code: LocalStoreErrorCode, cause?: unknown) {
    super(code, { cause });
    this.name = 'LocalStoreError';
    this.code = code;
  }
}

export type LocalStore = {
  readonly userId: string;
  read<T>(collection: LocalCollection<T>, id: LocalId): Promise<LocalReadResult<T>>;
  /** Guarda un elemento. Lo que no se podría volver a leer no se guarda (`invalid_value`). */
  write<T>(collection: LocalCollection<T>, id: LocalId, value: T): Promise<void>;
  remove(collection: Pick<LocalCollection<unknown>, 'name'>, id: LocalId): Promise<void>;
  /** Ids guardados de una colección (opcionalmente, solo los que empiezan por `idPrefix`). */
  list(collection: Pick<LocalCollection<unknown>, 'name'>, idPrefix?: LocalId): Promise<string[][]>;
};

function assertSegments(segments: readonly unknown[]): void {
  for (const segment of segments) {
    if (typeof segment !== 'string' || !SEGMENT.test(segment)) throw new LocalStoreError('invalid_key');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decode<T>(
  collection: LocalCollection<T>,
  key: { userId: string; id: LocalId },
  raw: string
): LocalReadResult<T> {
  let envelope: unknown;
  try {
    envelope = JSON.parse(raw);
  } catch {
    return { status: 'corrupt', reason: 'invalid_json' };
  }
  if (!isRecord(envelope) || !Number.isInteger(envelope.v) || !('data' in envelope)) {
    return { status: 'corrupt', reason: 'invalid_envelope' };
  }
  const version = envelope.v as number;
  if (version !== collection.version) return { status: 'unknown_version', version };

  const value = collection.parse(envelope.data);
  if (value === null) return { status: 'corrupt', reason: 'invalid_data' };
  if (collection.matchesKey && !collection.matchesKey(value, key)) {
    return { status: 'corrupt', reason: 'key_mismatch' };
  }
  return { status: 'found', value };
}

async function callStorage<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw new LocalStoreError('storage_failed', error);
  }
}

/**
 * Almacén de un usuario. Todas las claves llevan su `userId`: no puede leer, listar ni borrar datos
 * de otra cuenta que haya usado el mismo dispositivo.
 */
export function createLocalStore(storage: KeyValueStorage, userId: string): LocalStore {
  assertSegments([userId]);
  const userPrefix = [LOCAL_STORE_NAMESPACE, `v${LOCAL_STORE_KEY_VERSION}`, userId].join(SEPARATOR);

  const keyOf = (collectionName: string, id: LocalId): string => {
    if (id.length === 0) throw new LocalStoreError('invalid_key');
    assertSegments([collectionName, ...id]);
    return [userPrefix, collectionName, ...id].join(SEPARATOR);
  };

  return {
    userId,

    async read(collection, id) {
      const key = keyOf(collection.name, id);
      const raw = await callStorage(() => storage.getItem(key));
      if (raw === null) return { status: 'missing' };
      return decode(collection, { userId, id }, raw);
    },

    async write(collection, id, value) {
      const key = keyOf(collection.name, id);
      let raw: string;
      try {
        raw = JSON.stringify({ v: collection.version, data: value });
      } catch (error) {
        throw new LocalStoreError('invalid_value', error);
      }
      if (decode(collection, { userId, id }, raw).status !== 'found') {
        throw new LocalStoreError('invalid_value');
      }
      await callStorage(() => storage.setItem(key, raw));
    },

    async remove(collection, id) {
      const key = keyOf(collection.name, id);
      await callStorage(() => storage.removeItem(key));
    },

    async list(collection, idPrefix = []) {
      assertSegments([collection.name, ...idPrefix]);
      // Termina en separador: el usuario `abc` no ve las claves de `abcd`.
      const prefix = [userPrefix, collection.name, ...idPrefix, ''].join(SEPARATOR);
      const keys = await callStorage(() => storage.getAllKeys());
      return keys
        .filter((key) => key.startsWith(prefix))
        .map((key) => [...idPrefix, ...key.slice(prefix.length).split(SEPARATOR)])
        .filter((id) => id.every((segment) => SEGMENT.test(segment)))
        .sort((a, b) => (a.join(SEPARATOR) < b.join(SEPARATOR) ? -1 : 1));
    },
  };
}
