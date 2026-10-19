import type { ReactNode } from 'react';
import { Pressable, StyleSheet, type PressableProps } from 'react-native';
import Animated from 'react-native-reanimated';

import { Icon } from '@/components/ui/icon';
import { Check, type LucideIcon } from '@/components/ui/icons';
import { PressedOverlay } from '@/components/ui/pressed-overlay';
import { Text } from '@/components/ui/text';
import { usePressFeedback } from '@/components/ui/use-press-feedback';
import { useTheme } from '@/hooks/use-theme';
import { borderWidth, fontFamily, opacity, radius, size, spacing } from '@/theme/tokens';

type ChipProps = Omit<PressableProps, 'children' | 'style'> & {
  label: string;
  /** Elegido: fondo de marca, borde `primary` e icono de check (no solo color). */
  selected?: boolean;
  /** Icono a la izquierda cuando no está elegido (elegido, siempre el check). */
  icon?: LucideIcon;
  /** Marca propia antes del texto, siempre visible (p. ej. el punto de color de una serie). */
  marker?: ReactNode;
};

/**
 * Chip (docs/design/componentes/Select): selección múltiple (etiquetas del registro) o acción rápida
 * («Todo como siempre»). 36 de alto con área táctil de 44. Quien lo usa fija `accessibilityRole`
 * (`checkbox` por defecto si es seleccionable, `radio` en grupos de una sola opción).
 */
export function Chip({
  label,
  selected,
  icon,
  marker,
  disabled,
  accessibilityRole,
  onPressIn,
  onPressOut,
  ...rest
}: ChipProps) {
  const theme = useTheme();
  const feedback = usePressFeedback();
  const isSelectable = selected !== undefined;
  const leadingIcon = selected ? Check : icon;

  return (
    <Pressable
      accessibilityRole={accessibilityRole ?? (isSelectable ? 'checkbox' : 'button')}
      accessibilityLabel={label}
      accessibilityState={isSelectable ? { checked: selected, disabled: Boolean(disabled) } : { disabled: Boolean(disabled) }}
      disabled={disabled}
      hitSlop={(size.touchMin - 36) / 2}
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
            selected
              ? { backgroundColor: theme.surfaceBrand, borderWidth: borderWidth.control, borderColor: theme.primary }
              : { backgroundColor: theme.surface, borderWidth: borderWidth.hairline, borderColor: theme.line },
            disabled && styles.disabled,
            feedback.animatedStyle,
          ]}>
          {pressed ? (
            <PressedOverlay />
          ) : null}
          {leadingIcon ? <Icon icon={leadingIcon} size={16} color={selected ? 'primary' : 'ink'} /> : null}
          {marker}
          <Text
            variant="label"
            color={selected ? 'primary' : 'ink'}
            maxFontSizeMultiplier={1.6}
            style={styles.text}>
            {label}
          </Text>
        </Animated.View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: spacing['1'],
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  text: {
    fontFamily: fontFamily.sans500,
    fontSize: 14,
  },
  disabled: {
    opacity: opacity.disabled,
  },
});
