import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { Spacing } from '@/constants/theme';
import { DailyLogEditor } from '@/features/daily-logs/components/daily-log-editor';
import { toDailyLogError } from '@/features/daily-logs/daily-log-errors';
import { parseLogDateParam, resolveHistoryLogView } from '@/features/daily-logs/daily-log-history';
import { useDailyLog } from '@/features/daily-logs/hooks/use-daily-log';
import { formatLogDateLabel } from '@/features/daily-logs/log-date';
import { useCanEditPet, usePet } from '@/features/pets/hooks/use-pets';
import { petErrorMessage } from '@/features/pets/pet-errors';
import { getLocale, t } from '@/i18n';

/**
 * Un registro guardado (normalmente anterior a hoy): consulta y edición. Nunca crea: si ese día no
 * tiene registro, lo indica. La fecha es la de la ruta/fila guardada, no la de hoy.
 */
export default function DailyLogEntryScreen() {
  const { id, date } = useLocalSearchParams<{ id: string; date: string }>();
  const router = useRouter();
  const logDate = parseLogDateParam(date);
  const pet = usePet(id);
  const canEdit = useCanEditPet(id);
  const log = useDailyLog(id, logDate);

  const missing = (
    <EmptyState
      title={t('dailyLogs.entry.missing')}
      actionLabel={t('dailyLogs.entry.backToHistory')}
      onAction={() => router.back()}
    />
  );

  const content = () => {
    if (logDate === null) return missing;
    if (pet.isError) {
      return <ErrorState message={petErrorMessage(pet.error)} onRetry={() => pet.refetch()} />;
    }
    if (canEdit.isError) {
      return <ErrorState message={petErrorMessage(canEdit.error)} onRetry={() => canEdit.refetch()} />;
    }
    if (log.isError) {
      return (
        <ErrorState
          message={t(`dailyLogs.errors.${toDailyLogError(log.error).code}`)}
          onRetry={() => log.refetch()}
        />
      );
    }
    if (pet.isPending || canEdit.isPending || log.isPending) return <LoadingState />;
    if (pet.data === null) {
      return (
        <EmptyState
          title={t('pets.detail.notFound')}
          actionLabel={t('pets.detail.backToList')}
          onAction={() => router.dismissTo('/pets')}
        />
      );
    }

    const view = resolveHistoryLogView(log.data, canEdit.data);
    if (view === 'missing' || !log.data) return missing;

    return (
      <>
        <View style={styles.header}>
          <ThemedText type="subtitle">{pet.data.name}</ThemedText>
          <ThemedText themeColor="textSecondary">
            {formatLogDateLabel(log.data.log_date, getLocale(), { withYear: true })}
          </ThemedText>
        </View>
        <DailyLogEditor
          key={log.data.log_date}
          petId={id}
          logDate={log.data.log_date}
          initialLog={log.data}
          canEdit={view === 'editable'}
        />
      </>
    );
  };

  return (
    <Screen align="top" edges={['bottom', 'left', 'right']}>
      {content()}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: Spacing.half,
  },
});
