import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { Spacing } from '@/constants/theme';
import { ConflictResolution } from '@/features/daily-logs/components/conflict-resolution';
import { parseLogDateParam } from '@/features/daily-logs/daily-log-history';
import { useLocalDailyLog } from '@/features/daily-logs/hooks/use-daily-log';
import { formatLogDateLabel } from '@/features/daily-logs/log-date';
import { usePet } from '@/features/pets/hooks/use-pets';
import { getLocale, t } from '@/i18n';

/**
 * Detalle de un registro con cambios sin confirmar (resolver un conflicto, ver por qué no se pudo
 * sincronizar o qué falta por enviar). Se llega desde el estado de sincronización del formulario o
 * desde «Registros sin sincronizar». Lee solo el registro local: funciona aunque la mascota ya no sea
 * visible en el servidor (sin permiso o eliminada); el motor vuelve a comprobar el servidor antes de
 * guardar.
 */
export default function DailyLogResolveScreen() {
  const { id, date } = useLocalSearchParams<{ id: string; date: string }>();
  const router = useRouter();
  const logDate = parseLogDateParam(date);
  const pet = usePet(id);
  const local = useLocalDailyLog(id, logDate);
  const title = t(local.data?.status === 'conflict' ? 'dailyLogs.resolve.title' : 'dailyLogs.resolve.detailTitle');

  const content = () => {
    if (logDate === null) {
      return (
        <EmptyState
          title={t('dailyLogs.resolve.nothingToResolve')}
          actionLabel={t('dailyLogs.resolve.back')}
          onAction={() => router.back()}
        />
      );
    }
    if (local.isPending) return <LoadingState />;
    // Un fallo al leer el dispositivo no es "no hay nada": se dice y se puede reintentar.
    if (local.isError && local.data === undefined) {
      return <ErrorState message={t('dailyLogs.errors.local_read_failed')} onRetry={() => void local.refetch()} />;
    }

    return (
      <>
        <View style={styles.header}>
          {pet.data ? (
            <ThemedText type="subtitle">{pet.data.name}</ThemedText>
          ) : pet.data === null || pet.isError ? (
            // Sin acceso a la mascota (o eliminada): los datos del dispositivo siguen aquí.
            <ThemedText type="subtitle">{t('dailyLogs.unsynced.unknownPet')}</ThemedText>
          ) : null}
          <ThemedText themeColor="textSecondary">
            {formatLogDateLabel(logDate, getLocale(), { withYear: true })}
          </ThemedText>
        </View>
        <ConflictResolution
          petId={id}
          logDate={logDate}
          record={local.data ?? null}
          onDone={() => router.back()}
        />
      </>
    );
  };

  return (
    <Screen align="top" edges={['bottom', 'left', 'right']}>
      <Stack.Screen options={{ title }} />
      {content()}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: Spacing.half,
  },
});
