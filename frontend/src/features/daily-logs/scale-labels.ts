import {
  DETAIL_SCALE_FIELDS,
  scaleKind,
  type ScaleField,
  type ScaleValue,
} from '@/features/daily-logs/daily-log-form';
import { t, type TranslationKey } from '@/i18n';

/**
 * Textos de las escalas del registro diario. Principales (energía, apetito, ánimo, actividad): 5
 * niveles. Detalles (sueño, vocalizaciones, interacción social): 3 opciones guardadas como 2/3/4
 * (decisión aprobada, `docs/DECISIONS.md`); un 1 o un 5 guardado antes se muestra con su texto
 * original (nunca se convierte).
 */

const RELATIVE = ['much_less', 'less', 'usual', 'more', 'much_more'] as const;
const QUALITY = ['very_bad', 'bad', 'normal', 'good', 'very_good'] as const;

/** Texto de un nivel de 5 (`short` en botones y resúmenes, `full` para lectores de pantalla). */
export function scaleOptionLabel(field: ScaleField, value: ScaleValue, length: 'short' | 'full'): string {
  return scaleKind(field) === 'quality'
    ? t(`dailyLogs.scale.quality.${length}.${QUALITY[value - 1]}`)
    : t(`dailyLogs.scale.relative.${length}.${RELATIVE[value - 1]}`);
}

export function isDetailField(field: ScaleField): boolean {
  return (DETAIL_SCALE_FIELDS as readonly ScaleField[]).includes(field);
}

/** Las tres opciones de un detalle, con su valor guardado. */
export const DETAIL_OPTION_VALUES = [2, 3, 4] as const;
export type DetailOptionValue = (typeof DETAIL_OPTION_VALUES)[number];

export function isDetailOptionValue(value: ScaleValue | null): value is DetailOptionValue {
  return value === 2 || value === 3 || value === 4;
}

const DETAIL_LABELS: Record<'sleep' | 'relative', Record<DetailOptionValue, TranslationKey>> = {
  // Sueño: la columna es de calidad (`sleep_quality`), así que «peor / mejor», no «menos / más».
  sleep: { 2: 'dailyLogs.detailScale.worse', 3: 'dailyLogs.detailScale.normal', 4: 'dailyLogs.detailScale.better' },
  relative: { 2: 'dailyLogs.detailScale.less', 3: 'dailyLogs.detailScale.normal', 4: 'dailyLogs.detailScale.more' },
};

/** Texto de una de las tres opciones de un detalle. */
export function detailOptionLabel(field: ScaleField, value: DetailOptionValue): string {
  return t(DETAIL_LABELS[field === 'sleep' ? 'sleep' : 'relative'][value]);
}

/**
 * Texto visible de un valor guardado, sea cual sea su escala: los detalles con 3 opciones usan sus
 * textos; un 1 o un 5 de un detalle (registros anteriores al cambio) y los principales, el de 5 niveles.
 */
export function scaleValueLabel(field: ScaleField, value: ScaleValue): string {
  if (isDetailField(field) && isDetailOptionValue(value)) return detailOptionLabel(field, value);
  return scaleOptionLabel(field, value, 'short');
}
