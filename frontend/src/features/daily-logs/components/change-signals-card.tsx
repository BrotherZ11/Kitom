import { StyleSheet, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { CircleAlert, TrendingDown, TrendingUp } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { TextLink } from '@/components/ui/text-link';
import type { ChangeSignal } from '@/features/daily-logs/change-signals';
import { t, tf } from '@/i18n';
import { spacing } from '@/theme/tokens';

function signalLabel(signal: ChangeSignal): string {
  if (signal.kind === 'unusual') return t('home.signals.unusual');
  return t(`home.signals.${signal.metric}.${signal.direction}`);
}

function signalIcon(signal: ChangeSignal) {
  if (signal.kind === 'unusual') return CircleAlert;
  return signal.direction === 'lower' ? TrendingDown : TrendingUp;
}

/**
 * «Algo ha cambiado estos días»: lo que cambia respecto a las semanas anteriores (`change-signals.ts`).
 * Icono + texto, nunca solo color. Solo compara registros: siempre recuerda que no es una valoración médica.
 */
export function ChangeSignalsCard({
  petName,
  signals,
  onOpenHistory,
}: {
  petName: string;
  signals: readonly ChangeSignal[];
  onOpenHistory: () => void;
}) {
  if (signals.length === 0) return null;
  return (
    <Card variant="warm" style={styles.card}>
      <View style={styles.heading}>
        <Text variant="bodyStrong" accessibilityRole="header">
          {t('home.signals.title')}
        </Text>
        <Text variant="caption" color="inkMuted">
          {tf('home.signals.intro', { name: petName })}
        </Text>
      </View>
      <View style={styles.list}>
        {signals.map((signal) => (
          <View key={signal.kind === 'unusual' ? 'unusual' : signal.metric} style={styles.row}>
            <Icon icon={signalIcon(signal)} size="sm" color="ink" />
            <Text style={styles.flex}>{signalLabel(signal)}</Text>
          </View>
        ))}
      </View>
      <Text variant="caption" color="inkMuted">
        {t('home.signals.note')}
      </Text>
      <TextLink label={t('home.signals.history')} onPress={onOpenHistory} />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing['5'],
    gap: spacing['3'],
    alignItems: 'flex-start',
  },
  heading: {
    gap: spacing['1'],
    alignSelf: 'stretch',
  },
  list: {
    gap: spacing['2'],
    alignSelf: 'stretch',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing['2'],
  },
  flex: {
    flex: 1,
  },
});
