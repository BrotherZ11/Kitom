import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { Spacing } from '@/constants/theme';
import { DailyLogEditor } from '@/features/daily-logs/components/daily-log-editor';
import { toDailyLogError } from '@/features/daily-logs/daily-log-errors';
import { useDailyLog } from '@/features/daily-logs/hooks/use-daily-log';
import { useTodayLogDate } from '@/features/daily-logs/hooks/use-today-log-date';
import { formatLogDateLabel } from '@/features/daily-logs/log-date';
import { useCanEditPet, usePet } from '@/features/pets/hooks/use-pets';
import { petErrorMessage } from '@/features/pets/pet-errors';
import { getLocale, t } from '@/i18n';

/** Registro de hoy de una mascota (crear o editar). Solo online en esta fase. */
export default function DailyLogScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const pet = usePet(id);
  const canEdit = useCanEditPet(id);
  // La fecha se fija al abrir: el registro que se está rellenando no cambia de día.
  const logDate = useTodayLogDate({ refreshOnForeground: false });
  const log = useDailyLog(id, logDate);

  const content = () => {
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
    if (pet.isPending || canEdit.isPending || logDate === null || log.isPending) {
      return <LoadingState />;
    }
    if (pet.data === null) {
      return (
        <EmptyState
          title={t('pets.detail.notFound')}
          actionLabel={t('pets.detail.backToList')}
          onAction={() => router.dismissTo('/pets')}
        />
      );
    }

    return (
      <>
        <View style={styles.header}>
          <ThemedText type="subtitle">{pet.data.name}</ThemedText>
          <ThemedText themeColor="textSecondary">
            {`${t('dailyLogs.today')} · ${formatLogDateLabel(logDate, getLocale())}`}
          </ThemedText>
        </View>
        <DailyLogEditor
          key={logDate}
          petId={id}
          logDate={logDate}
          initialLog={log.data}
          canEdit={canEdit.data}
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
