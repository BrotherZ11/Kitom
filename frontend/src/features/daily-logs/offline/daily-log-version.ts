/**
 * Orden entre versiones de una fila de `daily_logs` (`updated_at` tal como lo devuelve PostgREST,
 * p. ej. `2026-10-15T09:14:26.89152+00:00`). Módulo puro (`npm test`).
 *
 * Nunca pasa por `Date` (perdería los microsegundos): se calculan segundos enteros desde la época,
 * con aritmética de calendario exacta, y los microsegundos aparte.
 *
 * Límites (ver `docs/FRONTEND_ARCHITECTURE.md` §5, «Lecturas tardías»):
 * - Dos versiones iguales son la misma fila: no hay nada que actualizar.
 * - Una cadena que no tiene el formato esperado no se puede comparar (`null`): quien llama decide
 *   de forma conservadora (no retroceder ni sustituir lo que hay).
 * - Se comparan instantes, no identidades: una fila borrada y vuelta a crear tiene un `updated_at`
 *   posterior (lo pone el reloj del servidor) y cuenta como más nueva.
 */

type Version = { seconds: number; micros: number };

const VERSION_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)$/;

/** Días desde 1970-01-01 de una fecha del calendario gregoriano (algoritmo de H. Hinnant). */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function offsetSeconds(zone: string): number | null {
  if (zone === 'Z') return 0;
  const sign = zone.startsWith('-') ? -1 : 1;
  const digits = zone.slice(1).replace(':', '');
  const hours = Number(digits.slice(0, 2));
  const minutes = digits.length > 2 ? Number(digits.slice(2, 4)) : 0;
  if (hours > 15 || minutes > 59) return null;
  return sign * (hours * 3600 + minutes * 60);
}

export function parseVersion(value: string): Version | null {
  const match = VERSION_PATTERN.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, fraction = '', zone] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(s);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  const offset = offsetSeconds(zone);
  if (offset === null) return null;
  return {
    seconds: daysFromCivil(year, month, day) * 86400 + hour * 3600 + minute * 60 + second - offset,
    micros: Number(fraction.padEnd(6, '0')),
  };
}

/** `1` si `a` es posterior, `-1` si es anterior, `0` si es el mismo instante, `null` si no se puede saber. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  if (a === b) return 0;
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;
  if (left.seconds !== right.seconds) return left.seconds > right.seconds ? 1 : -1;
  if (left.micros !== right.micros) return left.micros > right.micros ? 1 : -1;
  return 0;
}

/** ¿`candidate` es estrictamente posterior a `current`? (`false` si son iguales o no se pueden comparar). */
export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) === 1;
}

/** ¿`candidate` es estrictamente anterior a `current`? (`false` si son iguales o no se pueden comparar). */
export function isOlderVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) === -1;
}
