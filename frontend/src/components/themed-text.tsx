import { StyleSheet } from 'react-native';

import { Text, type TextProps, type TextVariant } from '@/components/ui/text';
import type { ThemeColor } from '@/hooks/use-theme';
import { fontFamily } from '@/theme/tokens';

export type ThemedTextProps = Omit<TextProps, 'variant' | 'color'> & {
  type?: 'default' | 'small' | 'smallBold' | 'subtitle';
  themeColor?: ThemeColor;
};

/** Equivalencia de los tipos anteriores con la escala de marca. */
const VARIANTS: Record<NonNullable<ThemedTextProps['type']>, TextVariant> = {
  default: 'body',
  subtitle: 'title1',
  small: 'label',
  smallBold: 'label',
};

/**
 * Transitorio: texto de las pantallas aún no adaptadas al diseño v2, ya con la tipografía y los
 * colores de marca. Código nuevo usa `Text` (`components/ui/text.tsx`) con su `variant`.
 */
export function ThemedText({ type = 'default', themeColor, style, ...rest }: ThemedTextProps) {
  return (
    <Text
      variant={VARIANTS[type]}
      color={themeColor}
      style={[type === 'smallBold' && styles.semiBold, style]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  semiBold: {
    fontFamily: fontFamily.sans600,
  },
});
