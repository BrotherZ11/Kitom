import { ListItem } from '@/components/ui/list-item';
import { SyncStatusTag, syncStatusLabel } from '@/features/daily-logs/components/sync-status';
import { summarizeDailyLog, toDailyLogFormValues } from '@/features/daily-logs/daily-log-form';
import { capitalizeFirst, formatLogDateLabel } from '@/features/daily-logs/log-date';
import type { DisplaySyncStatus } from '@/features/daily-logs/offline/daily-log-view';
import { scaleValueLabel } from '@/features/daily-logs/scale-labels';
import type { DailyLog } from '@/features/daily-logs/types';
import { getLocale, t } from '@/i18n';

type HistoryListItemProps = {
  log: DailyLog;
  /** Mostrar el año (registros de otro año). */
  withYear: boolean;
  isToday: boolean;
  /** Estado de sincronización; solo se muestra si no está sincronizado. */
  syncStatus?: DisplaySyncStatus;
  /** Texto propio bajo la fecha (p. ej. «Primer registro de Kika»); por defecto, el resumen del día. */
  subtitle?: string;
  /** Filete inferior: todas las filas de la lista menos la última. */
  divider?: boolean;
  onPress: () => void;
};

/**
 * Un día del historial (filas de «Día a día», tablero 6.1): la fecha guardada y lo que se indicó, tal
 * cual (todas las escalas indicadas, etiquetas, algo fuera de lo habitual y nota), sin puntuaciones ni
 * valoraciones. Si no está sincronizado, su estado a la derecha (icono + texto).
 */
export function HistoryListItem({
  log,
  withYear,
  isToday,
  syncStatus,
  subtitle,
  divider = false,
  onPress,
}: HistoryListItemProps) {
  const locale = getLocale();
  const summary = summarizeDailyLog(toDailyLogFormValues(log));
  const dateLabel = formatLogDateLabel(log.log_date, locale, { withYear });
  const title = isToday ? `${t('dailyLogs.today')}, ${dateLabel}` : capitalizeFirst(dateLabel, locale);
  const scales = summary.scales.length
    ? summary.scales
        .map(({ field, value }) => `${t(`dailyLogs.fields.${field}`)}: ${scaleValueLabel(field, value)}`)
        .join(' · ')
    : t('dailyLogs.history.noScales');
  const extras = [
    ...summary.tags.map((tag) => t(`dailyLogs.tags.${tag}`)),
    summary.unusualBehavior ? t('dailyLogs.history.unusualBehavior') : null,
    summary.hasNotes ? t('dailyLogs.history.withNotes') : null,
  ].filter((item): item is string => item !== null);
  const pending = syncStatus && syncStatus !== 'synced' ? syncStatus : null;

  return (
    <ListItem
      title={title}
      subtitle={subtitle ?? [scales, ...extras].join(' · ')}
      trailing={pending ? <SyncStatusTag status={pending} /> : undefined}
      accessibilityLabel={[title, pending ? syncStatusLabel(pending) : null, subtitle, scales, ...extras]
        .filter(Boolean)
        .join('. ')}
      divider={divider}
      onPress={onPress}
    />
  );
}
