import { StyleSheet, View } from 'react-native';

import { Chip } from '@/components/ui/chip';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import type { SpeciesField } from '@/features/species/species-fields';
import {
  setSpeciesText,
  speciesFormErrors,
  speciesText,
  toggleSpeciesChoice,
  toggleSpeciesMulti,
  type SpeciesFormValues,
} from '@/features/species/species-form';
import {
  speciesFieldErrorMessage,
  speciesFieldLabel,
  speciesOptionLabel,
  speciesUnitLabel,
} from '@/features/species/species-labels';
import { t } from '@/i18n';
import { spacing } from '@/theme/tokens';

type SpeciesFieldsSectionProps = {
  fields: readonly SpeciesField[];
  form: SpeciesFormValues;
  onChange: (update: (form: SpeciesFormValues) => SpeciesFormValues) => void;
  /** `YYYY-MM-DD` de hoy (las fechas no pueden ser futuras). */
  today: string;
  disabled?: boolean;
  /** Mostrar los errores de los campos de texto (al intentar guardar). */
  showErrors?: boolean;
};

/**
 * Campos propios de la especie (`features/species/species-fields.ts`) con los componentes de marca:
 * elecciones con `Chip` (pulsar la elegida la quita: todo es opcional), sí/no con dos chips (sin
 * marcar = sin indicar) y números o fechas con `TextField` y su unidad. Nunca solo color: el chip
 * elegido lleva check.
 */
export function SpeciesFieldsSection({ fields, form, onChange, today, disabled = false, showErrors = false }: SpeciesFieldsSectionProps) {
  const errors = showErrors ? speciesFormErrors(form, fields, today) : {};
  return (
    <View style={styles.container}>
      {fields.map((field) => (
        <SpeciesFieldInput
          key={field.code}
          field={field}
          form={form}
          onChange={onChange}
          disabled={disabled}
          error={errors[field.code] ? speciesFieldErrorMessage(field, errors[field.code]) : null}
        />
      ))}
    </View>
  );
}

function SpeciesFieldInput({
  field,
  form,
  onChange,
  disabled,
  error,
}: {
  field: SpeciesField;
  form: SpeciesFormValues;
  onChange: SpeciesFieldsSectionProps['onChange'];
  disabled: boolean;
  error: string | null;
}) {
  const label = speciesFieldLabel(field.code);
  const value = form.data[field.code];

  if (field.kind === 'integer' || field.kind === 'decimal' || field.kind === 'date') {
    const isDate = field.kind === 'date';
    return (
      <TextField
        label={label}
        optional
        value={speciesText(form, field.code)}
        onChangeText={(text) => onChange((current) => setSpeciesText(current, field.code, text))}
        keyboardType={isDate ? 'numbers-and-punctuation' : field.kind === 'decimal' ? 'decimal-pad' : 'number-pad'}
        placeholder={isDate ? t('speciesFields.datePlaceholder') : undefined}
        unit={isDate ? undefined : speciesUnitLabel(field) || undefined}
        maxLength={isDate ? 10 : 8}
        autoCorrect={false}
        editable={!disabled}
        error={error}
      />
    );
  }

  const options: { key: string; label: string; selected: boolean; onPress: () => void }[] =
    field.kind === 'boolean'
      ? [true, false].map((option) => ({
          key: String(option),
          label: option ? t('common.yes') : t('common.no'),
          selected: value === option,
          onPress: () => onChange((current) => toggleSpeciesChoice(current, field.code, option)),
        }))
      : field.kind === 'scale3'
        ? ([2, 3, 4] as const).map((option) => ({
            key: String(option),
            label: t(`speciesFields.scale3.${String(option) as '2' | '3' | '4'}`),
            selected: value === option,
            onPress: () => onChange((current) => toggleSpeciesChoice(current, field.code, option)),
          }))
        : (field.options ?? []).map((option) => ({
            key: option,
            label: speciesOptionLabel(field.code, option),
            selected: Array.isArray(value) ? value.includes(option) : value === option,
            onPress: () =>
              onChange((current) =>
                field.kind === 'multi_choice'
                  ? toggleSpeciesMulti(current, field, option)
                  : toggleSpeciesChoice(current, field.code, option)
              ),
          }));

  const multi = field.kind === 'multi_choice';
  return (
    <View style={styles.field}>
      <Text variant="label">{label}</Text>
      <View style={styles.options} accessibilityRole={multi ? undefined : 'radiogroup'} accessibilityLabel={label}>
        {options.map((option) => (
          <Chip
            key={option.key}
            accessibilityRole={multi ? 'checkbox' : 'radio'}
            accessibilityHint={option.selected && !multi ? t('dailyLogs.scale.clearHint') : undefined}
            label={option.label}
            selected={option.selected}
            disabled={disabled}
            onPress={option.onPress}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 22,
  },
  field: {
    gap: spacing['2'],
  },
  options: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing['2'],
  },
});
