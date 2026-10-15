import type { AsyncStorageStatic } from '@react-native-async-storage/async-storage';

import type { KeyValueStorage } from '@/lib/local-store/local-store';

/**
 * Adaptador de `LocalStore` sobre AsyncStorage. Recibe la instancia por parámetro (solo imports de
 * tipos): se prueba con `npm test`. La instancia real está en `device-storage.ts`.
 *
 * Límites del proveedor: sin cifrado en reposo (Android: SQLite de la app; iOS: archivos de la app;
 * web: `localStorage`, legible por cualquier script del mismo origen y borrable por el usuario o el
 * navegador). Tamaño: Android ~6 MB en total y ~2 MB por valor; web ~5 MB por origen. Por eso una
 * clave por elemento y nunca tokens ni credenciales.
 */
export function createAsyncStorageAdapter(
  asyncStorage: Pick<AsyncStorageStatic, 'getItem' | 'setItem' | 'removeItem' | 'getAllKeys'>
): KeyValueStorage {
  return {
    getItem: (key) => asyncStorage.getItem(key),
    setItem: (key, value) => asyncStorage.setItem(key, value),
    removeItem: (key) => asyncStorage.removeItem(key),
    getAllKeys: () => asyncStorage.getAllKeys(),
  };
}
