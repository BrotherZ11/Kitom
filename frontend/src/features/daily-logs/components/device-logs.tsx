import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorState, LoadingState } from '@/components/ui/query-state';
import { Spacing } from '@/constants/theme';
import { useDeviceDailyLogPets } from '@/features/daily-logs/hooks/use-daily-log';
import { formatLogDateLabel } from '@/features/daily-logs/log-date';
import { useTheme } from '@/hooks/use-theme';
import { getLocale, t } from '@/i18n';

/**
 * Registros diarios guardados en el dispositivo, agrupados por mascota, para llegar a ellos cuando la
 * lista de mascotas no se puede cargar (sin conexión o sin sesión utilizable). Sin el servidor no se
 * conoce el nombre de la mascota: se dice, no se inventa. Sale solo del almacén local del usuario.
 */
export function DeviceDailyLogs() {
  const router = useRouter();
  const theme = useTheme();
  const { state, refetch } = useDeviceDailyLogPets();

  if (state.status === 'loading') return <LoadingState variant="inline" />;
  if (state.status === 'error') return <ErrorState message={t('dailyLogs.errors.local_read_failed')} onRetry={refetch} />;

  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">{t('dailyLogs.deviceLogs.title')}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {state.data.length === 0 ? t('dailyLogs.deviceLogs.none') : t('dailyLogs.deviceLogs.description')}
      </ThemedText>
      {state.data.map(({ petId, count, latestDate }) => (
        <View key={petId} style={[styles.item, { borderColor: theme.border }]}>
          <ThemedText type="smallBold">{t('dailyLogs.deviceLogs.pet')}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {`${t('dailyLogs.deviceLogs.count')}: ${count} · ${t('dailyLogs.deviceLogs.latest')}: ${formatLogDateLabel(latestDate, getLocale(), { withYear: true })}`}
          </ThemedText>
          <Button
            label={t('dailyLogs.deviceLogs.today')}
            onPress={() => router.push({ pathname: '/pets/[id]/daily-log', params: { id: petId } })}
          />
          <Button
            variant="secondary"
            label={t('dailyLogs.deviceLogs.history')}
            onPress={() => router.push({ pathname: '/pets/[id]/daily-logs', params: { id: petId } })}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
  item: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.two,
  },
});
