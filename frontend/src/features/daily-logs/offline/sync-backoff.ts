/**
 * Espera entre reintentos de sincronización: exponencial con tope y jitter. Módulo puro, sin
 * imports; el reloj (`now`, ms desde epoch del dispositivo) y el azar (`random`) se inyectan.
 *
 * Los valores (base, tope y límite de intentos) son provisionales: no hay todavía datos de uso que
 * los respalden. Hay que validarlos al construir el motor de sincronización (fase 2).
 */

export const SYNC_BACKOFF_BASE_MS = 2_000;
export const SYNC_BACKOFF_MAX_MS = 5 * 60_000;
/**
 * Fallos con respuesta del servidor (no de red) tras los que una operación deja de reintentarse
 * sola. Agotarlos no la borra: queda `failed`, con su contenido, hasta que el usuario decida.
 */
export const MAX_SYNC_ATTEMPTS = 8;

export type BackoffOptions = {
  baseMs?: number;
  maxMs?: number;
  /** Número en [0, 1). Por defecto `Math.random`. */
  random?: () => number;
};

/**
 * Espera tras el fallo número `attempt` (1 = primer fallo): la mitad del tope exponencial es fija
 * y la otra mitad aleatoria, para que varios dispositivos no reintenten a la vez y siempre haya una
 * espera mínima.
 */
export function backoffDelayMs(
  attempt: number,
  { baseMs = SYNC_BACKOFF_BASE_MS, maxMs = SYNC_BACKOFF_MAX_MS, random = Math.random }: BackoffOptions = {}
): number {
  const failures = Number.isFinite(attempt) ? Math.max(1, Math.floor(attempt)) : 1;
  const ceiling = Math.min(maxMs, baseMs * 2 ** Math.min(failures - 1, 30));
  const value = random();
  // Un azar no válido no puede dejar la espera sin definir: se toma la más larga.
  const jitter = Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 1;
  return Math.round(ceiling / 2 + (ceiling / 2) * jitter);
}

/** Momento (ms desde epoch) del siguiente intento tras el fallo número `attempt`. */
export function nextAttemptAt(attempt: number, now: number, options?: BackoffOptions): number {
  return now + backoffDelayMs(attempt, options);
}

/**
 * ¿Toca ya reintentar? `null` = cuanto antes. Si la espera pendiente supera el máximo posible, el
 * reloj del dispositivo ha cambiado (se atrasó): no se deja la operación bloqueada.
 */
export function isAttemptDue(
  scheduledAt: number | null,
  now: number,
  maxMs: number = SYNC_BACKOFF_MAX_MS
): boolean {
  if (scheduledAt === null) return true;
  return now >= scheduledAt || scheduledAt - now > maxMs;
}
