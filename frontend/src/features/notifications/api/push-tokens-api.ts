import { supabase } from '@/lib/supabase';

/**
 * Tokens de push del dispositivo (`push_tokens`). Registrar siempre con `register_push_token`: si el token
 * era de otra cuenta (otra sesión en este móvil), la RPC lo pasa a la actual; un `insert` lo impediría la
 * política `manage own` (`docs/FRONTEND_ARCHITECTURE.md` «Push tokens»).
 */
export async function registerPushToken(token: string, platform: 'ios' | 'android', appVersion: string | null): Promise<void> {
  const { error } = await supabase.rpc('register_push_token', {
    p_token: token,
    p_platform: platform,
    p_app_version: appVersion ?? undefined,
  });
  if (error) throw error;
}

/** Al cerrar sesión: el móvil deja de recibir los push de esta cuenta (la política solo deja borrar los propios). */
export async function unregisterPushToken(token: string): Promise<void> {
  const { error } = await supabase.from('push_tokens').delete().eq('token', token);
  if (error) throw error;
}

/**
 * Pide a `invitation-notify` que avise (email + push) de las invitaciones recién creadas por el usuario.
 * La respuesta es la misma haya avisos o no: no dice si el email invitado tiene cuenta.
 */
export async function requestInvitationNotices(): Promise<void> {
  const { error } = await supabase.functions.invoke('invitation-notify', { body: {} });
  if (error) throw error;
}
