import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Check } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { useTheme } from '@/hooks/use-theme';
import { borderWidth, opacity, radius, size, spacing } from '@/theme/tokens';

type CheckboxProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Texto visible a la derecha; también es la etiqueta accesible. */
  label: string;
  disabled?: boolean;
};

/**
 * Casilla de verificación (`.check` del prototipo, tablero 2.3): caja de 24 con borde de control;
 * marcada, relleno `primary` y check (no solo color). Toda la fila es pulsable (≥ 44 de alto).
 */
export function Checkbox({ checked, onChange, label, disabled = false }: CheckboxProps) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed, disabled && styles.disabled]}>
      <View
        style={[
          styles.box,
          checked
            ? { backgroundColor: theme.primary, borderColor: theme.primary }
            : { borderColor: theme.lineControl, backgroundColor: theme.surface },
        ]}>
        {checked ? <Icon icon={Check} size={16} color="onPrimary" /> : null}
      </View>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing['3'],
    minHeight: size.touchMin,
    paddingVertical: spacing['1'],
  },
  box: {
    width: 24,
    height: 24,
    borderRadius: radius.xs,
    borderWidth: borderWidth.focus,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  label: {
    flex: 1,
  },
  pressed: {
    opacity: 0.85,
  },
  disabled: {
    opacity: opacity.disabled,
  },
});
