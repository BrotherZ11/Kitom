import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { ChevronDown, type LucideIcon } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { FieldError } from '@/components/ui/text-field';
import { useTheme } from '@/hooks/use-theme';
import { borderWidth, fontFamily, opacity, radius, size, spacing } from '@/theme/tokens';

type PickerFieldProps = {
  label: string;
  /** Valor elegido, ya formateado. */
  value: string;
  onPress: () => void;
  icon?: LucideIcon;
  /** Valor en mono (horas). */
  mono?: boolean;
  error?: string | null;
  disabled?: boolean;
};

/**
 * Campo que abre un selector (día, hora): mismo aspecto que `TextField` (52 de alto, borde de
 * control) con el valor y un chevron. Etiqueta arriba; el error, con icono, debajo.
 */
export function PickerField({ label, value, onPress, icon, mono = false, error, disabled = false }: PickerFieldProps) {
  const theme = useTheme();
  const border = error
    ? { width: borderWidth.focus, color: theme.dangerInk }
    : { width: borderWidth.control, color: theme.lineControl };
  return (
    <View style={styles.container}>
      <Text variant="label" maxFontSizeMultiplier={1.6}>
        {label}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value}`}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [
          styles.box,
          {
            backgroundColor: theme.surface,
            borderWidth: border.width,
            borderColor: border.color,
            paddingHorizontal: spacing['4'] - border.width,
          },
          pressed && { backgroundColor: theme.surfaceSunken },
          disabled && styles.disabled,
        ]}>
        {icon ? <Icon icon={icon} size="sm" color="inkMuted" /> : null}
        <Text style={[styles.value, mono && styles.mono]} numberOfLines={1} maxFontSizeMultiplier={1.6}>
          {value}
        </Text>
        <Icon icon={ChevronDown} size="sm" color="inkMuted" />
      </Pressable>
      {error ? <FieldError message={error} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 6,
  },
  box: {
    minHeight: size.input,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing['2'],
  },
  value: {
    flex: 1,
    fontSize: 16,
  },
  mono: {
    fontFamily: fontFamily.mono500,
  },
  disabled: {
    opacity: opacity.disabled,
  },
});
