import type { KeyValueStorage } from '@/lib/local-store/local-store';

/**
 * Almacenamiento en memoria para pruebas. `entries` hace de disco: dos adaptadores creados sobre el
 * mismo `Map` ven los mismos datos, como AsyncStorage tras reiniciar la app.
 */
export function createMemoryStorage(entries: Map<string, string> = new Map()): KeyValueStorage {
  return {
    async getItem(key) {
      return entries.get(key) ?? null;
    },
    async setItem(key, value) {
      entries.set(key, value);
    },
    async removeItem(key) {
      entries.delete(key);
    },
    async getAllKeys() {
      return [...entries.keys()];
    },
  };
}
