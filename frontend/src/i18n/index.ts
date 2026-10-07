import { en } from '@/i18n/locales/en';
import { es, type Translations } from '@/i18n/locales/es';

/**
 * i18n mínimo y tipado. `es` y `en` deben tener las mismas claves (`Translations`). El idioma activo
 * es fijo (`es`) hasta implementar la detección del idioma del dispositivo (fallback a inglés, PRD).
 * Si se necesita interpolación/plurales o cambio de idioma en caliente, sustituir por una librería
 * (p. ej. i18next) manteniendo la API `t(key)`.
 */
export type Locale = 'es' | 'en';

const translations: Record<Locale, Translations> = { es, en };

const currentLocale: Locale = 'es';

type Leaves<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${Leaves<T[K]>}`;
}[keyof T & string];

export type TranslationKey = Leaves<Translations>;

/** Idioma activo; también selecciona las traducciones de catálogos (`catalog_translations.locale`). */
export function getLocale(): Locale {
  return currentLocale;
}

export function t(key: TranslationKey): string {
  let node: unknown = translations[currentLocale];
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return key;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : key;
}
