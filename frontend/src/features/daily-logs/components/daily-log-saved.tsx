import { StyleSheet, View } from 'react-native';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { WeekRing } from '@/components/ui/week-ring';
import type { WeekOverview } from '@/features/daily-logs/week-overview';
import { t, tf } from '@/i18n';
import { spacing } from '@/theme/tokens';

type DailyLogSavedScreenProps = {
  petName: string;
  /** Semana con el registro recién guardado (servidor + dispositivo). */
  overview: WeekOverview;
  /** Sin conexión: está guardado en el móvil y se subirá solo (tablero 5.8). */
  savedLocally: boolean;
  onHome: () => void;
  onEdit: () => void;
};

/**
 * Registro guardado (tablero 5.3). La única celebración es el punto de hoy, que se rellena (320 ms;
 * sin animación con «reducir movimiento»). Las cifras salen de los registros, no de un objetivo.
 */
export function DailyLogSavedScreen({ petName, overview, savedLocally, onHome, onEdit }: DailyLogSavedScreenProps) {
  const text =
    overview.streak !== null && overview.streak >= 2
      ? tf('dailyLogs.savedScreen.streakText', { name: petName, count: overview.weekCount, streak: overview.streak })
      : tf('dailyLogs.savedScreen.text', { name: petName, count: overview.weekCount });

  return (
    <Screen
      align="top"
      footer={
        <>
          <Button label={t('dailyLogs.savedScreen.home')} onPress={onHome} />
          <Button variant="ghost" size="md" label={t('dailyLogs.savedScreen.edit')} onPress={onEdit} />
        </>
      }>
      <View style={styles.content}>
        <WeekRing
          days={overview.days}
          today="done"
          animateToday
          text={`${overview.weekCount}/7`}
          caption={t('dailyLogs.savedScreen.thisWeek')}
          size={200}
          accessibilityLabel={tf('dailyLogs.savedScreen.ringLabel', { count: overview.weekCount })}
        />
        <View style={styles.text}>
          <Text variant="title1" accessibilityRole="header" style={styles.center}>
            {t('dailyLogs.savedScreen.title')}
          </Text>
          <Text variant="bodyLg" color="inkMuted" style={[styles.center, styles.description]}>
            {text}
          </Text>
        </View>
        {savedLocally ? (
          <View style={styles.alert}>
            <Alert tone="info" title={t('dailyLogs.savedScreen.localTitle')} message={t('dailyLogs.savedScreen.localText')} />
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Tablero 5.3: el anillo empieza a 110 del borde (58 de la rejilla + 52).
  content: {
    alignItems: 'center',
    gap: 28,
    paddingTop: 52,
  },
  text: {
    alignItems: 'center',
    gap: spacing['2'],
  },
  center: {
    textAlign: 'center',
  },
  description: {
    maxWidth: 300,
  },
  alert: {
    alignSelf: 'stretch',
  },
});
