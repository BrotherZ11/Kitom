import { useRouter } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { Spacing } from '@/constants/theme';
import { syncStatusLabel } from '@/features/daily-logs/components/sync-status';
import { useUnsyncedDailyLogs } from '@/features/daily-logs/hooks/use-daily-log';
import { formatLogDateLabel } from '@/features/daily-logs/log-date';
import { usePets } from '@/features/pets/hooks/use-pets';
import { useTheme } from '@/hooks/use-theme';
import { getLocale, t } from '@/i18n';

/**
 * Registros del dispositivo con cambios sin confirmar por el servidor (pendientes, fallidos o en
 * conflicto), de todas las mascotas del usuario. Sale del almacén local: aparecen aunque la mascota
 * ya no sea visible (sin permiso, ya no miembro o eliminada). Cada uno abre su detalle, donde se
 * pueden ver y copiar los datos y resolver o descartar si el estado lo permite.
 */
export default function UnsyncedDailyLogsScreen() {
  const router = useRouter();
  const theme = useTheme();
  // Solo para poner nombres; sin conexión o sin acceso, la lista funciona igual.
  const pets = usePets();
  const { view, refetch } = useUnsyncedDailyLogs(pets.data);

  const content = () => {
    if (view.state === 'loading') return <LoadingState />;
    if (view.state === 'error') {
      return <ErrorState message={t('dailyLogs.errors.local_read_failed')} onRetry={refetch} />;
    }
    if (view.items.length === 0) return <EmptyState title={t('dailyLogs.unsynced.none')} />;

    return (
      <>
        <ThemedText type="small" themeColor="textSecondary">
          {t('dailyLogs.unsynced.description')}
        </ThemedText>
        {view.items.map(({ record, petName, syncStatus }) => {
          const name = petName ?? t('dailyLogs.unsynced.unknownPet');
          const date = formatLogDateLabel(record.logDate, getLocale(), { withYear: true });
          const status = syncStatusLabel(syncStatus);
          return (
            <Pressable
              key={`${record.petId}/${record.logDate}`}
              accessibilityRole="button"
              accessibilityLabel={`${name}. ${date}. ${status}`}
              onPress={() =>
                router.push({
                  pathname: '/pets/[id]/daily-logs/resolve/[date]',
                  params: { id: record.petId, date: record.logDate },
                })
              }
              style={[
                styles.item,
                { borderColor: syncStatus === 'conflict' || syncStatus === 'failed' ? theme.danger : theme.border },
              ]}>
              <ThemedText type="smallBold">{name}</ThemedText>
              <ThemedText type="small">{date}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {status}
              </ThemedText>
            </Pressable>
          );
        })}
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
  item: {
    gap: Spacing.half,
    padding: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.two,
  },
});
