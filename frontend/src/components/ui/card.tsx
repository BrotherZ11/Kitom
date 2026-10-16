import { StyleSheet, View, type ViewProps } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { borderWidth, layout, radius, spacing } from '@/theme/tokens';
import { useElevation } from '@/theme/use-elevation';

type CardProps = ViewProps & {
  /**
   * `raised` (por defecto): `surface` con elevación. `flat`: filete, para tarjetas dentro de otras.
   * `brand`: panel suave de marca (selección, progreso). `warm`: voz de la mascota y celebraciones.
   */
  variant?: 'raised' | 'flat' | 'brand' | 'warm';
  /** Sin relleno: para listas (`ListItem`) que llegan al borde. */
  flush?: boolean;
};

/** Tarjeta (radio `lg`, relleno `space-4`, separación interna `space-3`). */
export function Card({ variant = 'raised', flush = false, style, ...rest }: CardProps) {
  const theme = useTheme();
  const raised = useElevation('1');

  const surface =
    variant === 'brand'
      ? { backgroundColor: theme.surfaceBrand }
      : variant === 'warm'
        ? { backgroundColor: theme.surfaceWarm }
        : variant === 'flat'
          ? { backgroundColor: theme.surface, borderWidth: borderWidth.hairline, borderColor: theme.line }
          : [{ backgroundColor: theme.surface }, raised];

  return <View style={[styles.base, !flush && styles.padded, surface, style]} {...rest} />;
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.lg,
  },
  padded: {
    padding: layout.cardPadding,
    gap: spacing['3'],
  },
});
