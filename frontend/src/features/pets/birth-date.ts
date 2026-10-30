/**
 * Fecha de nacimiento entre el formulario (`AAAA-MM-DD`, lo que guarda `pets.birth_date`) y el selector
 * nativo (`Date` a medianoche local). Módulo puro: se prueba con `npm test`.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `AAAA-MM-DD` → `Date` local (medianoche), o `null` si no es una fecha real. */
export function isoDateToLocalDate(value: string): Date | null {
  const match = ISO_DATE.exec(value.trim());
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

/** `Date` → `AAAA-MM-DD` con la fecha local (nunca UTC: el selector devuelve la medianoche local). */
export function localDateToIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Fecha con la que abre el selector: la elegida o, si no hay, hace un año (más cerca que hoy). */
export function pickerInitialDate(value: string, now: Date): Date {
  return isoDateToLocalDate(value) ?? new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
}

/** Fecha para mostrar («15 de marzo de 2024» / «March 15, 2024»), o `null` sin fecha válida. */
export function formatBirthDate(value: string, locale: string): string | null {
  const date = isoDateToLocalDate(value);
  return date ? date.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' }) : null;
}
