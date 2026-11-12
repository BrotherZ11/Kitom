import { StyleSheet, View } from 'react-native';

import { useTheme, type ThemeColor } from '@/hooks/use-theme';
import { radius } from '@/theme/tokens';

export type DistributionCounts = { below: number; usual: number; above: number };

type DistributionBarProps = {
  counts: DistributionCounts;
  /** Color de la serie (los extremos); «como siempre» va siempre en el gris de las gráficas. */
  color: ThemeColor;
  height?: number;
};

/**
 * Reparto de días en tres grupos (por debajo de lo habitual · como siempre · por encima), como barra
 * horizontal. Es decorativa: quien la usa pone al lado los números en texto y la descripción para
 * lectores de pantalla. Para no depender del color, «por encima» va solo con borde (sin relleno) y los tramos
 * van separados. Sin valores, una barra vacía.
 */
export function DistributionBar({ counts, color, height = 10 }: DistributionBarProps) {
  const theme = useTheme();
  const total = counts.below + counts.usual + counts.above;
  const segments = [
    { key: 'below', value: counts.below, style: { backgroundColor: theme[color] } },
    { key: 'usual', value: counts.usual, style: { backgroundColor: theme.chartGrid } },
    {
      key: 'above',
      value: counts.above,
      style: { backgroundColor: theme.surface, borderColor: theme[color], borderWidth: 2 },
    },
  ].filter((segment) => segment.value > 0);

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.track, { height, backgroundColor: total === 0 ? theme.surfaceSunken : 'transparent' }]}>
      {segments.map((segment) => (
        <View key={segment.key} style={[styles.segment, { flexGrow: segment.value }, segment.style]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    gap: 2,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  segment: {
    flexBasis: 0,
    borderRadius: radius.full,
  },
});
