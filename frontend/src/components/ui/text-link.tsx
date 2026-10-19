import { Pressable, StyleSheet, type PressableProps } from 'react-native';

import { Text } from '@/components/ui/text';
import { fontFamily, size } from '@/theme/tokens';

type TextLinkProps = Omit<PressableProps, 'children' | 'style'> & {
  label: string;
};

/** Alto de línea del enlace (`body`, 22): el área táctil se amplía hasta 44. */
const LINE_HEIGHT = 22;

/**
 * Enlace de texto dentro del contenido (`.link` del prototipo: 15/22, 600, `primary`), alineado con el
 * texto, sin relleno. Para acciones con forma de botón, `Button` `ghost`.
 */
export function TextLink({ label, accessibilityLabel, ...rest }: TextLinkProps) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel ?? label}
      hitSlop={{ top: (size.touchMin - LINE_HEIGHT) / 2, bottom: (size.touchMin - LINE_HEIGHT) / 2 }}
      style={styles.container}
      {...rest}>
      {({ pressed }) => (
        <Text color="primary" maxFontSizeMultiplier={1.6} style={[styles.text, pressed && styles.pressed]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'flex-start',
  },
  text: {
    fontFamily: fontFamily.sans600,
  },
  pressed: {
    textDecorationLine: 'underline',
  },
});
