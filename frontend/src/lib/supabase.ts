import { createClient } from '@supabase/supabase-js';
import { onlineManager } from '@tanstack/react-query';
import { AppState, Platform } from 'react-native';

import { createAuthRefreshFetch } from '@/lib/auth-refresh-fetch';
import { createAutoRefreshGate } from '@/lib/auto-refresh-gate';
import { secureSessionStorage } from '@/lib/secure-session-storage';
import { createUserTokenFetch } from '@/lib/user-token-fetch';
import type { Database } from '@/types/database.types';

// Solo claves públicas (EXPO_PUBLIC_*): se incrustan en el bundle. La protección real de los datos
// es RLS. Nunca usar aquí la service_role key ni ningún secreto de servidor.
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Faltan EXPO_PUBLIC_SUPABASE_URL o EXPO_PUBLIC_SUPABASE_ANON_KEY. ' +
      'Copia frontend/.env.example a frontend/.env y rellénalo.'
  );
}

// Renderizado estático web (Node): no hay sesión que persistir ni refrescar.
const isServer = Platform.OS === 'web' && typeof window === 'undefined';

/**
 * Clave de la sesión en `secureSessionStorage`. Es la que supabase-js usa por defecto
 * (`sb-<subdominio>-auth-token`), fijada aquí para poder leer la sesión guardada sin red
 * (`features/auth/persisted-session.ts`). Cambiarla cerraría la sesión de todos los usuarios.
 */
export const AUTH_STORAGE_KEY = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;

/** Cliente único de Supabase para toda la app. */
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  global: {
    // Ninguna petición de datos sale sin el token de un usuario (`user-token-fetch.ts`) y una respuesta
    // que no es del servidor de Auth nunca cierra la sesión (`auth-refresh-fetch.ts`).
    fetch: createUserTokenFetch({
      fetch: createAuthRefreshFetch({ fetch: (input, init) => fetch(input, init), supabaseUrl }),
      supabaseUrl,
      anonKey: supabaseAnonKey,
    }),
  },
  auth: {
    storage: secureSessionStorage,
    storageKey: AUTH_STORAGE_KEY,
    persistSession: !isServer,
    autoRefreshToken: !isServer,
    // PKCE: los enlaces de email y el retorno de OAuth traen un `code` de un solo uso, inútil sin
    // el verifier guardado en este dispositivo (no viajan tokens en la URL).
    flowType: 'pkce',
    // Los deep links de Auth se procesan explícitamente en la ruta /auth-callback.
    detectSessionInUrl: false,
  },
});

// En móvil el temporizador de renovación del token solo corre en primer plano y con conexión
// (`auto-refresh-gate.ts`). En web lo gestiona auth-js según la visibilidad de la pestaña.
if (Platform.OS !== 'web') {
  const gate = createAutoRefreshGate({
    start: () => void supabase.auth.startAutoRefresh(),
    stop: () => void supabase.auth.stopAutoRefresh(),
    foreground: AppState.currentState !== 'background',
    online: onlineManager.isOnline(),
  });
  AppState.addEventListener('change', (state) => gate.setForeground(state === 'active'));
  onlineManager.subscribe((online) => gate.setOnline(online));
  // auth-js arranca el temporizador por su cuenta al terminar de inicializarse: después se reaplica.
  void supabase.auth.initialize().then(() => setTimeout(gate.sync, 0));
}
