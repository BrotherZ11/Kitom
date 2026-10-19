import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/query-state';
import { Text } from '@/components/ui/text';
import { useDeviceDailyLogPets } from '@/features/daily-logs/hooks/use-daily-log';
import { formatLogDateLabel } from '@/features/daily-logs/log-date';
import { getLocale, t } from '@/i18n';
import { spacing } from '@/theme/tokens';

/**
 * Registros diarios guardados en el dispositivo, agrupados por mascota, para llegar a ellos cuando la
 * lista de mascotas no se puede cargar (sin conexión o sin sesión utilizable). Sin el servidor no se
 * conoce el nombre de la mascota: se dice, no se inventa. Sale solo del almacén local del usuario.
 */
export function DeviceDailyLogs() {
  const router = useRouter();
  const { state, refetch } = useDeviceDailyLogPets();

  if (state.status === 'loading') return <LoadingState variant="inline" />;
  if (state.status === 'error') return <ErrorState message={t('dailyLogs.errors.local_read_failed')} onRetry={refetch} />;

  return (
    <View style={styles.section}>
      <Text variant="title3" accessibilityRole="header">
        {t('dailyLogs.deviceLogs.title')}
      </Text>
      <Text color="inkMuted">
        {state.data.length === 0 ? t('dailyLogs.deviceLogs.none') : t('dailyLogs.deviceLogs.description')}
      </Text>
      {state.data.map(({ petId, count, latestDate }) => (
        <Card key={petId}>
          <View>
            <Text variant="bodyStrong">{t('dailyLogs.deviceLogs.pet')}</Text>
            <Text variant="caption" color="inkMuted">
              {`${t('dailyLogs.deviceLogs.count')}: ${count} · ${t('dailyLogs.deviceLogs.latest')}: ${formatLogDateLabel(latestDate, getLocale(), { withYear: true })}`}
            </Text>
          </View>
          <Button
            size="md"
            label={t('dailyLogs.deviceLogs.today')}
            onPress={() => router.push({ pathname: '/pets/[id]/daily-log', params: { id: petId } })}
          />
          <Button
            variant="secondary"
            size="md"
            label={t('dailyLogs.deviceLogs.history')}
            onPress={() => router.push({ pathname: '/pets/[id]/daily-logs', params: { id: petId } })}
          />
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing['3'],
  },
});
