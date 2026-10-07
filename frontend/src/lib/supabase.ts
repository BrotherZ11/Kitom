import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import { secureSessionStorage } from '@/lib/secure-session-storage';
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

/** Cliente único de Supabase para toda la app. */
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: secureSessionStorage,
    persistSession: !isServer,
    autoRefreshToken: !isServer,
    // PKCE: los enlaces de email y el retorno de OAuth traen un `code` de un solo uso, inútil sin
    // el verifier guardado en este dispositivo (no viajan tokens en la URL).
    flowType: 'pkce',
    // Los deep links de Auth se procesan explícitamente en la ruta /auth-callback.
    detectSessionInUrl: false,
  },
});

// En móvil el refresco automático del token solo debe correr con la app en primer plano.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
