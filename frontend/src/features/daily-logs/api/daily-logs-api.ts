import { toDailyLogError } from '@/features/daily-logs/daily-log-errors';
import {
  DAILY_LOG_COLUMNS,
  queryHistoryPage,
  type DailyLogHistoryPage,
} from '@/features/daily-logs/daily-log-history';
import type { DailyLog } from '@/features/daily-logs/types';
import { supabase } from '@/lib/supabase';

/**
 * Lecturas de `daily_logs` para las pantallas. RLS (`is_pet_member`, incluye viewers). La escritura
 * no está aquí: solo la hace el motor de sincronización (`offline/daily-log-remote.ts`), siempre con
 * `save_daily_log` y con precondición (nunca insert/upsert directo ni la llamada sin precondición).
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
