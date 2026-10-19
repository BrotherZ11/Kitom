import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated from 'react-native-reanimated';

import { Icon } from '@/components/ui/icon';
import type { LucideIcon } from '@/components/ui/icons';
import { PressedOverlay } from '@/components/ui/pressed-overlay';
import { Text } from '@/components/ui/text';
import { usePressFeedback } from '@/components/ui/use-press-feedback';
import { useTheme, type ThemeColor } from '@/hooks/use-theme';
import { radius, size as sizes, spacing, typography } from '@/theme/tokens';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerGhost';
export type ButtonSize = 'lg' | 'md' | 'sm';

type ButtonProps = Omit<PressableProps, 'children' | 'style'> & {
  /** Verbo + objeto, 1–3 palabras, sin punto. */
  label: string;
  variant?: ButtonVariant;
  /** `lg` (52) y `md` (44) ocupan todo el ancho; `sm` (36) se ajusta al texto. */
  size?: ButtonSize;
  /** Icono Lucide a la izquierda del texto. */
  icon?: LucideIcon;
  /** Elemento propio a la izquierda (p. ej. un logotipo de terceros); sustituye a `icon`. */
  leading?: ReactNode;
  loading?: boolean;
  /** Texto mientras carga, en gerundio («Guardando…»). Por defecto, `label`. */
  loadingLabel?: string;
  style?: StyleProp<ViewStyle>;
};

const VARIANTS: Record<ButtonVariant, { background: ThemeColor | null; foreground: ThemeColor; bordered?: boolean }> = {
  primary: { background: 'primary', foreground: 'onPrimary' },
  secondary: { background: 'surface', foreground: 'ink', bordered: true },
  ghost: { background: null, foreground: 'primary' },
  danger: { background: 'danger', foreground: 'onDanger' },
  dangerGhost: { background: null, foreground: 'dangerInk' },
};

const SIZES = {
  lg: { height: sizes.buttonLg, fontSize: typography.button.fontSize, paddingHorizontal: spacing['5'], radius: radius.md },
  md: { height: sizes.buttonMd, fontSize: 15, paddingHorizontal: spacing['5'], radius: radius.md },
  sm: { height: sizes.buttonSm, fontSize: 14, paddingHorizontal: 14, radius: radius.sm },
} as const;

/**
 * Botón de marca (docs/design/componentes/Button). Un solo `primary` por pantalla; `danger` solo para
 * confirmar una acción destructiva. Cargando: spinner a la izquierda y mismo tamaño, sin repetir
 * envíos (`disabled` mientras dure). Deshabilitado: fondo hundido y texto atenuado.
 */
export function Button({
  label,
  variant = 'primary',
  size = 'lg',
  icon,
  leading,
  loading = false,
  loadingLabel,
  disabled,
  style,
  onPressIn,
  onPressOut,
  accessibilityLabel,
  ...rest
}: ButtonProps) {
  const theme = useTheme();
  const feedback = usePressFeedback();
  const isDisabled = Boolean(disabled) || loading;
  const isInactive = Boolean(disabled) && !loading;
  const spec = VARIANTS[variant];
  const metrics = SIZES[size];

  const background = isInactive
    ? spec.background === null
      ? 'transparent'
      : theme.surfaceSunken
    : spec.background === null
      ? 'transparent'
      : theme[spec.background];
  const foreground: ThemeColor = isInactive ? 'inkSubtle' : spec.foreground;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      // `sm` mide 36: el área táctil llega a 44.
      hitSlop={size === 'sm' ? (sizes.touchMin - sizes.buttonSm) / 2 : undefined}
      onPressIn={(event) => {
        feedback.onPressIn();
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        feedback.onPressOut();
        onPressOut?.(event);
      }}
      style={[size === 'sm' ? styles.auto : styles.block, style]}
      {...rest}>
      {({ pressed }) => (
        <Animated.View
          style={[
            styles.base,
            {
              minHeight: metrics.height,
              paddingHorizontal: metrics.paddingHorizontal,
              borderRadius: metrics.radius,
              backgroundColor:
                pressed && variant === 'primary' && !isDisabled ? theme.primaryPressed : background,
            },
            spec.bordered && !isInactive && { borderWidth: 1.5, borderColor: theme.line },
            loading && styles.loading,
            feedback.animatedStyle,
          ]}>
          {/* Capa de pulsado (salvo `primary`, que cambia de color). */}
          {pressed && variant !== 'primary' && !isDisabled ? (
            <PressedOverlay />
          ) : null}
          {loading ? (
            <ActivityIndicator size="small" color={theme[foreground]} />
          ) : leading ? (
            leading
          ) : icon ? (
            <Icon icon={icon} size={18} color={foreground} />
          ) : null}
          <Text
            variant="button"
            color={foreground}
            maxFontSizeMultiplier={1.6}
            style={[styles.label, { fontSize: metrics.fontSize }]}>
            {loading && loadingLabel ? loadingLabel : label}
          </Text>
        </Animated.View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  block: {
    alignSelf: 'stretch',
  },
  auto: {
    alignSelf: 'flex-start',
  },
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing['2'],
    overflow: 'hidden',
  },
  label: {
    textAlign: 'center',
    flexShrink: 1,
  },
  loading: {
    opacity: 0.9,
  },
});
