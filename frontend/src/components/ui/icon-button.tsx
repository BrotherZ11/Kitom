import { Pressable, StyleSheet, type PressableProps } from 'react-native';
import Animated from 'react-native-reanimated';

import { Icon } from '@/components/ui/icon';
import type { LucideIcon } from '@/components/ui/icons';
import { PressedOverlay } from '@/components/ui/pressed-overlay';
import { usePressFeedback } from '@/components/ui/use-press-feedback';
import { useTheme, type ThemeColor } from '@/hooks/use-theme';
import { opacity, radius, size } from '@/theme/tokens';
import { useElevation } from '@/theme/use-elevation';

type IconButtonProps = Omit<PressableProps, 'children' | 'style'> & {
  icon: LucideIcon;
  /** Obligatorio: el icono solo no dice qué hace. */
  accessibilityLabel: string;
  /** `plain` (transparente) o `soft` (superficie con sombra, sobre fotos o cabeceras de color). */
  variant?: 'plain' | 'soft';
  color?: ThemeColor;
};

/** Botón de solo icono, 44×44 (cerrar, volver, editar…). */
export function IconButton({
  icon,
  variant = 'plain',
  color = 'ink',
  disabled,
  onPressIn,
  onPressOut,
  ...rest
}: IconButtonProps) {
  const theme = useTheme();
  const softElevation = useElevation('1');
  const feedback = usePressFeedback();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPressIn={(event) => {
        feedback.onPressIn();
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        feedback.onPressOut();
        onPressOut?.(event);
      }}
      {...rest}>
      {({ pressed }) => (
        <Animated.View
          style={[
            styles.base,
            variant === 'soft' && [{ backgroundColor: theme.surface }, softElevation],
            disabled && styles.disabled,
            feedback.animatedStyle,
          ]}>
          {pressed ? (
            <PressedOverlay borderRadius={radius.full} />
          ) : null}
          <Icon icon={icon} color={color} />
        </Animated.View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    width: size.touchMin,
    height: size.touchMin,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: opacity.disabled,
  },
});
