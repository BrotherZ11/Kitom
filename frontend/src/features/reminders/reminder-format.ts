/**
 * Textos de fecha y hora de la agenda, en la hora local del dispositivo. Módulo puro: el idioma se
 * recibe por parámetro (`Intl`). Las palabras «hoy», «mañana» y «ayer» las pone la UI (i18n) a partir
 * de `relativeDay`.
 */

const pad = (value: number) => String(value).padStart(2, '0');

/** `17:30` (24 h, como el resto de la app). */
export function formatReminderTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export type RelativeDay = 'yesterday' | 'today' | 'tomorrow' | null;

function dayNumber(date: Date): number {
  return Math.round(new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() / 86_400_000);
}

/** ¿Es ayer, hoy o mañana respecto a `now`? Si no, `null`. */
export function relativeDay(date: Date, now: Date): RelativeDay {
  const diff = dayNumber(date) - dayNumber(now);
  if (diff === -1) return 'yesterday';
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  return null;
}

/**
 * Día corto: «sábado 18»; si es de otro mes, «domingo 2 nov»; de otro año, «2 nov 2027». Sin «de»
 * (tablero 8.1).
 */
export function formatReminderDay(date: Date, now: Date, locale: string): string {
  const sameYear = date.getFullYear() === now.getFullYear();
  const sameMonth = sameYear && date.getMonth() === now.getMonth();
  try {
    if (!sameYear) {
      return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' })
        .format(date)
        .replace(/ de /g, ' ')
        .replace(/\./g, '');
    }
    const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(date);
    if (sameMonth) return `${weekday} ${date.getDate()}`;
    const month = new Intl.DateTimeFormat(locale, { month: 'short' }).format(date).replace(/\./g, '');
    return `${weekday} ${date.getDate()} ${month}`;
  } catch {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
}

/** Día largo para el detalle: «martes, 28 de octubre» (con año si no es el actual). */
export function formatReminderLongDay(date: Date, now: Date, locale: string): string {
  try {
    const text = new Intl.DateTimeFormat(locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
    }).format(date);
    return text.charAt(0).toUpperCase() + text.slice(1);
  } catch {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
}

/** «Octubre de 2026» para la cabecera del calendario. */
export function formatMonthTitle(year: number, monthIndex: number, locale: string): string {
  try {
    const text = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(year, monthIndex, 1));
    return text.charAt(0).toUpperCase() + text.slice(1);
  } catch {
    return `${year}-${pad(monthIndex + 1)}`;
  }
}

/** Fecha completa con año: «16 de octubre de 2026» (aceptaciones, logros). */
export function formatFullDate(date: Date, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
  } catch {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
}
