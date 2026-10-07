import type { SupportedStorage } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Almacenamiento de la sesión de Supabase.
 *
 * - iOS/Android: Keychain/Keystore vía expo-secure-store. Algunas versiones de iOS rechazan valores
 *   de más de ~2048 bytes y una sesión (JWT + refresh token + usuario) suele superarlos, así que el
 *   valor se guarda troceado: `<key>.count` + `<key>.0..n`.
 * - Web: localStorage (SecureStore no existe en web). Durante el renderizado estático no hay
 *   `window`, así que no se persiste nada.
 */

// Caracteres por trozo; margen holgado respecto al límite de bytes aunque haya texto no ASCII.
const CHUNK_SIZE = 1024;

const secureStoreOptions: SecureStore.SecureStoreOptions = {
  // Permite refrescar el token con la app en segundo plano y evita restaurar la sesión en otro
  // dispositivo desde una copia de seguridad.
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

const countKey = (key: string) => `${key}.count`;
const chunkKey = (key: string, index: number) => `${key}.${index}`;

async function readChunkCount(key: string): Promise<number> {
  const raw = await SecureStore.getItemAsync(countKey(key), secureStoreOptions);
  const count = raw === null ? 0 : Number.parseInt(raw, 10);
  return Number.isNaN(count) ? 0 : count;
}

async function deleteChunks(key: string, from: number, to: number): Promise<void> {
  const deletions: Promise<void>[] = [];
  for (let index = from; index < to; index++) {
    deletions.push(SecureStore.deleteItemAsync(chunkKey(key, index), secureStoreOptions));
  }
  await Promise.all(deletions);
}

const nativeStorage: SupportedStorage = {
  async getItem(key) {
    const count = await readChunkCount(key);
    if (count === 0) return null;

    const chunks = await Promise.all(
      Array.from({ length: count }, (_, index) =>
        SecureStore.getItemAsync(chunkKey(key, index), secureStoreOptions)
      )
    );
    // Un trozo perdido invalida el valor completo: mejor sin sesión que con una corrupta.
    if (chunks.some((chunk) => chunk === null)) return null;
    return chunks.join('');
  },

  async setItem(key, value) {
    const previousCount = await readChunkCount(key);
    const chunks: string[] = [];
    for (let offset = 0; offset < value.length; offset += CHUNK_SIZE) {
      chunks.push(value.slice(offset, offset + CHUNK_SIZE));
    }

    await Promise.all(
      chunks.map((chunk, index) =>
        SecureStore.setItemAsync(chunkKey(key, index), chunk, secureStoreOptions)
      )
    );
    await SecureStore.setItemAsync(countKey(key), String(chunks.length), secureStoreOptions);
    await deleteChunks(key, chunks.length, previousCount);
  },

  async removeItem(key) {
    const count = await readChunkCount(key);
    await SecureStore.deleteItemAsync(countKey(key), secureStoreOptions);
    await deleteChunks(key, 0, count);
  },
};

const isBrowser = typeof window !== 'undefined';

const webStorage: SupportedStorage = {
  async getItem(key) {
    return isBrowser ? window.localStorage.getItem(key) : null;
  },
  async setItem(key, value) {
    if (isBrowser) window.localStorage.setItem(key, value);
  },
  async removeItem(key) {
    if (isBrowser) window.localStorage.removeItem(key);
  },
};

export const secureSessionStorage: SupportedStorage =
  Platform.OS === 'web' ? webStorage : nativeStorage;
