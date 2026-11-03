import { deviceLocaleTags, resolveLocale, type Locale } from '@/i18n/locale';
import { en } from '@/i18n/locales/en';
import { es, type Translations } from '@/i18n/locales/es';

/**
 * i18n mínimo y tipado. `es` y `en` deben tener las mismas claves (`Translations`). El idioma activo
 * sale del dispositivo al arrancar (`locale.ts`: español o, si no, inglés); cambiar el idioma del
 * sistema se aplica en el siguiente arranque. Si se necesita interpolación/plurales o cambio de idioma
 * en caliente, sustituir por una librería (p. ej. i18next) manteniendo la API `t(key)`.
 */
export type { Locale };

const translations: Record<Locale, Translations> = { es, en };

const currentLocale: Locale = resolveLocale(deviceLocaleTags());

type Leaves<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${Leaves<T[K]>}`;
}[keyof T & string];

export type TranslationKey = Leaves<Translations>;

/** Idioma activo; también selecciona las traducciones de catálogos (`catalog_translations.locale`). */
export function getLocale(): Locale {
  return currentLocale;
}

/**
 * Texto con parámetros: sustituye cada `{nombre}` del texto por `params.nombre` («Kika lleva {count}
 * días esta semana»). Un marcador sin valor se deja tal cual (se ve el error, no se inventa nada).
 */
export function tf(key: TranslationKey, params: Record<string, string | number>): string {
  return t(key).replace(/\{(\w+)\}/g, (match, name: string) =>
    params[name] === undefined ? match : String(params[name])
  );
}

export function t(key: TranslationKey): string {
  let node: unknown = translations[currentLocale];
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return key;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : key;
}
