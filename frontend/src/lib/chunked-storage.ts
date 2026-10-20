/**
 * Valor guardado en trozos sobre un almacén clave-valor asíncrono (SecureStore en iOS/Android: algunas
 * versiones de iOS rechazan valores de más de ~2048 bytes y una sesión de Supabase suele superarlos).
 * Módulo puro: el almacén se inyecta (`secure-session-storage.ts`; en las pruebas, uno falso).
 *
 * Formato: `<key>.count` + `<key>.0..n`. Escritura: primero los trozos, después el recuento y al final
 * se borran los trozos sobrantes. Lectura: un trozo perdido invalida el valor (`null`).
 *
 * Fallos (se propagan; nunca se borra nada para «arreglarlos»):
 * - Leer falla: lanza. supabase-js no toca la sesión y la app no identifica a nadie
 *   (`features/auth/persisted-session.ts`: `unreadable`).
 * - Escribir falla a medias: puede quedar un valor mezclado (trozos nuevos con el recuento anterior).
 *   Lo que se lee entonces no es JSON válido, o no es una sesión coherente: la identidad se comprueba
 *   siempre con el `sub` del token (`auth-state.ts`, `persisted-session.ts`), así que un valor mezclado
 *   de dos cuentas nunca identifica a ninguna.
 */

export type AsyncKeyValueStore = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
};

export type ChunkedStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

/** Caracteres por trozo; margen holgado respecto al límite de bytes aunque haya texto no ASCII. */
export const CHUNK_SIZE = 1024;

const countKey = (key: string) => `${key}.count`;
const chunkKey = (key: string, index: number) => `${key}.${index}`;

export function createChunkedStorage(store: AsyncKeyValueStore, chunkSize = CHUNK_SIZE): ChunkedStorage {
  const readChunkCount = async (key: string): Promise<number> => {
    const raw = await store.getItemAsync(countKey(key));
    const count = raw === null ? 0 : Number.parseInt(raw, 10);
    return Number.isNaN(count) ? 0 : count;
  };

  const deleteChunks = async (key: string, from: number, to: number): Promise<void> => {
    const deletions: Promise<void>[] = [];
    for (let index = from; index < to; index++) deletions.push(store.deleteItemAsync(chunkKey(key, index)));
    await Promise.all(deletions);
  };

  return {
    async getItem(key) {
      const count = await readChunkCount(key);
      if (count === 0) return null;
      const chunks = await Promise.all(
        Array.from({ length: count }, (_, index) => store.getItemAsync(chunkKey(key, index)))
      );
      // Un trozo perdido invalida el valor completo: mejor sin sesión que con una corrupta.
      if (chunks.some((chunk) => chunk === null)) return null;
      return chunks.join('');
    },

    async setItem(key, value) {
      const previousCount = await readChunkCount(key);
      const chunks: string[] = [];
      for (let offset = 0; offset < value.length; offset += chunkSize) {
        chunks.push(value.slice(offset, offset + chunkSize));
      }
      await Promise.all(chunks.map((chunk, index) => store.setItemAsync(chunkKey(key, index), chunk)));
      await store.setItemAsync(countKey(key), String(chunks.length));
      await deleteChunks(key, chunks.length, previousCount);
    },

    async removeItem(key) {
      const count = await readChunkCount(key);
      await store.deleteItemAsync(countKey(key));
      await deleteChunks(key, 0, count);
    },
  };
}
