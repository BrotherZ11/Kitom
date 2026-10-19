import { Pressable, StyleSheet, View } from 'react-native';

import type { Option } from '@/components/ui/option-group';
import { Text } from '@/components/ui/text';
import { useTheme } from '@/hooks/use-theme';
import { fontFamily, opacity, radius, spacing } from '@/theme/tokens';
import { useElevation } from '@/theme/use-elevation';

type SegmentedControlProps<T extends string> = {
  /** Etiqueta visible encima; también nombra el grupo para lectores de pantalla. */
  label?: string;
  /** Nombre del grupo para lectores de pantalla cuando el título va fuera (p. ej. un `title-3`). */
  accessibilityLabel?: string;
  options: Option<T>[];
  /** `null` = ninguna elegida todavía. */
  value: T | null;
  onChange: (value: T) => void;
  disabled?: boolean;
};

/**
 * Control segmentado (docs/design/componentes/Select): 2–4 opciones excluyentes y cortas. La elegida
 * va sobre `surface` con elevación, además de texto en `ink` (no solo color).
 */
export function SegmentedControl<T extends string>({
  label,
  accessibilityLabel,
  options,
  value,
  onChange,
  disabled = false,
}: SegmentedControlProps<T>) {
  const theme = useTheme();
  const selectedElevation = useElevation('1');

  return (
    <View style={styles.container}>
      {label ? <Text variant="label">{label}</Text> : null}
      <View
        style={[styles.track, { backgroundColor: theme.surfaceSunken }]}
        accessibilityRole="radiogroup"
        accessibilityLabel={label ?? accessibilityLabel}>
        {options.map((option) => {
          const isSelected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ checked: isSelected, disabled }}
              disabled={disabled}
              onPress={() => onChange(option.value)}
              style={[
                styles.segment,
                isSelected && [{ backgroundColor: theme.surface }, selectedElevation],
                disabled && styles.disabled,
              ]}>
              <Text
                variant="label"
                color={isSelected ? 'ink' : 'inkMuted'}
                maxFontSizeMultiplier={1.6}
                style={styles.segmentText}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 6,
  },
  track: {
    flexDirection: 'row',
    gap: spacing['1'],
    padding: spacing['1'],
    borderRadius: radius.md,
  },
  segment: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing['2'],
    borderRadius: radius.sm,
  },
  segmentText: {
    fontFamily: fontFamily.sans600,
    fontSize: 14,
    textAlign: 'center',
  },
  disabled: {
    opacity: opacity.disabled,
  },
});
