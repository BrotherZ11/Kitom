import AsyncStorage from '@react-native-async-storage/async-storage';

import { createAsyncStorageAdapter } from '@/lib/local-store/async-storage-adapter';

/**
 * Almacenamiento local del dispositivo (AsyncStorage) para `createLocalStore`. Sin cifrar: ver
 * `async-storage-adapter.ts`. Todavía no lo usa ninguna pantalla (fase 1 del modo offline).
 */
export const deviceStorage = createAsyncStorageAdapter(AsyncStorage);
