/**
 * Clasificación genérica de errores de servidor (PostgREST, Postgres, Supabase Auth o la red) para las
 * features que no tienen su propio mapeo (perfil, agenda, logros). Módulo puro: se prueba con
 * `npm test`. Nunca se muestra el error crudo: la UI usa el código.
 */
export type ServerErrorKind = 'network' | 'not_allowed' | 'not_found' | 'invalid' | 'unknown';

type ErrorLike = { code?: unknown; message?: unknown; name?: unknown };

/** Sin conexión, o petición retenida por no haber sesión utilizable (`lib/user-token-fetch.ts`). */
const NETWORK = /network request failed|failed to fetch|fetch failed|load failed|session_unavailable|networkerror/i;

export function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  const { message, name } = (error ?? {}) as ErrorLike;
  if (name === 'SessionUnavailableError') return true;
  return typeof message === 'string' && NETWORK.test(message);
}

export function classifyServerError(error: unknown): ServerErrorKind {
  if (isNetworkError(error)) return 'network';
  const { code } = (error ?? {}) as ErrorLike;
  switch (code) {
    case '42501': // RLS o GRANT por columna
    case 'PGRST301': // JWT no válido
      return 'not_allowed';
    case 'PGRST116': // .single() sin filas
      return 'not_found';
    case '22P02': // valor con formato no válido (p. ej. uuid, enum)
    case '23502': // NOT NULL
    case '23503': // FK
    case '23514': // CHECK
    case 'P0001': // excepción de una función o trigger
      return 'invalid';
    default:
      return 'unknown';
  }
}
