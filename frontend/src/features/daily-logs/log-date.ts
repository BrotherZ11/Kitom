/**
 * Fecha del registro diario (`daily_logs.log_date`, `YYYY-MM-DD`). Módulo puro, sin imports: se
 * prueba con `npm test`. Única fuente de "hoy" para Daily Logs: las pantallas no calculan fechas.
 *
 * "Hoy" es el día del calendario en la zona horaria del usuario, nunca el día UTC
 * (`toISOString().slice(0, 10)` da el día siguiente en Madrid entre las 00:00 y las 02:00).
 */

export const FALLBACK_TIME_ZONE = 'UTC';

const LOG_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Zona con la que se calcula "hoy": la del perfil; si es `null` o no válida, la del dispositivo;
 * si tampoco, `UTC`. `normalize` valida una zona IANA (`normalizeTimeZone` de `features/profile`).
 */
export function resolveLogTimeZone(
  candidates: { profile: unknown; device: unknown },
  normalize: (value: unknown) => string | null
): string {
  return normalize(candidates.profile) ?? normalize(candidates.device) ?? FALLBACK_TIME_ZONE;
}

/** Día del calendario (`YYYY-MM-DD`) de un instante en una zona IANA. */
export function formatLocalDate(instant: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(instant);
    const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
    const date = `${part('year')}-${part('month')}-${part('day')}`;
    if (LOG_DATE.test(date)) return date;
  } catch {
    // Zona desconocida o Intl no disponible: se usa UTC.
  }
  return formatUtcDate(instant);
}

/** "Hoy" para el registro diario: el día local de `now` en la zona resuelta. */
export function todayLogDate(
  now: Date,
  candidates: { profile: unknown; device: unknown },
  normalize: (value: unknown) => string | null
): string {
  return formatLocalDate(now, resolveLogTimeZone(candidates, normalize));
}

/**
 * Texto visible de una fecha `YYYY-MM-DD` (p. ej. «jueves, 8 de octubre»; con `withYear`, «… de
 * 2026»). Muestra exactamente el día guardado: no depende de la zona horaria actual.
 */
export function formatLogDateLabel(
  logDate: string,
  locale: string,
  { withYear = false }: { withYear?: boolean } = {}
): string {
  const match = LOG_DATE.exec(logDate);
  if (!match) return logDate;
  // Mediodía UTC y zona UTC: el día mostrado es exactamente el de `logDate`.
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: 'UTC',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      ...(withYear ? { year: 'numeric' } : {}),
    }).format(date);
  } catch {
    return logDate;
  }
}

function formatUtcDate(instant: Date): string {
  const month = String(instant.getUTCMonth() + 1).padStart(2, '0');
  const day = String(instant.getUTCDate()).padStart(2, '0');
  return `${instant.getUTCFullYear()}-${month}-${day}`;
}
