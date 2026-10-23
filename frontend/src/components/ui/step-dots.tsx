import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { radius } from '@/theme/tokens';

type StepDotsProps = {
  /** Paso actual, desde 1. */
  step: number;
  total: number;
  /** «Paso 2 de 3». */
  accessibilityLabel: string;
};

/** Indicador de pasos (`.dots` del prototipo): el actual, alargado en `primary`. */
export function StepDots({ step, total, accessibilityLabel }: StepDotsProps) {
  const theme = useTheme();
  return (
    <View style={styles.row} accessible accessibilityRole="progressbar" accessibilityLabel={accessibilityLabel}>
      {Array.from({ length: total }, (_, index) => (
        <View
          key={index}
          style={[
            styles.dot,
            index + 1 === step ? { width: 20, backgroundColor: theme.primary } : { backgroundColor: theme.line },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: radius.full,
  },
});
