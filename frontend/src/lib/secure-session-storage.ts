import type { SupportedStorage } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { createChunkedStorage } from '@/lib/chunked-storage';

/**
 * Almacenamiento de la sesión de Supabase.
 *
 * - iOS/Android: Keychain/Keystore vía expo-secure-store, troceado (`chunked-storage.ts`: formato y
 *   comportamiento ante fallos).
 * - Web: localStorage (SecureStore no existe en web). Durante el renderizado estático no hay
 *   `window`, así que no se persiste nada.
 */

const secureStoreOptions: SecureStore.SecureStoreOptions = {
  // Permite refrescar el token con la app en segundo plano y evita restaurar la sesión en otro
  // dispositivo desde una copia de seguridad.
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

const nativeStorage: SupportedStorage = createChunkedStorage({
  getItemAsync: (key) => SecureStore.getItemAsync(key, secureStoreOptions),
  setItemAsync: (key, value) => SecureStore.setItemAsync(key, value, secureStoreOptions),
  deleteItemAsync: (key) => SecureStore.deleteItemAsync(key, secureStoreOptions),
});

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
