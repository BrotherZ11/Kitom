import { scaleOptionLabel } from '@/features/daily-logs/components/scale-selector';
import { isDailyLogTag, type ScaleField, type ScaleValue } from '@/features/daily-logs/daily-log-form';
import type { DailyLogContent, LevelColumn } from '@/features/daily-logs/offline/daily-log-content';
import type { MergeUnit } from '@/features/daily-logs/offline/daily-log-merge';
import { t, type TranslationKey } from '@/i18n';

/** Nombre visible de cada dato del registro (unidades de fusión y etiquetas). */
export const FIELD_LABELS: Record<MergeUnit | 'tags', TranslationKey> = {
  energy_level: 'dailyLogs.fields.energy',
  appetite_level: 'dailyLogs.fields.appetite',
  mood_level: 'dailyLogs.fields.mood',
  activity_level: 'dailyLogs.fields.activity',
  sleep_quality: 'dailyLogs.fields.sleep',
  vocalization_level: 'dailyLogs.fields.vocalization',
  social_interaction_level: 'dailyLogs.fields.social',
  unusual_behavior: 'dailyLogs.history.unusualBehavior',
  notes: 'dailyLogs.notes',
  tags: 'dailyLogs.tags.title',
};

const SCALE_FIELD: Record<LevelColumn, ScaleField> = {
  energy_level: 'energy',
  appetite_level: 'appetite',
  mood_level: 'mood',
  activity_level: 'activity',
  sleep_quality: 'sleep',
  vocalization_level: 'vocalization',
  social_interaction_level: 'social',
};

/**
 * Valor visible de un dato (tal cual se guardó; sin interpretaciones). `values` lleva al menos las
 * columnas de esa unidad.
 */
export function formatUnitValue(unit: MergeUnit | 'tags', values: Partial<DailyLogContent>): string {
  if (unit === 'tags') {
    const tags = values.tags ?? [];
    if (tags.length === 0) return t('dailyLogs.resolve.noTags');
    return tags.map((tag) => (isDailyLogTag(tag) ? t(`dailyLogs.tags.${tag}`) : tag)).join(', ');
  }
  if (unit === 'notes') return values.notes ?? t('dailyLogs.resolve.noNotes');
  if (unit === 'unusual_behavior') {
    if (!values.unusual_behavior) return t('dailyLogs.resolve.no');
    return values.unusual_behavior_notes
      ? `${t('dailyLogs.resolve.yes')}: ${values.unusual_behavior_notes}`
      : t('dailyLogs.resolve.yes');
  }
  const value = values[unit];
  if (value === null || value === undefined) return t('dailyLogs.scale.notAnswered');
  return `${value} · ${scaleOptionLabel(SCALE_FIELD[unit], value as ScaleValue, 'short')}`;
}
