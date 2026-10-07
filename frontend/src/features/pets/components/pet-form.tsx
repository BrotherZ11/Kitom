import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { OptionGroup, type Option } from '@/components/ui/option-group';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { PetBreedField, type BreedValues } from '@/features/pets/components/pet-breed-field';
import {
  hasPetFormErrors,
  toPetFields,
  validatePetForm,
  withSpecies,
  type PetFieldError,
  type PetFormErrors,
  type PetFormValues,
} from '@/features/pets/pet-form';
import { PET_SEX_VALUES, type PetFields, type PetSex, type Species } from '@/features/pets/types';
import { t } from '@/i18n';

type PetFormProps = {
  initialValues: PetFormValues;
  species: Species[];
  submitLabel: string;
  isSubmitting: boolean;
  /** Mensaje del último error al guardar (ya traducido). */
  submitError: string | null;
  onSubmit: (fields: PetFields) => void;
};

const STERILIZED_VALUES = ['yes', 'no', 'unknown'] as const;

function fieldError(error: PetFieldError | undefined): string | null {
  return error ? t(`pets.validation.${error}`) : null;
}

/** Formulario de creación/edición. Solo produce columnas editables (`PetFields`), nunca `owner_id`. */
export function PetForm({
  initialValues,
  species,
  submitLabel,
  isSubmitting,
  submitError,
  onSubmit,
}: PetFormProps) {
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState<PetFormErrors>({});

  const setField = <K extends keyof PetFormValues>(field: K, value: PetFormValues[K]) => {
    setValues((current) => ({ ...current, [field]: value }));
    // Al corregir un campo se oculta su error; la validación completa vuelve al enviar.
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  // La raza depende de la especie: al cambiarla se descarta una raza concreta incompatible.
  const setSpecies = (speciesId: string) => {
    setValues((current) => withSpecies(current, speciesId));
    setErrors((current) => ({ ...current, speciesId: undefined, breedId: undefined, breedText: undefined }));
  };

  const setBreed = (breed: BreedValues) => {
    setValues((current) => ({ ...current, ...breed }));
    setErrors((current) => ({ ...current, breedId: undefined, breedText: undefined }));
  };

  // Solo especies activas, más la actual si se edita una mascota de una especie ya desactivada.
  const speciesOptions: Option<string>[] = species
    .filter((item) => item.isActive || item.id === initialValues.speciesId)
    .map((item) => ({ value: item.id, label: item.name }));

  const sexOptions: Option<PetSex>[] = PET_SEX_VALUES.map((value) => ({
    value,
    label: t(`pets.sex.${value}`),
  }));

  const sterilizedOptions: Option<PetFormValues['sterilized']>[] = STERILIZED_VALUES.map(
    (value) => ({ value, label: t(`common.${value}`) })
  );

  const handleSubmit = () => {
    const nextErrors = validatePetForm(values);
    setErrors(nextErrors);
    if (hasPetFormErrors(nextErrors)) return;
    onSubmit(toPetFields(values));
  };

  return (
    <View style={styles.container}>
      <TextField
        label={t('pets.fields.name')}
        value={values.name}
        onChangeText={(text) => setField('name', text)}
        autoCapitalize="words"
        error={fieldError(errors.name)}
      />

      {speciesOptions.length > 0 ? (
        <OptionGroup
          label={t('pets.fields.species')}
          options={speciesOptions}
          value={values.speciesId || null}
          onChange={setSpecies}
          error={fieldError(errors.speciesId)}
        />
      ) : (
        <FormMessage message={t('pets.noSpecies')} />
      )}

      <PetBreedField
        speciesId={values.speciesId}
        value={{
          breedStatus: values.breedStatus,
          breedSource: values.breedSource,
          breedId: values.breedId,
          breedText: values.breedText,
        }}
        onChange={setBreed}
        errors={{ breedId: fieldError(errors.breedId), breedText: fieldError(errors.breedText) }}
      />

      <OptionGroup
        label={t('pets.fields.sex')}
        options={sexOptions}
        value={values.sex}
        onChange={(value) => setField('sex', value)}
      />

      <TextField
        label={t('pets.fields.birthDate')}
        value={values.birthDate}
        onChangeText={(text) => setField('birthDate', text)}
        placeholder="AAAA-MM-DD"
        hint={t('pets.fields.birthDateHint')}
        keyboardType="numbers-and-punctuation"
        autoCorrect={false}
        maxLength={10}
        error={fieldError(errors.birthDate)}
      />

      <TextField
        label={t('pets.fields.weightKg')}
        value={values.weightKg}
        onChangeText={(text) => setField('weightKg', text)}
        keyboardType="decimal-pad"
        inputMode="decimal"
        error={fieldError(errors.weightKg)}
      />

      <OptionGroup
        label={t('pets.fields.sterilized')}
        options={sterilizedOptions}
        value={values.sterilized}
        onChange={(value) => setField('sterilized', value)}
      />

      <TextField
        label={t('pets.fields.knownConditions')}
        value={values.knownConditions}
        onChangeText={(text) => setField('knownConditions', text)}
        hint={t('pets.fields.listHint')}
      />

      <TextField
        label={t('pets.fields.allergies')}
        value={values.allergies}
        onChangeText={(text) => setField('allergies', text)}
        hint={t('pets.fields.listHint')}
      />

      <TextField
        label={t('pets.fields.temperamentNotes')}
        value={values.temperamentNotes}
        onChangeText={(text) => setField('temperamentNotes', text)}
        multiline
      />

      <FormMessage message={submitError} />

      <Button
        label={submitLabel}
        loading={isSubmitting}
        disabled={speciesOptions.length === 0}
        onPress={handleSubmit}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.three,
  },
});
