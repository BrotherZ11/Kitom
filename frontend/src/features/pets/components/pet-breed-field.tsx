import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { OptionGroup, type Option } from '@/components/ui/option-group';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { BreedPicker } from '@/features/pets/components/breed-picker';
import type { PetFormValues } from '@/features/pets/pet-form';
import { BREED_STATUS_VALUES, type BreedStatus } from '@/features/pets/types';
import { t } from '@/i18n';

export type BreedValues = Pick<PetFormValues, 'breedStatus' | 'breedSource' | 'breedId' | 'breedText'>;

type PetBreedFieldProps = {
  speciesId: string;
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
export function PetBreedField({ speciesId, value, onChange, errors }: PetBreedFieldProps) {
  const statusOptions: Option<BreedStatus>[] = BREED_STATUS_VALUES.map((status) => ({
    value: status,
    label: t(`pets.breedStatus.${status}`),
  }));

  const setStatus = (status: BreedStatus) => {
    if (status === value.breedStatus) return;
    onChange({ ...UNANSWERED, breedStatus: status });
  };

  const isKnown = value.breedStatus === 'known';

  return (
    <View style={styles.container}>
      <OptionGroup
        label={t('pets.fields.breed')}
        options={statusOptions}
        value={value.breedStatus}
        onChange={setStatus}
      />

      {value.breedStatus === null ? (
        <ThemedText type="small" themeColor="textSecondary">
          {t('pets.breedPicker.hint')}
        </ThemedText>
      ) : null}

      {isKnown && speciesId === '' ? (
        <ThemedText type="small" themeColor="textSecondary">
          {t('pets.breedPicker.chooseSpeciesFirst')}
        </ThemedText>
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
            hint={t('pets.breedPicker.otherHint')}
            error={errors.breedText}
          />
          <Button
            variant="link"
            label={t('pets.breedPicker.backToCatalog')}
            onPress={() => onChange({ ...value, breedSource: 'catalog', breedText: '' })}
          />
        </View>
      ) : null}

      {value.breedStatus !== null ? (
        <Button
          variant="link"
          label={t('pets.breedPicker.clear')}
          onPress={() => onChange(UNANSWERED)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.two,
  },
});
