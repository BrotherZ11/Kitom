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

/**
 * Registro de hoy de una mascota (crear o editar). Se guarda en el dispositivo y se sincroniza. Con
 * conexión espera brevemente a la versión del servidor; sin conexión (o si el servidor tarda)
 * muestra lo último conocido y, si no hay nada, permite empezarlo.
 */
export default function DailyLogScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const pet = usePet(id);
  const canEdit = useCanEditPet(id);
  // La fecha se fija al abrir: el registro que se está rellenando no cambia de día.
  const logDate = useTodayLogDate({ refreshOnForeground: false });
  const { view, refetch } = useDailyLog(id, logDate, { allowOfflineCreate: true, waitForRemote: true });

  const content = () => {
    // Con datos ya cargados (p. ej. al quedarse sin conexión), un error al refrescar no tapa la pantalla.
    if (pet.isError && pet.data === undefined) {
      return <ErrorState message={petErrorMessage(pet.error)} onRetry={() => pet.refetch()} />;
    }
    if (canEdit.isError && canEdit.data === undefined) {
      return <ErrorState message={petErrorMessage(canEdit.error)} onRetry={() => canEdit.refetch()} />;
    }
    if (view.state === 'error') {
      return (
        <ErrorState message={t(`dailyLogs.errors.${toDailyLogError(view.error).code}`)} onRetry={refetch} />
      );
    }
    if (pet.data === undefined || canEdit.data === undefined || logDate === null || view.state === 'loading') {
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
          {view.offline || view.checking ? (
            <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite">
              {t(view.offline ? 'dailyLogs.sync.offline' : 'dailyLogs.sync.notChecked')}
            </ThemedText>
          ) : null}
        </View>
        <DailyLogEditor
          key={logDate}
          petId={id}
          logDate={logDate}
          initialContent={view.content}
          baseRow={view.baseRow}
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
