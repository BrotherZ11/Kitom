import { useAppTheme } from '@/theme/theme-provider';
import type { ColorTokens } from '@/theme/tokens';

/**
 * Nombres de color anteriores a los tokens de marca, con su token equivalente. Ninguno puede llamarse
 * como un token (el antiguo `danger` tapaba al token `danger` en oscuro). Transitorio: las
 * pantallas que aún los usan pasan a los tokens al adaptarse al diseño (docs/design/PLAN_DESARROLLO.md);
 * código nuevo usa solo tokens (`colors.ink`, `colors.primary`…).
 */
const LEGACY_COLORS = {
  text: 'ink',
  textSecondary: 'inkMuted',
  background: 'bg',
  backgroundElement: 'surface',
  backgroundSelected: 'surfaceBrand',
  border: 'line',
  tint: 'primary',
  onTint: 'onPrimary',
  success: 'successFg',
} as const satisfies Record<string, keyof ColorTokens>;

export type LegacyColorName = keyof typeof LEGACY_COLORS;

// Falla al compilar si un nombre anterior coincide con un token.
const noTokenCollision: [Extract<LegacyColorName, keyof ColorTokens>] extends [never] ? true : never = true;
void noTokenCollision;
export type ThemeColor = keyof ColorTokens | LegacyColorName;
export type ThemeColors = ColorTokens & Record<LegacyColorName, string>;

/** Colores del tema activo: los tokens y, mientras dure la migración, los nombres anteriores. */
export function useTheme(): ThemeColors {
  const { colors } = useAppTheme();
  const legacy = Object.fromEntries(
    Object.entries(LEGACY_COLORS).map(([name, token]) => [name, colors[token]])
  ) as Record<LegacyColorName, string>;
  return { ...colors, ...legacy };
}
