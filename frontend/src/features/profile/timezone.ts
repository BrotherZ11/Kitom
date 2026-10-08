/**
 * Zona horaria del usuario (`profiles.timezone`). Módulo puro, sin imports: se prueba con
 * `npm test` (Node) además de usarse en la app.
 *
 * Contrato con la BD (trigger `validate_profile_timezone`): identificador IANA de zona, `'UTC'` o
 * Área/Ubicación (`Europe/Madrid`); nunca offsets (`+01:00`) ni abreviaturas (`CET`, `GMT+0`).
 * `NULL` = sin configurar (el servidor usa UTC).
 */

const IANA_ZONE = /^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+$/;
const NON_CANONICAL_PREFIX = /^(?:posix|right)\//;

/** El valor como zona IANA válida, o `null` si no lo es (tipo, formato o desconocida por `Intl`). */
export function normalizeTimeZone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const timeZone = value.trim();
  const hasZoneShape =
    timeZone === 'UTC' || (IANA_ZONE.test(timeZone) && !NON_CANONICAL_PREFIX.test(timeZone));
  if (!hasZoneShape || timeZone === 'Etc/Unknown') return null;
  try {
    // Lanza RangeError si el motor no conoce la zona.
    Intl.DateTimeFormat('en-US', { timeZone });
    return timeZone;
  } catch {
    return null;
  }
}

/** Zona IANA del dispositivo, o `null` si no se puede obtener una válida. Nunca lanza. */
export function getDeviceTimeZone(): string | null {
  try {
    return normalizeTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return null;
  }
}

export type TimeZoneSyncResult =
  /** Guardada la zona del dispositivo (el perfil no tenía). */
  | 'saved'
  /** El perfil ya tenía zona (o no existe): no se toca. */
  | 'already_set'
  /** No hay una zona válida en el dispositivo: no se toca nada. */
  | 'no_device_timezone'
  /** Error al guardar (red, servidor): no se toca nada; se puede reintentar. */
  | 'failed';

export type TimeZoneSyncDeps = {
  detectTimeZone: () => unknown;
  /** Guarda solo si el perfil no tiene zona; `true` si la ha guardado. */
  saveIfMissing: (userId: string, timeZone: string) => Promise<boolean>;
};

/**
 * Inicializa `profiles.timezone` con la zona del dispositivo si está vacía. Nunca sobrescribe un
 * valor existente (lo garantiza `saveIfMissing` en la propia consulta) y nunca lanza: un fallo no
 * debe romper la sesión ni la app.
 */
export async function syncProfileTimeZone(
  userId: string,
  { detectTimeZone, saveIfMissing }: TimeZoneSyncDeps
): Promise<TimeZoneSyncResult> {
  let timeZone: string | null;
  try {
    timeZone = normalizeTimeZone(detectTimeZone());
  } catch {
    timeZone = null;
  }
  if (!timeZone) return 'no_device_timezone';

  try {
    return (await saveIfMissing(userId, timeZone)) ? 'saved' : 'already_set';
  } catch {
    return 'failed';
  }
}
