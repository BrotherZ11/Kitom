import { StyleSheet, View } from 'react-native';

import { Chip } from '@/components/ui/chip';
import { Text } from '@/components/ui/text';
import { FieldError } from '@/components/ui/text-field';
import { spacing } from '@/theme/tokens';

export type Option<T extends string> = { value: T; label: string };

type OptionGroupProps<T extends string> = {
  label: string;
  options: Option<T>[];
  value: T | null;
  onChange: (value: T) => void;
  error?: string | null;
};

/**
 * Selección única entre opciones que no caben en un control segmentado (texto largo o más de 4):
 * chips con rol de radio. Para 2–4 opciones cortas, `SegmentedControl`.
 */
export function OptionGroup<T extends string>({ label, options, value, onChange, error }: OptionGroupProps<T>) {
  return (
    <View style={styles.container}>
      <Text variant="label">{label}</Text>
      <View style={styles.options} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((option) => (
          <Chip
            key={option.value}
            accessibilityRole="radio"
            label={option.label}
            selected={option.value === value}
            onPress={() => onChange(option.value)}
          />
        ))}
      </View>
      {error ? <FieldError message={error} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing['2'],
  },
  options: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing['2'],
  },
});
