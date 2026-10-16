import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Spacing } from '@/constants/theme';
import { syncStatusLabel } from '@/features/daily-logs/components/sync-status';
import { toDailyLogError } from '@/features/daily-logs/daily-log-errors';
import { useDailyLog } from '@/features/daily-logs/hooks/use-daily-log';
import { useTodayLogDate } from '@/features/daily-logs/hooks/use-today-log-date';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

type TodayLogCardProps = {
  petId: string;
  /** UX (`can_edit_pet`): decide el texto del botón. La autorización real es RLS. */
  canEdit: boolean;
};

/** Entrada al registro de hoy desde la ficha de la mascota: estado de hoy + acceso. */
export function TodayLogCard({ petId, canEdit }: TodayLogCardProps) {
  const router = useRouter();
  const theme = useTheme();
  const logDate = useTodayLogDate();
  // Sin conexión y sin nada guardado no se sabe si hoy hay registro: se muestra el error de red.
  const { view } = useDailyLog(petId, logDate);
  const hasLog = view.state === 'ready' && view.content !== null;

  const status =
    view.state === 'loading'
      ? t('common.loading')
      : view.state === 'error'
        ? t(`dailyLogs.errors.${toDailyLogError(view.error).code}`)
        : hasLog
          ? `✓ ${t('dailyLogs.card.todayDone')}`
          : t('dailyLogs.card.todayEmpty');
  const syncLabel =
    view.state === 'ready' && view.syncStatus && view.syncStatus !== 'synced'
      ? syncStatusLabel(view.syncStatus)
      : null;

  const actionLabel = !canEdit
    ? t('dailyLogs.card.view')
    : hasLog
      ? t('dailyLogs.card.edit')
      : t('dailyLogs.card.create');

  return (
    <View style={[styles.card, { borderColor: theme.border }]}>
      <ThemedText type="smallBold">{t('dailyLogs.card.title')}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite">
        {status}
      </ThemedText>
      {syncLabel ? (
        <ThemedText type="small" themeColor="textSecondary">
          {syncLabel}
        </ThemedText>
      ) : null}
      <Button
        variant={canEdit && !hasLog ? 'primary' : 'secondary'}
        label={actionLabel}
        onPress={() => router.push({ pathname: '/pets/[id]/daily-log', params: { id: petId } })}
      />
      <Button
        variant="ghost"
        label={t('dailyLogs.card.history')}
        onPress={() => router.push({ pathname: '/pets/[id]/daily-logs', params: { id: petId } })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.two,
  },
});
