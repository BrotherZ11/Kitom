import { createClient } from '@supabase/supabase-js';

import type { PasswordCheckAuth } from '@/features/auth/change-password';
import { supabaseAnonKey, supabaseUrl } from '@/lib/supabase';

/**
 * Cliente de Auth desechable para comprobar la contraseña actual (`change-password.ts`): sesión solo en
 * memoria (nunca en el dispositivo), sin renovación automática ni lectura de la URL, y con otra clave de
 * almacenamiento (en web, supabase-js avisa si dos clientes comparten la misma). No hace peticiones de
 * datos: solo `/auth/v1/token` y `/auth/v1/logout`.
 */
export function createPasswordCheckClient(): PasswordCheckAuth {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: 'kitom-password-check',
    },
  }).auth;
}
