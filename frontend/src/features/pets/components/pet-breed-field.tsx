import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { OptionGroup, type Option } from '@/components/ui/option-group';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { BreedPicker } from '@/features/pets/components/breed-picker';
import { PET_BREED_TEXT_MAX_LENGTH, type PetFormValues } from '@/features/pets/pet-form';
import { BREED_STATUS_VALUES, type BreedStatus } from '@/features/pets/types';
import { t } from '@/i18n';
import { spacing } from '@/theme/tokens';

export type BreedValues = Pick<PetFormValues, 'breedStatus' | 'breedSource' | 'breedId' | 'breedText'>;

type PetBreedFieldProps = {
  speciesId: string;
  /** Especie elegida: en hámsteres, aves y reptiles la «raza» es el tipo de animal (`usesAnimalType`). */
  speciesCode?: string;
  value: BreedValues;
  onChange: (value: BreedValues) => void;
  errors: { breedId: string | null; breedText: string | null };
};

const UNANSWERED: BreedValues = {
  breedStatus: null,
  breedSource: 'catalog',
  breedId: '',
  breedText: '',
};

/**
 * Pregunta de raza, opcional y progresiva: primero el estado (con raza / mestizo / desconocida) y,
 * solo con raza, el buscador del catálogo o el texto libre «otra / no aparece». Sin elegir nada, la
 * respuesta queda «sin contestar» (`breed_status = null`).
 */
export function PetBreedField({ speciesId, speciesCode, value, onChange, errors }: PetBreedFieldProps) {
  const animalType = usesAnimalType(speciesCode);
  // Un tipo de animal no es «mestizo»: solo se sabe cuál es o no. Un valor guardado se sigue viendo.
  const statusOptions: Option<BreedStatus>[] = BREED_STATUS_VALUES.filter(
    (status) => !animalType || status !== 'mixed' || value.breedStatus === 'mixed'
  ).map((status) => ({
    value: status,
    label: animalType && status !== 'mixed' ? t(`pets.typeStatus.${status}`) : t(`pets.breedStatus.${status}`),
  }));

  const setStatus = (status: BreedStatus) => {
    if (status === value.breedStatus) return;
    onChange({ ...UNANSWERED, breedStatus: status });
  };

  const isKnown = value.breedStatus === 'known';

  return (
    <View style={styles.container}>
      <OptionGroup
        label={animalType ? t('pets.fields.animalType') : t('pets.fields.breed')}
        options={statusOptions}
        value={value.breedStatus}
        onChange={setStatus}
      />

      {value.breedStatus === null ? (
        <Text variant="caption" color="inkMuted">
          {t('pets.breedPicker.hint')}
        </Text>
      ) : null}

      {isKnown && speciesId === '' ? (
        <Text variant="caption" color="inkMuted">
          {t('pets.breedPicker.chooseSpeciesFirst')}
        </Text>
      ) : null}

      {isKnown && speciesId !== '' && value.breedSource === 'catalog' ? (
        <BreedPicker
          speciesId={speciesId}
          selectedBreedId={value.breedId}
          onSelect={(breedId) => onChange({ ...value, breedId })}
          onChooseOther={() => onChange({ ...value, breedSource: 'other', breedId: '' })}
          error={errors.breedId}
        />
      ) : null}

      {isKnown && speciesId !== '' && value.breedSource === 'other' ? (
        <View style={styles.container}>
          <TextField
            label={t('pets.fields.breedOther')}
            value={value.breedText}
            onChangeText={(breedText) => onChange({ ...value, breedText })}
            autoCapitalize="words"
            maxLength={PET_BREED_TEXT_MAX_LENGTH}
            hint={t('pets.breedPicker.otherHint')}
            error={errors.breedText}
          />
          <Button
            variant="ghost"
            label={t('pets.breedPicker.backToCatalog')}
            onPress={() => onChange({ ...value, breedSource: 'catalog', breedText: '' })}
          />
        </View>
      ) : null}

      {value.breedStatus !== null ? (
        <Button
          variant="ghost"
          size="md"
          label={t('pets.breedPicker.clear')}
          onPress={() => onChange(UNANSWERED)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing['2'],
  },
});

/** Especies en las que la «raza» del catálogo es el tipo de animal (sirio, periquito, gecko leopardo…). */
export function usesAnimalType(speciesCode: string | undefined): boolean {
  return speciesCode === 'hamster' || speciesCode === 'bird_other' || speciesCode === 'reptile_other';
}
