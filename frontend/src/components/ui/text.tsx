import { Text as NativeText, type TextProps as NativeTextProps } from 'react-native';

import { useTheme, type ThemeColor } from '@/hooks/use-theme';
import { typography } from '@/theme/tokens';

export type TextVariant = keyof typeof typography;

export type TextProps = NativeTextProps & {
  /** Estilo de la escala tipográfica (`typography` de los tokens). Por defecto `body`. */
  variant?: TextVariant;
  /** Color del tema; por defecto `ink`. Texto secundario: `inkMuted`. */
  color?: ThemeColor;
};

/**
 * Texto de la app con la tipografía de marca. Respeta el tamaño de texto del sistema; en controles,
 * limitar el escalado con `maxFontSizeMultiplier={1.6}` (GUIA-DE-MARCA.md › Tipografía).
 */
export function Text({ variant = 'body', color = 'ink', style, ...rest }: TextProps) {
  const theme = useTheme();
  return <NativeText style={[typography[variant], { color: theme[color] }, style]} {...rest} />;
}
