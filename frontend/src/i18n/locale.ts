/**
 * Idioma de la app a partir de las preferencias del dispositivo. Módulo puro (sin imports): se prueba
 * con `npm test`. Español si el idioma preferido es español (cualquier región); si no, inglés, que es
 * el idioma de respaldo del producto (PRD §7).
 */
export type Locale = 'es' | 'en';

export function resolveLocale(tags: readonly (string | null | undefined)[]): Locale {
  const first = tags.find((tag): tag is string => typeof tag === 'string' && tag.trim() !== '');
  if (!first) return 'es';
  return first.trim().toLowerCase().split(/[-_]/)[0] === 'es' ? 'es' : 'en';
}

/**
 * Idioma preferido del dispositivo según el motor de JS (`Intl`, disponible en Hermes, iOS, Android y
 * web). `navigator.languages` solo existe en web y da el orden de preferencia completo.
 */
export function deviceLocaleTags(): string[] {
  const tags: string[] = [];
  const nav = (globalThis as { navigator?: { languages?: readonly string[]; language?: string } }).navigator;
  if (nav?.languages?.length) tags.push(...nav.languages);
  else if (nav?.language) tags.push(nav.language);
  try {
    tags.push(Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    // Sin Intl: se queda con lo que haya (o el valor por defecto de resolveLocale).
  }
  return tags;
}
