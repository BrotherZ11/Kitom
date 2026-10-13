import { supabase } from '@/lib/supabase';

/**
 * Acceso a `profiles` (solo el perfil propio: RLS `id = auth.uid()`).
 */

/** Zona horaria guardada en el perfil (`NULL` = sin configurar, o perfil inexistente). */
export async function fetchProfileTimeZone(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('timezone')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data?.timezone ?? null;
}

/**
 * Guarda la zona horaria solo si el perfil todavía no tiene (`timezone is null` en la propia
 * consulta: atómico, sin leer antes y sin pisar un valor existente). Repetirla es un no-op.
 * `true` si la ha guardado; `false` si ya tenía zona o el perfil no existe.
 */
export async function setProfileTimeZoneIfMissing(userId: string, timeZone: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('profiles')
    .update({ timezone: timeZone })
    .eq('id', userId)
    .is('timezone', null)
    .select('id');
  if (error) throw error;
  return data.length > 0;
}
