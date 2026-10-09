/**
 * Errores del registro diario que entiende la UI. Módulo puro (se prueba con `npm test`); el texto
 * visible está en `dailyLogs.errors.<código>` de i18n. Nunca se muestra el error crudo de Supabase.
 */
export type DailyLogErrorCode =
  | 'network'
  | 'not_allowed'
  | 'invalid_date'
  | 'empty'
  | 'notes_too_long'
  | 'invalid_tag'
  | 'invalid_value'
  | 'unknown';

export class DailyLogError extends Error {
  readonly code: DailyLogErrorCode;

  constructor(code: DailyLogErrorCode, cause?: unknown) {
    super(code, { cause });
    this.name = 'DailyLogError';
    this.code = code;
  }
}

type PostgrestLikeError = { code?: string; message?: string; hint?: string | null };

function isNetworkFailure(message: string): boolean {
  return /network request failed|failed to fetch|fetch failed/i.test(message);
}

/** Traduce un error de PostgREST/Postgres (RPC `save_daily_log`, lecturas de `daily_logs`). */
export function toDailyLogError(error: unknown): DailyLogError {
  if (error instanceof DailyLogError) return error;
  if (error instanceof TypeError) return new DailyLogError('network', error);

  const { code = '', message = '', hint = '' } = (error ?? {}) as PostgrestLikeError;
  if (isNetworkFailure(message)) return new DailyLogError('network', error);

  switch (code) {
    case '42501': // RLS, GRANT o la comprobación can_edit_pet de la RPC (viewer, ajeno, sin sesión)
      return new DailyLogError('not_allowed', error);
    case 'P0001':
      // validate_daily_log_date: fecha futura o fuera de la ventana de 7 días.
      if (hint === 'log_date_future' || hint === 'log_date_too_old') {
        return new DailyLogError('invalid_date', error);
      }
      return new DailyLogError('unknown', error);
    case '23514': // CHECK: el nombre de la constraint va en el mensaje
      if (message.includes('daily_logs_not_empty_check')) return new DailyLogError('empty', error);
      if (message.includes('notes_length_check')) return new DailyLogError('notes_too_long', error);
      if (message.includes('daily_logs_tags_check')) return new DailyLogError('invalid_tag', error);
      return new DailyLogError('invalid_value', error);
    case '22P02':
    case '22003':
    case '22007':
    case '22008':
      return new DailyLogError('invalid_value', error);
  }

  return new DailyLogError('unknown', error);
}
