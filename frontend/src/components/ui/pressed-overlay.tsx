import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { opacity } from '@/theme/tokens';

/**
 * Capa del estado pulsado (`opacity-pressed-overlay` sobre `ink`) para controles sin color propio de
 * pulsado. Va dentro del contenedor del control, que debe recortar (`overflow: 'hidden'`) o pasar su
 * radio.
 */
export function PressedOverlay({ borderRadius }: { borderRadius?: number }) {
  const theme = useTheme();
  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        styles.passThrough,
        { backgroundColor: theme.ink, opacity: opacity.pressedOverlay, borderRadius },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  passThrough: {
    pointerEvents: 'none',
  },
});
