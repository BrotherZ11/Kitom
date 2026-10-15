import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Spacing } from '@/constants/theme';
import { useUnsyncedDailyLogs } from '@/features/daily-logs/hooks/use-daily-log';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

/**
 * Entrada de la pantalla de inicio a «Registros sin sincronizar», con contador. Lee solo el almacén
 * local del usuario: no depende de que la mascota siga visible en el servidor.
 */
export function UnsyncedDailyLogsEntry() {
  const router = useRouter();
  const theme = useTheme();
  const { view } = useUnsyncedDailyLogs();
  const count = view.state === 'ready' ? view.items.length : null;
  const needsAttention = count !== null && count > 0;

  const summary =
    view.state === 'error'
      ? t('dailyLogs.errors.local_read_failed')
      : count === null
        ? t('common.loading')
        : count === 0
          ? t('dailyLogs.unsynced.none')
          : t('dailyLogs.unsynced.some');

  return (
    <View
      style={[styles.card, { borderColor: needsAttention || view.state === 'error' ? theme.danger : theme.border }]}
      accessibilityLiveRegion="polite">
      <ThemedText type="smallBold">
        {count === null ? t('dailyLogs.unsynced.title') : `${t('dailyLogs.unsynced.title')} (${count})`}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {summary}
      </ThemedText>
      <Button
        variant={needsAttention ? 'primary' : 'secondary'}
        label={t('dailyLogs.unsynced.open')}
        onPress={() => router.push('/daily-logs/unsynced')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.two,
  },
});
