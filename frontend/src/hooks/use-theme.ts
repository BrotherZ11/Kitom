import { useAppTheme } from '@/theme/theme-provider';
import type { ColorTokens } from '@/theme/tokens';

export type ThemeColor = keyof ColorTokens;

/** Colores del tema activo (claro u oscuro): los tokens de marca (`src/theme/tokens.ts`). */
export function useTheme(): ColorTokens {
  return useAppTheme().colors;
}
