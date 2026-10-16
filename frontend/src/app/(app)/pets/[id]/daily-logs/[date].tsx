import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { Spacing } from '@/constants/theme';
import { DailyLogEditor } from '@/features/daily-logs/components/daily-log-editor';
import { toDailyLogError } from '@/features/daily-logs/daily-log-errors';
import { parseLogDateParam, resolveHistoryLogView } from '@/features/daily-logs/daily-log-history';
import { resolveDailyLogPetContext } from '@/features/daily-logs/daily-log-pet-context';
import { useDailyLog } from '@/features/daily-logs/hooks/use-daily-log';
import { formatLogDateLabel } from '@/features/daily-logs/log-date';
import { useCanEditPet, usePet } from '@/features/pets/hooks/use-pets';
import { petErrorMessage, toPetError } from '@/features/pets/pet-errors';
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
  // Sin conexión y sin la mascota en caché, el registro sigue disponible (`daily-log-pet-context.ts`).
  const petContext = resolveDailyLogPetContext(pet, canEdit, (error) => toPetError(error).code === 'network');
  const { view, refetch } = useDailyLog(id, logDate, { waitForRemote: true });

  const missing = (
    <EmptyState
      title={t('dailyLogs.entry.missing')}
      actionLabel={t('dailyLogs.entry.backToHistory')}
      onAction={() => router.back()}
    />
  );

  const content = () => {
    if (logDate === null) return missing;
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
    if (petContext.state === 'loading' || view.state === 'loading') return <LoadingState />;
    if (petContext.state === 'not_found') {
      return (
        <EmptyState
          title={t('pets.detail.notFound')}
          actionLabel={t('pets.detail.backToList')}
          onAction={() => router.dismissTo('/pets')}
        />
      );
    }

    const mode = resolveHistoryLogView(view.content, petContext.canEdit);
    if (mode === 'missing' || !view.content) return missing;

    return (
      <>
        <View style={styles.header}>
          <ThemedText type="subtitle">{petContext.name ?? t('dailyLogs.offlinePet.unavailable')}</ThemedText>
          <ThemedText themeColor="textSecondary">
            {formatLogDateLabel(logDate, getLocale(), { withYear: true })}
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
          canEdit={mode === 'editable'}
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
