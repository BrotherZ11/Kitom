import { Pressable, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { Text } from '@/components/ui/text';
import { usePressFeedback } from '@/components/ui/use-press-feedback';
import { useTheme } from '@/hooks/use-theme';
import { borderWidth, opacity, spacing } from '@/theme/tokens';

export type Step<T extends number> = {
  value: T;
  /** Texto completo del paso para lectores de pantalla («Energía: Mucho más»). */
  accessibilityLabel: string;
};

type StepSelectorProps<T extends number> = {
  /** Pregunta («Energía»), en `title-3`. */
  label: string;
  /** Texto del valor actual a la derecha («Como siempre», «Sin indicar»). */
  valueLabel: string;
  steps: Step<T>[];
  /** `null` = sin indicar. */
  value: T | null;
  /** Tocar el paso elegido lo deja sin indicar (`null`). */
  onChange: (value: T | null) => void;
  /** Extremos de la escala, bajo los pasos. */
  lowLabel: string;
  highLabel: string;
  /** Ayuda para el paso elegido (cómo deseleccionarlo). */
  selectedHint?: string;
  disabled?: boolean;
};

/**
 * Escala de pasos del registro diario (sustituye al slider; docs/design/componentes/WellnessSlider).
 * Número en mono + texto del valor arriba: el estado nunca depende solo del color.
 */
export function StepSelector<T extends number>({
  label,
  valueLabel,
  steps,
  value,
  onChange,
  lowLabel,
  highLabel,
  selectedHint,
  disabled = false,
}: StepSelectorProps<T>) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text variant="title3" style={styles.flexText}>
          {label}
        </Text>
        <Text variant="label" color="inkMuted" accessibilityLiveRegion="polite">
          {valueLabel}
        </Text>
      </View>
      <View style={styles.steps} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {steps.map((step) => (
          <StepButton
            key={step.value}
            step={step}
            selected={step.value === value}
            disabled={disabled}
            selectedHint={selectedHint}
            onPress={() => onChange(step.value === value ? null : step.value)}
          />
        ))}
      </View>
      <View style={styles.scale} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Text variant="caption" color="inkMuted">
          {lowLabel}
        </Text>
        <Text variant="caption" color="inkMuted" style={styles.highLabel}>
          {highLabel}
        </Text>
      </View>
    </View>
  );
}

type StepButtonProps<T extends number> = {
  step: Step<T>;
  selected: boolean;
  disabled: boolean;
  selectedHint?: string;
  onPress: () => void;
};

function StepButton<T extends number>({ step, selected, disabled, selectedHint, onPress }: StepButtonProps<T>) {
  const theme = useTheme();
  const feedback = usePressFeedback();

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={step.accessibilityLabel}
      accessibilityHint={selected ? selectedHint : undefined}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      onPressIn={feedback.onPressIn}
      onPressOut={feedback.onPressOut}
      style={styles.stepPressable}>
      <Animated.View
        style={[
          styles.step,
          selected
            ? { backgroundColor: theme.primary }
            : { backgroundColor: theme.surface, borderWidth: borderWidth.hairline, borderColor: theme.line },
          disabled && styles.disabled,
          feedback.animatedStyle,
        ]}>
        <Text variant="data" color={selected ? 'onPrimary' : 'inkMuted'} maxFontSizeMultiplier={1.6}>
          {String(step.value)}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
  },
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing['2'],
  },
  flexText: {
    flexShrink: 1,
  },
  steps: {
    flexDirection: 'row',
    gap: 6,
  },
  stepPressable: {
    flex: 1,
  },
  step: {
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scale: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing['2'],
  },
  highLabel: {
    textAlign: 'right',
  },
  disabled: {
    opacity: opacity.disabled,
  },
});
