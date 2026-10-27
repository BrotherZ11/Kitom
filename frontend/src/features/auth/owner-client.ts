import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { createOwnerAccessToken, ownerTokenOrThrow } from '@/features/auth/owner-session';
import { supabase, supabaseAnonKey, supabaseUrl } from '@/lib/supabase';
import { SessionUnavailableError } from '@/lib/user-token-fetch';
import type { Database } from '@/types/database.types';

/**
 * Cliente de Supabase cuyas peticiones (PostgREST y Storage) van autorizadas **siempre** como
 * `ownerUserId`, con el token de su sesión en el cliente principal, o no salen
 * (`SessionUnavailableError`, que la app trata como «sin conexión»). Para colas de un usuario que no
 * pueden fijar la cabecera petición a petición, como las de Storage (fotos de mascota). Sin Auth propio:
 * con `accessToken`, supabase-js no crea otra instancia de Auth ni guarda sesión.
 */
export function createOwnerScopedClient(ownerUserId: string): SupabaseClient<Database> {
  return createClient<Database>(supabaseUrl, supabaseAnonKey, {
    accessToken: ownerTokenOrThrow(createOwnerAccessToken(supabase.auth, ownerUserId), () => new SessionUnavailableError()),
  });
}
