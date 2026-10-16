import type { ViewStyle } from 'react-native';

import { useAppTheme } from '@/theme/theme-provider';
import { borderWidth, elevation } from '@/theme/tokens';

/** `#RRGGBB` + opacidad → `rgba(…)`. */
function rgba(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

/**
 * Sombras de los tokens (`elevation`) como `boxShadow`, que la nueva arquitectura de React Native
 * aplica igual en iOS, Android y web (las props `shadow*` están obsoletas en web).
 */
const SHADOWS = Object.fromEntries(
  Object.entries(elevation).map(([level, token]) => [
    level,
    `0px ${token.shadowOffset.height}px ${token.shadowRadius}px ${rgba(token.shadowColor, token.shadowOpacity)}`,
  ])
) as Record<keyof typeof elevation, string>;

/**
 * Elevación de una superficie: sombra en el tema claro y, en el oscuro, un filete (`line`) en vez de
 * sombra (GUIA-DE-MARCA.md › Espaciado, forma y superficies).
 */
export function useElevation(level: keyof typeof elevation): ViewStyle {
  const { scheme, colors } = useAppTheme();
  return scheme === 'dark'
    ? { borderWidth: borderWidth.hairline, borderColor: colors.line }
    : { boxShadow: SHADOWS[level] };
}
