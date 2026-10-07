import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { PetPhoto } from '@/features/pets/components/pet-photo';
import {
  formatBirthDate,
  formatList,
  formatSex,
  formatSterilized,
  formatWeight,
} from '@/features/pets/pet-format';
import type { Pet } from '@/features/pets/types';
import { t } from '@/i18n';

type PetDetailsProps = {
  pet: Pet;
  speciesName: string | null;
  isShared: boolean;
};

function DetailRow({ label, value }: { label: string; value: string | null }) {
  return (
    <View style={styles.row}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText>{value ?? t('common.notSpecified')}</ThemedText>
    </View>
  );
}

export function PetDetails({ pet, speciesName, isShared }: PetDetailsProps) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <PetPhoto name={pet.name} photoPath={pet.photo_path} size={96} />
        <ThemedText type="subtitle" style={styles.center}>
          {pet.name}
        </ThemedText>
        {isShared ? (
          <ThemedText type="small" themeColor="textSecondary">
            {t('pets.list.shared')}
          </ThemedText>
        ) : null}
      </View>

      <DetailRow label={t('pets.fields.species')} value={speciesName} />
      <DetailRow label={t('pets.fields.sex')} value={formatSex(pet)} />
      <DetailRow label={t('pets.fields.breed')} value={pet.breed} />
      <DetailRow label={t('pets.fields.birthDate')} value={formatBirthDate(pet.birth_date)} />
      <DetailRow label={t('pets.fields.weightKg')} value={formatWeight(pet.weight_kg)} />
      <DetailRow label={t('pets.fields.sterilized')} value={formatSterilized(pet.sterilized)} />
      <DetailRow
        label={t('pets.fields.knownConditions')}
        value={formatList(pet.known_conditions)}
      />
      <DetailRow label={t('pets.fields.allergies')} value={formatList(pet.allergies)} />
      <DetailRow label={t('pets.fields.temperamentNotes')} value={pet.temperament_notes} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.three,
  },
  header: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  center: {
    textAlign: 'center',
  },
  row: {
    gap: Spacing.half,
  },
});
