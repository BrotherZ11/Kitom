import { toDailyLogError } from '@/features/daily-logs/daily-log-errors';
import type { DailyLog, GeneratedSaveDailyLogArgs, SaveDailyLogArgs } from '@/features/daily-logs/types';
import { supabase } from '@/lib/supabase';

/**
 * Acceso a `daily_logs`. Lectura: RLS (`is_pet_member`, incluye viewers). Escritura: solo la RPC
 * `save_daily_log` (nunca insert/upsert directo: el upsert falla por los GRANT por columna).
 */

const DAILY_LOG_COLUMNS =
  'id, pet_id, logged_by, last_edited_by, log_date, energy_level, appetite_level, mood_level, activity_level, sleep_quality, vocalization_level, social_interaction_level, unusual_behavior, unusual_behavior_notes, notes, tags, created_at, updated_at';

/** Registro de una mascota en un día; `null` si no existe (o no hay acceso: RLS no lo distingue). */
export async function fetchDailyLog(petId: string, logDate: string): Promise<DailyLog | null> {
  const { data, error } = await supabase
    .from('daily_logs')
    .select(DAILY_LOG_COLUMNS)
    .eq('pet_id', petId)
    .eq('log_date', logDate)
    .maybeSingle();
  if (error) throw toDailyLogError(error);
  return data;
}

/**
 * Crea o sustituye el registro del día (identidad `pet_id` + `log_date`) y devuelve la fila guardada.
 * `logged_by`, `last_edited_by` y los timestamps los pone la BD.
 */
export async function saveDailyLog(args: SaveDailyLogArgs): Promise<DailyLog> {
  // Los tipos generados no admiten NULL en los parámetros de la RPC, aunque `save_daily_log` sí
  // (ver `SaveDailyLogArgs`): conversión explícita solo en este punto.
  const { data, error } = await supabase.rpc('save_daily_log', args as GeneratedSaveDailyLogArgs);
  if (error) throw toDailyLogError(error);
  return data;
}
