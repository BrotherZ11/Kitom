import { StyleSheet, View } from 'react-native';

import { SegmentedControl } from '@/components/ui/segmented-control';
import { StepSelector } from '@/components/ui/step-selector';
import { Text } from '@/components/ui/text';
import { SCALE_VALUES, type ScaleField, type ScaleValue } from '@/features/daily-logs/daily-log-form';
import {
  DETAIL_OPTION_VALUES,
  detailOptionLabel,
  isDetailOptionValue,
  scaleOptionLabel,
  type DetailOptionValue,
} from '@/features/daily-logs/scale-labels';
import { t, tf } from '@/i18n';

type ScaleSelectorProps = {
  field: ScaleField;
  value: ScaleValue | null;
  onChange: (value: ScaleValue | null) => void;
  disabled?: boolean;
};

/**
 * Escala principal 1–5 (energía, apetito, ánimo, actividad; tablero 5.1). Empieza sin valor; tocar el
 * paso elegido lo deja sin indicar. Número + texto (nunca solo color).
 */
export function PrimaryScaleSelector({ field, value, onChange, disabled = false }: ScaleSelectorProps) {
  const label = t(`dailyLogs.fields.${field}`);
  return (
    <StepSelector
      label={label}
      valueLabel={value === null ? t('dailyLogs.scale.notAnswered') : scaleOptionLabel(field, value, 'short')}
      steps={SCALE_VALUES.map((step) => ({
        value: step,
        accessibilityLabel: `${label}: ${scaleOptionLabel(field, step, 'full')}`,
      }))}
      value={value}
      onChange={onChange}
      lowLabel={scaleOptionLabel(field, 1, 'short')}
      highLabel={scaleOptionLabel(field, 5, 'short')}
      selectedHint={t('dailyLogs.scale.clearHint')}
      disabled={disabled}
    />
  );
}

const OPTION_KEYS = DETAIL_OPTION_VALUES.map(String) as `${DetailOptionValue}`[];

/**
 * Detalle opcional con tres opciones (sueño, vocalizaciones, con personas y animales; tablero 5.2),
 * guardadas como 2/3/4. Un 1 o un 5 guardado antes no se convierte: no se marca ninguna opción, se
 * dice cuál era y se conserva mientras no se elija otra. Tocar la opción elegida la deja sin indicar.
 */
export function DetailScaleSelector({ field, value, onChange, disabled = false }: ScaleSelectorProps) {
  const label = t(`dailyLogs.fields.${field}`);
  const legacy = value !== null && !isDetailOptionValue(value) ? value : null;
  const selected = isDetailOptionValue(value) ? (String(value) as `${DetailOptionValue}`) : null;

  return (
    <View style={styles.container}>
      <Text variant="title3" accessibilityRole="header">
        {label}
      </Text>
      <SegmentedControl
        accessibilityLabel={label}
        options={OPTION_KEYS.map((key) => ({ value: key, label: detailOptionLabel(field, Number(key) as DetailOptionValue) }))}
        value={selected}
        disabled={disabled}
        onChange={(key) => {
          const next = Number(key) as DetailOptionValue;
          onChange(next === value ? null : next);
        }}
      />
      {legacy !== null ? (
        <Text variant="caption" color="inkMuted">
          {tf('dailyLogs.editor.legacyValue', { value: scaleOptionLabel(field, legacy, 'short') })}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
  },
});
