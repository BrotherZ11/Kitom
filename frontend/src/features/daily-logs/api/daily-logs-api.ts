import { toDailyLogError } from '@/features/daily-logs/daily-log-errors';
import {
  DAILY_LOG_COLUMNS,
  queryHistoryPage,
  type DailyLogHistoryPage,
} from '@/features/daily-logs/daily-log-history';
import type { DailyLog, GeneratedSaveDailyLogArgs, SaveDailyLogArgs } from '@/features/daily-logs/types';
import { supabase } from '@/lib/supabase';

/**
 * Acceso a `daily_logs`. Lectura: RLS (`is_pet_member`, incluye viewers). Escritura: solo la RPC
 * `save_daily_log` (nunca insert/upsert directo: el upsert falla por los GRANT por columna).
 */

/** Página del historial de una mascota (`log_date` descendente, desde `cursor` exclusivo). */
export async function fetchDailyLogHistory(
  petId: string,
  cursor: string | null
): Promise<DailyLogHistoryPage> {
  try {
    return await queryHistoryPage(supabase, petId, cursor);
  } catch (error) {
    throw toDailyLogError(error);
  }
}

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
