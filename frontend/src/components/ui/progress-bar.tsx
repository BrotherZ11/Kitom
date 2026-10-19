import { StyleSheet, View } from 'react-native';

import { useTheme, type ThemeColor } from '@/hooks/use-theme';
import { radius } from '@/theme/tokens';

type ProgressBarProps = {
  /** Entre 0 y 1. */
  value: number;
  color?: ThemeColor;
  /** Si la barra transmite un dato, su texto (p. ej. «4 de 7 días»); si no, es decorativa. */
  accessibilityLabel?: string;
};

/** Barra de progreso (`.bar` del prototipo): 6 de alto, fondo hundido. */
export function ProgressBar({ value, color = 'primary', accessibilityLabel }: ProgressBarProps) {
  const theme = useTheme();
  const clamped = Math.max(0, Math.min(1, value));

  return (
    <View
      accessible={Boolean(accessibilityLabel)}
      accessibilityRole={accessibilityLabel ? 'progressbar' : undefined}
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={accessibilityLabel ? { min: 0, max: 100, now: Math.round(clamped * 100) } : undefined}
      accessibilityElementsHidden={!accessibilityLabel}
      importantForAccessibility={accessibilityLabel ? 'yes' : 'no-hide-descendants'}
      style={[styles.track, { backgroundColor: theme.surfaceSunken }]}>
      <View style={[styles.fill, { width: `${clamped * 100}%`, backgroundColor: theme[color] }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 6,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radius.full,
  },
});
