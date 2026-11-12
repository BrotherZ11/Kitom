import {
  fieldByCode,
  isSpeciesCode,
  type SpeciesData,
  type SpeciesField,
  type SpeciesValue,
} from '@/features/species/species-fields';
import { getLocale, t, tf, type TranslationKey } from '@/i18n';

/**
 * Textos visibles de los campos de especie (`i18n/locales/species-fields-*.ts`). Los códigos vienen
 * del catálogo, así que la clave se compone; `species-fields.test.mjs` comprueba que existen todas.
 */

export function speciesFieldLabel(code: string): string {
  const key = `speciesFields.fields.${code}.label` as TranslationKey;
  const label = t(key);
  return label === key ? code : label;
}

export function speciesOptionLabel(code: string, option: string): string {
  const key = `speciesFields.fields.${code}.options.${option}` as TranslationKey;
  const label = t(key);
  return label === key ? option : label;
}

export function speciesUnitLabel(field: SpeciesField): string {
  return field.unit ? t(`speciesFields.units.${field.unit}`) : '';
}

export function speciesAboutTitle(speciesCode: string | null | undefined): string {
  return t(`speciesFields.about.${isSpeciesCode(speciesCode) ? speciesCode : 'other'}`);
}

/** Valor visible, tal cual se guardó (sin interpretaciones). */
export function formatSpeciesValue(code: string, value: SpeciesValue): string {
  const field = fieldByCode(code);
  if (typeof value === 'boolean') return value ? t('common.yes') : t('common.no');
  if (Array.isArray(value)) return value.map((option) => speciesOptionLabel(code, option)).join(', ');
  if (field?.kind === 'scale3' && (value === 2 || value === 3 || value === 4)) {
    return t(`speciesFields.scale3.${String(value) as '2' | '3' | '4'}`);
  }
  if (field?.kind === 'choice' && typeof value === 'string') return speciesOptionLabel(code, value);
  if (typeof value === 'number') {
    const number = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 2 }).format(value);
    const unit = field ? speciesUnitLabel(field) : '';
    return unit ? `${number} ${unit}` : number;
  }
  return String(value);
}

/** «Etiqueta: valor» de cada dato, en el orden del catálogo de la especie (los desconocidos, al final). */
export function describeSpeciesData(data: SpeciesData, fields: readonly SpeciesField[] = []): string[] {
  const order = new Map(fields.map((field, index) => [field.code, index]));
  return Object.keys(data)
    .sort((a, b) => (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER) || a.localeCompare(b))
    .map((code) => `${speciesFieldLabel(code)}: ${formatSpeciesValue(code, data[code])}`);
}

/** Mensaje de error de un campo numérico o de fecha. */
export function speciesFieldErrorMessage(field: SpeciesField, error: 'invalid_number' | 'invalid_decimal' | 'invalid_date'): string {
  if (error === 'invalid_date') return t('speciesFields.invalidDate');
  return tf(error === 'invalid_decimal' ? 'speciesFields.invalidDecimal' : 'speciesFields.invalidNumber', {
    min: field.min ?? '',
    max: field.max ?? '',
  });
}
