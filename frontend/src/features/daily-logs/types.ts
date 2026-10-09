import type { Database, Tables } from '@/types/database.types';

export type DailyLog = Tables<'daily_logs'>;

type GeneratedSaveDailyLogArgs = Database['public']['Functions']['save_daily_log']['Args'];

/** Parámetros de `save_daily_log` que la RPC acepta como `NULL` (dato no indicado / sin nota). */
type NullableSaveDailyLogParam =
  | 'p_energy_level'
  | 'p_appetite_level'
  | 'p_mood_level'
  | 'p_activity_level'
  | 'p_sleep_quality'
  | 'p_vocalization_level'
  | 'p_social_interaction_level'
  | 'p_unusual_behavior_notes'
  | 'p_notes';

/**
 * Argumentos reales de `save_daily_log` (migración `20261008150202`). `supabase gen types` marca
 * todos los parámetros de una función como no nulos aunque la RPC acepte `NULL`; aquí se corrige
 * solo para los parámetros que lo admiten. Se convierte al tipo generado en `api/daily-logs-api.ts`.
 */
export type SaveDailyLogArgs = {
  [K in keyof GeneratedSaveDailyLogArgs]: K extends NullableSaveDailyLogParam
    ? GeneratedSaveDailyLogArgs[K] | null
    : GeneratedSaveDailyLogArgs[K];
};

export type { GeneratedSaveDailyLogArgs };
