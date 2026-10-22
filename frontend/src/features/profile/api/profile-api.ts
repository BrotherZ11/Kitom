import { supabase } from '@/lib/supabase';
import type { Tables, TablesUpdate } from '@/types/database.types';

/**
 * Acceso a `profiles` (solo el perfil propio: RLS `id = auth.uid()`), `notification_preferences`
 * (política `manage own`) y el plan de `subscriptions` (solo lectura: lo escribe el backend).
 * Las escrituras envían únicamente las columnas con GRANT de UPDATE (migración base).
 */

export type Profile = Pick<
  Tables<'profiles'>,
  | 'full_name'
  | 'locale'
  | 'timezone'
  | 'disclaimer_accepted_at'
  | 'disclaimer_version'
  | 'onboarding_completed_at'
  | 'marketing_opt_in'
>;

const PROFILE_COLUMNS =
  'full_name, locale, timezone, disclaimer_accepted_at, disclaimer_version, onboarding_completed_at, marketing_opt_in';

/** Columnas del perfil que cambia la app (todas con GRANT UPDATE para `authenticated`). */
export type ProfileUpdate = Pick<
  TablesUpdate<'profiles'>,
  'full_name' | 'timezone' | 'disclaimer_accepted_at' | 'disclaimer_version' | 'marketing_opt_in'
>;

/** Perfil propio; `null` si no existe (el trigger `handle_new_user` lo crea al registrarse). */
export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

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

/** Nombre del perfil (`full_name`; `null` si no lo ha indicado: p. ej. registro con email). */
export async function fetchProfileName(userId: string): Promise<string | null> {
  const { data, error } = await supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle();
  if (error) throw error;
  const name = data?.full_name?.trim();
  return name ? name : null;
}

/** Error de «el perfil no existe» (la actualización no ha tocado ninguna fila). */
export class ProfileMissingError extends Error {
  readonly code = 'PGRST116';

  constructor() {
    super('profile_missing');
    this.name = 'ProfileMissingError';
  }
}

/** Actualiza columnas editables del perfil propio. Falla si no ha cambiado ninguna fila. */
export async function updateProfile(userId: string, patch: ProfileUpdate): Promise<void> {
  const { data, error } = await supabase.from('profiles').update(patch).eq('id', userId).select('id');
  if (error) throw error;
  if (data.length === 0) throw new ProfileMissingError();
}

/**
 * Marca la configuración inicial como terminada. Solo si aún no lo estaba (`is null` en la propia
 * consulta): repetirla es un no-op y nunca mueve la fecha original.
 */
export async function completeProfileOnboarding(userId: string): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ onboarding_completed_at: new Date().toISOString() })
    .eq('id', userId)
    .is('onboarding_completed_at', null);
  if (error) throw error;
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

export type NotificationPreferences = Pick<
  Tables<'notification_preferences'>,
  'daily_reminder_enabled' | 'daily_reminder_time' | 'alert_notifications_enabled' | 'marketing_notifications_enabled'
>;

const PREFERENCE_COLUMNS =
  'daily_reminder_enabled, daily_reminder_time, alert_notifications_enabled, marketing_notifications_enabled';

/** Preferencias de avisos (fila creada por `handle_new_user`); `null` si no existe. */
export async function fetchNotificationPreferences(userId: string): Promise<NotificationPreferences | null> {
  const { data, error } = await supabase
    .from('notification_preferences')
    .select(PREFERENCE_COLUMNS)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Guarda las preferencias de avisos. Si la fila no existiera (cuentas antiguas), la crea con
 * `user_id = auth.uid()` (política `manage own`); si existe, solo cambia lo enviado.
 */
export async function saveNotificationPreferences(
  userId: string,
  patch: Partial<NotificationPreferences>
): Promise<NotificationPreferences> {
  const { data, error } = await supabase
    .from('notification_preferences')
    .update(patch)
    .eq('user_id', userId)
    .select(PREFERENCE_COLUMNS);
  if (error) throw error;
  if (data[0]) return data[0];
  const inserted = await supabase
    .from('notification_preferences')
    .insert({ user_id: userId, ...patch })
    .select(PREFERENCE_COLUMNS)
    .single();
  if (inserted.error) throw inserted.error;
  return inserted.data;
}

export type SubscriptionSummary = Pick<
  Tables<'subscriptions'>,
  'plan' | 'status' | 'current_period_end' | 'cancel_at_period_end'
>;

/** Plan del usuario (`subscriptions`, solo lectura). Lo decide el servidor; la app solo lo muestra. */
export async function fetchSubscription(userId: string): Promise<SubscriptionSummary | null> {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('plan, status, current_period_end, cancel_at_period_end')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}
