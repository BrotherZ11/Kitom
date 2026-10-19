import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { TextLink } from '@/components/ui/text-link';
import { SyncStatusTag } from '@/features/daily-logs/components/sync-status';
import { toDailyLogError } from '@/features/daily-logs/daily-log-errors';
import { useDailyLog } from '@/features/daily-logs/hooks/use-daily-log';
import { useTodayLogDate } from '@/features/daily-logs/hooks/use-today-log-date';
import { t } from '@/i18n';
import { spacing } from '@/theme/tokens';

type TodayLogCardProps = {
  petId: string;
  /** UX (`can_edit_pet`): decide el texto del botón. La autorización real es RLS. */
  canEdit: boolean;
  /** Mostrar «Ver historial» (la ficha que ya tiene acceso al historial puede ocultarlo). */
  showHistoryLink?: boolean;
};

/**
 * Entrada al registro de hoy de una mascota concreta (no necesariamente la activa), desde su ficha
 * `/pets/[id]`: estado de hoy (servidor + dispositivo) y acceso a crearlo, editarlo o verlo.
 */
export function TodayLogCard({ petId, canEdit, showHistoryLink = true }: TodayLogCardProps) {
  const router = useRouter();
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
          ? t('dailyLogs.card.todayDone')
          : t('dailyLogs.card.todayEmpty');
  const pending = view.state === 'ready' && view.syncStatus && view.syncStatus !== 'synced' ? view.syncStatus : null;

  const actionLabel = !canEdit
    ? t('dailyLogs.card.view')
    : hasLog
      ? t('dailyLogs.card.edit')
      : t('dailyLogs.card.create');

  return (
    <Card>
      <View style={styles.row}>
        <View style={styles.text}>
          <Text variant="bodyStrong">{t('dailyLogs.card.title')}</Text>
          <Text variant="caption" color="inkMuted" accessibilityLiveRegion="polite">
            {status}
          </Text>
        </View>
        {pending ? <SyncStatusTag status={pending} /> : null}
      </View>
      <Button
        variant={canEdit && !hasLog ? 'primary' : 'secondary'}
        size="md"
        label={actionLabel}
        onPress={() => router.push({ pathname: '/pets/[id]/daily-log', params: { id: petId } })}
      />
      {showHistoryLink ? (
        <TextLink
          label={t('dailyLogs.card.history')}
          onPress={() => router.push({ pathname: '/pets/[id]/daily-logs', params: { id: petId } })}
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing['3'],
  },
  text: {
    flex: 1,
    gap: 2,
  },
});
