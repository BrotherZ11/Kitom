import { Pressable, StyleSheet, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { PressedOverlay } from '@/components/ui/pressed-overlay';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Sparkline } from '@/components/ui/sparkline';
import { Text } from '@/components/ui/text';
import { TextLink } from '@/components/ui/text-link';
import type { ScaleValue } from '@/features/daily-logs/daily-log-form';
import { scaleValueLabel } from '@/features/daily-logs/scale-labels';
import { TREND_THRESHOLD, type WeekOverview } from '@/features/daily-logs/week-overview';
import { useTheme, type ThemeColor } from '@/hooks/use-theme';
import { t, tf } from '@/i18n';
import { borderWidth, spacing } from '@/theme/tokens';

/** Series de la semana en Hoy (tablero 4.3): color + patrón de trazo, nunca solo color. */
export const WEEK_SERIES = [
  { field: 'energy', color: 'chartEnergy', dash: undefined },
  { field: 'appetite', color: 'chartAppetite', dash: '5 3' },
  { field: 'mood', color: 'chartMood', dash: '1 3' },
] as const satisfies readonly { field: keyof WeekOverview['series']; color: ThemeColor; dash: string | undefined }[];

/**
 * «Así verás su evolución» (tableros 4.1 y 4.6): progreso hacia los 3 registros con los que el
 * historial empieza a mostrar tendencias. Sin conclusiones: solo cuenta registros.
 */
export function EvolutionCard({ petName, loggedCount }: { petName: string; loggedCount: number }) {
  const count = Math.min(loggedCount, TREND_THRESHOLD);
  const almost = count === TREND_THRESHOLD - 1;

  return (
    <Card variant="flat" style={styles.evolution}>
      <View style={styles.between}>
        <Text variant="bodyStrong" style={styles.flex}>
          {almost ? t('home.evolution.almostTitle') : t('home.evolution.startTitle')}
        </Text>
        <Text variant="data" color="inkMuted" accessibilityLabel={tf('home.evolution.progress', { count })}>
          {`${count}/${TREND_THRESHOLD}`}
        </Text>
      </View>
      <ProgressBar value={count / TREND_THRESHOLD} />
      <Text variant="caption" color="inkMuted">
        {almost ? t('home.evolution.almostText') : tf('home.evolution.startText', { name: petName })}
      </Text>
    </Card>
  );
}

/**
 * «Su semana» (tablero 4.3): energía, apetito y ánimo de los últimos 7 días. Al lado, el último valor
 * registrado tal cual (sin valoraciones); los días sin registro quedan en blanco en la línea.
 */
export function WeekSummary({ overview, onOpenHistory }: { overview: WeekOverview; onOpenHistory: () => void }) {
  const theme = useTheme();

  return (
    <View style={styles.section}>
      <View style={styles.between}>
        <Text variant="title3" accessibilityRole="header">
          {t('home.week.title')}
        </Text>
        <TextLink label={t('home.week.seeHistory')} onPress={onOpenHistory} />
      </View>
      <Card flush>
        {WEEK_SERIES.map(({ field, color, dash }, index) => {
          const values = overview.series[field];
          const last = [...values].reverse().find((value) => value !== null) ?? null;
          const caption =
            last === null
              ? t('home.week.none')
              : tf('home.week.last', { value: scaleValueLabel(field, last as ScaleValue) });
          const label = t(`dailyLogs.fields.${field}`);
          return (
            <Pressable
              key={field}
              accessibilityRole="button"
              accessibilityLabel={`${label}. ${caption}`}
              onPress={onOpenHistory}>
              {({ pressed }) => (
                <View
                  style={[
                    styles.row,
                    index < WEEK_SERIES.length - 1 && {
                      borderBottomWidth: borderWidth.hairline,
                      borderBottomColor: theme.line,
                    },
                  ]}>
                  {pressed ? <PressedOverlay /> : null}
                  <View style={styles.flex}>
                    <Text variant="label">{label}</Text>
                    <Text variant="caption" color="inkMuted">
                      {caption}
                    </Text>
                  </View>
                  <Sparkline values={values} color={color} dash={dash} />
                </View>
              )}
            </Pressable>
          );
        })}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  evolution: {
    gap: 10,
  },
  section: {
    gap: 10,
  },
  between: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing['3'],
  },
  flex: {
    flex: 1,
  },
  row: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing['3'],
    paddingVertical: spacing['2'],
    paddingHorizontal: spacing['4'],
  },
});
