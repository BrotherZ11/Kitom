import { View } from 'react-native';

import type { LucideIcon } from '@/components/ui/icons';
import { useTheme, type ThemeColor } from '@/hooks/use-theme';
import { iconSize } from '@/theme/tokens';

type IconProps = {
  icon: LucideIcon;
  /** Tamaño de los tokens (`iconSize`) o en píxeles. Por defecto `md` (24). */
  size?: keyof typeof iconSize | number;
  color?: ThemeColor;
};

/**
 * Icono Lucide con el trazo de marca (2 px, terminaciones redondas). Decorativo: oculto a lectores de
 * pantalla; quien lo usa pone el texto o el `accessibilityLabel` del control (nunca solo el icono).
 * El `View` lleva la ocultación (en web, `aria-hidden`); el SVG no admite esas props.
 */
export function Icon({ icon: IconComponent, size = 'md', color = 'ink' }: IconProps) {
  const theme = useTheme();
  const pixels = typeof size === 'number' ? size : iconSize[size];
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <IconComponent size={pixels} color={theme[color]} strokeWidth={2} />
    </View>
  );
}
