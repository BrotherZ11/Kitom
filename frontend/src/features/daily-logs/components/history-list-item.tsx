import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { scaleOptionLabel } from '@/features/daily-logs/components/scale-selector';
import { summarizeDailyLog, toDailyLogFormValues } from '@/features/daily-logs/daily-log-form';
import { formatLogDateLabel } from '@/features/daily-logs/log-date';
import type { DailyLog } from '@/features/daily-logs/types';
import { useTheme } from '@/hooks/use-theme';
import { getLocale, t } from '@/i18n';

type HistoryListItemProps = {
  log: DailyLog;
  /** Mostrar el año (registros de otro año). */
  withYear: boolean;
  isToday: boolean;
  onPress: () => void;
};

/** Un día del historial: la fecha guardada y lo que se indicó, tal cual (sin puntuaciones ni valoraciones). */
export function HistoryListItem({ log, withYear, isToday, onPress }: HistoryListItemProps) {
  const theme = useTheme();
  const summary = summarizeDailyLog(toDailyLogFormValues(log));
  const dateLabel = formatLogDateLabel(log.log_date, getLocale(), { withYear });
  const title = isToday
    ? `${t('dailyLogs.today')} · ${dateLabel}`
    : dateLabel.charAt(0).toLocaleUpperCase(getLocale()) + dateLabel.slice(1);
  const scales = summary.scales.length
    ? summary.scales
        .map(({ field, value }) => `${t(`dailyLogs.fields.${field}`)}: ${scaleOptionLabel(field, value, 'short')}`)
        .join(' · ')
    : t('dailyLogs.history.noScales');
  const extras = [
    ...summary.tags.map((tag) => t(`dailyLogs.tags.${tag}`)),
    summary.unusualBehavior ? t('dailyLogs.history.unusualBehavior') : null,
    summary.hasNotes ? t('dailyLogs.history.withNotes') : null,
  ].filter((item): item is string => item !== null);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[title, scales, ...extras].join('. ')}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
        pressed && styles.pressed,
      ]}>
      <ThemedText type="smallBold">{title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {scales}
      </ThemedText>
      {extras.length ? (
        <View style={styles.extras}>
          {extras.map((extra) => (
            <ThemedText
              key={extra}
              type="small"
              style={[styles.extra, { borderColor: theme.border, color: theme.text }]}>
              {extra}
            </ThemedText>
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: Spacing.one,
    padding: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.two,
  },
  extras: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
  },
  extra: {
    paddingHorizontal: Spacing.two,
    borderWidth: 1,
    borderRadius: Spacing.three,
  },
  pressed: {
    opacity: 0.7,
  },
});
