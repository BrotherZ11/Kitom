import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import {
  SCALE_VALUES,
  scaleKind,
  type ScaleField,
  type ScaleValue,
} from '@/features/daily-logs/daily-log-form';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

const RELATIVE_LABELS = ['much_less', 'less', 'usual', 'more', 'much_more'] as const;
const QUALITY_LABELS = ['very_bad', 'bad', 'normal', 'good', 'very_good'] as const;

function optionLabel(field: ScaleField, value: ScaleValue, length: 'short' | 'full'): string {
  return scaleKind(field) === 'quality'
    ? t(`dailyLogs.scale.quality.${length}.${QUALITY_LABELS[value - 1]}`)
    : t(`dailyLogs.scale.relative.${length}.${RELATIVE_LABELS[value - 1]}`);
}

type ScaleSelectorProps = {
  field: ScaleField;
  value: ScaleValue | null;
  onChange: (value: ScaleValue | null) => void;
  disabled?: boolean;
};

/**
 * Escala 1–5 de una pregunta del registro diario. Empieza sin valor; tocar la opción elegida la
 * deja sin indicar. Número + texto (nunca solo color) y etiqueta completa para lectores de pantalla.
 */
export function ScaleSelector({ field, value, onChange, disabled = false }: ScaleSelectorProps) {
  const theme = useTheme();
  const label = t(`dailyLogs.fields.${field}`);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="smallBold">{label}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {value === null ? t('dailyLogs.scale.notAnswered') : optionLabel(field, value, 'full')}
        </ThemedText>
      </View>
      <View style={styles.options} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {SCALE_VALUES.map((option) => {
          const isSelected = option === value;
          return (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityLabel={`${label}: ${optionLabel(field, option, 'full')}`}
              accessibilityHint={isSelected ? t('dailyLogs.scale.clearHint') : undefined}
              accessibilityState={{ checked: isSelected, disabled }}
              disabled={disabled}
              onPress={() => onChange(isSelected ? null : option)}
              style={[
                styles.option,
                {
                  borderColor: isSelected ? theme.tint : theme.border,
                  backgroundColor: isSelected ? theme.backgroundSelected : theme.backgroundElement,
                },
                disabled && styles.disabled,
              ]}>
              <ThemedText type={isSelected ? 'smallBold' : 'small'}>{option}</ThemedText>
              <ThemedText
                type="small"
                themeColor={isSelected ? 'text' : 'textSecondary'}
                numberOfLines={2}
                style={styles.optionText}>
                {optionLabel(field, option, 'short')}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.one,
  },
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  options: {
    flexDirection: 'row',
    gap: Spacing.one,
  },
  option: {
    flex: 1,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.half,
    borderWidth: 1,
    borderRadius: Spacing.two,
  },
  optionText: {
    textAlign: 'center',
    fontSize: 12,
    lineHeight: 15,
  },
  disabled: {
    opacity: 0.6,
  },
});
