/**
 * Clasificación de los errores al sincronizar un registro diario (`save_daily_log` con
 * precondición). Módulo puro, sin imports. Contrato de códigos: `docs/FRONTEND_ARCHITECTURE.md` §4
 * «DailyLogScreen» y §5.
 *
 * Red y HTTP no se confunden: `network` es solo "no hubo respuesta" (fetch lanzó o se abortó). Si
 * hay código HTTP o de Postgres, el servidor respondió, y se clasifica por lo que dijo.
 */

export type SyncErrorKind =
  | 'network' // sin respuesta
  | 'server' // el servidor respondió con un fallo transitorio (5xx, 429, timeout de la consulta…)
  | 'auth' // sin sesión válida (401, JWT caducado)
  | 'permission' // sin permiso de edición (42501 / 403)
  | 'validation' // el servidor rechaza los datos (fecha, CHECK, tipos)
  | 'conflict' // la precondición no se cumple (`daily_log_conflict`)
  | 'unknown';

/**
 * Qué hacer con la operación:
 * - `retry`: reintentar más tarde con backoff.
 * - `wait_for_auth`: no reintentar hasta tener sesión; no cuenta como intento.
 * - `resolve_conflict`: leer la fila remota y fusionar; nunca reenviar tal cual.
 * - `give_up`: reintentar no lo arregla; necesita al usuario.
 */
export type SyncErrorPolicy = 'retry' | 'wait_for_auth' | 'resolve_conflict' | 'give_up';

export type DailyLogConflictDetail = 'version_mismatch' | 'row_missing' | 'row_exists';

export type SyncErrorInfo = {
  kind: SyncErrorKind;
  policy: SyncErrorPolicy;
  /** Código estable para la UI y el diagnóstico (hint, código de Postgres/PostgREST o HTTP). Nunca el mensaje. */
  reason: string;
  /** Solo con `kind: 'conflict'`; `null` si el servidor no indicó el motivo. */
  conflict: DailyLogConflictDetail | null;
};

const CONFLICT_DETAILS: readonly string[] = ['version_mismatch', 'row_missing', 'row_exists'];
/** Mensajes con los que `fetch` rechaza cuando no llega a haber respuesta (RN, Chrome, Node, Safari, Firefox). */
const NETWORK_MESSAGE = /network request (failed|timed out)|failed to fetch|fetch failed|load failed|networkerror/i;
/** Postgres: conexión (08), transacción abortada (40), recursos (53), cancelación/parada (57), bloqueo. */
const TRANSIENT_PG_CODE = /^(08|40|53|57)|^55P03$/;
/** PostgREST: sin conexión con la base de datos o caché de esquema en construcción. */
const TRANSIENT_POSTGREST_CODE = /^PGRST00[0-3]$/;
/** PostgREST: JWT ausente, no válido o caducado. */
const AUTH_POSTGREST_CODE = /^PGRST30[1-3]$/;

function info(
  kind: SyncErrorKind,
  policy: SyncErrorPolicy,
  reason: string,
  conflict: DailyLogConflictDetail | null = null
): SyncErrorInfo {
  return { kind, policy, reason, conflict };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Clasifica el error de una llamada a `save_daily_log`. `error` es el error original de
 * supabase-js (`{ code, message, hint, details }`) o lo que lanzó `fetch`; un `DailyLogError` se
 * abre para leer su causa. `httpStatus` es el `status` de la respuesta, si la hubo.
 */
export function classifySyncError(error: unknown, httpStatus?: number | null): SyncErrorInfo {
  const source =
    error instanceof Error && error.name === 'DailyLogError' && error.cause != null ? error.cause : error;
  const fields = (typeof source === 'object' && source !== null ? source : {}) as Record<string, unknown>;
  const code = text(fields.code);
  const hint = text(fields.hint);
  const details = text(fields.details);
  const status =
    typeof httpStatus === 'number' && Number.isInteger(httpStatus) && httpStatus >= 100 ? httpStatus : null;

  if (code === 'P0001' && hint === 'daily_log_conflict') {
    const conflict = CONFLICT_DETAILS.includes(details) ? (details as DailyLogConflictDetail) : null;
    return info('conflict', 'resolve_conflict', conflict ?? hint, conflict);
  }

  if (status === null && code === '') {
    // Por el mensaje, no por el tipo: `fetch` rechaza con TypeError, pero un TypeError cualquiera
    // (un fallo de programación) no es un corte de red y no debe reintentarse sin límite.
    const name = text(fields.name);
    const isNetwork =
      name === 'AbortError' || name === 'TimeoutError' || NETWORK_MESSAGE.test(text(fields.message));
    if (isNetwork) return info('network', 'retry', 'network');
  }

  // Sin sesión PostgREST responde 401 (también con 42501: el rol `anon` no puede ejecutar la RPC).
  if (status === 401 || AUTH_POSTGREST_CODE.test(code)) {
    return info('auth', 'wait_for_auth', code || 'http_401');
  }
  if (code === '42501' || status === 403) {
    return info('permission', 'give_up', code || 'http_403');
  }

  if (code === 'P0001' && (hint === 'log_date_future' || hint === 'log_date_too_old')) {
    return info('validation', 'give_up', hint);
  }
  // Datos no válidos (22: tipos y rangos, incluido 22023 = dos precondiciones a la vez) o que
  // violan una restricción (23: CHECKs de `daily_logs`).
  if (/^(22|23)/.test(code)) return info('validation', 'give_up', code);

  if (TRANSIENT_PG_CODE.test(code) || TRANSIENT_POSTGREST_CODE.test(code)) {
    return info('server', 'retry', code);
  }
  if (status !== null && (status >= 500 || status === 408 || status === 429)) {
    return info('server', 'retry', code || `http_${status}`);
  }

  // Cualquier otro 4xx es una respuesta determinista del servidor: repetirla daría lo mismo.
  if (status !== null && status >= 400) return info('unknown', 'give_up', code || `http_${status}`);
  // Sin datos para decidir: se reintenta, con el límite de `MAX_SYNC_ATTEMPTS`.
  return info('unknown', 'retry', code || 'unknown');
}

/** `true` si la operación puede completarse más adelante sin que el usuario cambie nada. */
export function isRecoverableSyncError(error: SyncErrorInfo): boolean {
  return error.policy === 'retry' || error.policy === 'wait_for_auth';
}
