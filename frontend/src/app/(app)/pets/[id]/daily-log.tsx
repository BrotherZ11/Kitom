import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { Spacing } from '@/constants/theme';
import { DailyLogEditor } from '@/features/daily-logs/components/daily-log-editor';
import { toDailyLogError } from '@/features/daily-logs/daily-log-errors';
import { resolveDailyLogPetContext } from '@/features/daily-logs/daily-log-pet-context';
import { useDailyLog } from '@/features/daily-logs/hooks/use-daily-log';
import { useTodayLogDate } from '@/features/daily-logs/hooks/use-today-log-date';
import { formatLogDateLabel } from '@/features/daily-logs/log-date';
import { useCanEditPet, usePet } from '@/features/pets/hooks/use-pets';
import { petErrorMessage, toPetError } from '@/features/pets/pet-errors';
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
  // Sin conexión y sin la mascota en caché, el registro sigue disponible (`daily-log-pet-context.ts`).
  const petContext = resolveDailyLogPetContext(pet, canEdit, (error) => toPetError(error).code === 'network');
  // La fecha se fija al abrir: el registro que se está rellenando no cambia de día.
  const logDate = useTodayLogDate({ refreshOnForeground: false });
  const { view, refetch } = useDailyLog(id, logDate, { allowOfflineCreate: true, waitForRemote: true });

  const content = () => {
    // Con datos ya cargados (p. ej. al quedarse sin conexión), un error al refrescar no tapa la pantalla.
    if (petContext.state === 'error') {
      const query = petContext.source === 'pet' ? pet : canEdit;
      return <ErrorState message={petErrorMessage(petContext.error)} onRetry={() => void query.refetch()} />;
    }
    if (view.state === 'error') {
      return (
        <ErrorState message={t(`dailyLogs.errors.${toDailyLogError(view.error).code}`)} onRetry={refetch} />
      );
    }
    if (petContext.state === 'loading' || logDate === null || view.state === 'loading') {
      return <LoadingState />;
    }
    if (petContext.state === 'not_found') {
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
          <ThemedText type="subtitle">{petContext.name ?? t('dailyLogs.offlinePet.unavailable')}</ThemedText>
          <ThemedText themeColor="textSecondary">
            {`${t('dailyLogs.today')} · ${formatLogDateLabel(logDate, getLocale())}`}
          </ThemedText>
          {petContext.permissionUnknown ? (
            <ThemedText type="small" themeColor="textSecondary">
              {t('dailyLogs.offlinePet.permissionUnknown')}
            </ThemedText>
          ) : null}
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
          canEdit={petContext.canEdit}
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
