import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { Users } from '@/components/ui/icons';
import { ListItem } from '@/components/ui/list-item';
import { Tag } from '@/components/ui/tag';
import { Text } from '@/components/ui/text';
import {
  formatBirthDate,
  formatList,
  formatSex,
  formatSterilized,
  formatWeight,
} from '@/features/pets/pet-format';
import type { Pet } from '@/features/pets/types';
import { t } from '@/i18n';
import { spacing } from '@/theme/tokens';

type PetDetailsProps = {
  pet: Pet;
  speciesName: string | null;
  /** Raza ya formateada (`formatBreed`); `null` = sin contestar. */
  breedLabel: string | null;
  isShared: boolean;
  /**
   * Cabecera con foto y nombre (p. ej. `PetPhotoEditor`). Sin ella solo se muestran los datos (el
   * perfil 3.6 ya lleva su propia cabecera).
   */
  photo?: ReactNode;
};

/**
 * Todos los datos de la ficha, también los no indicados («Sin indicar»), para que se vea qué falta y
 * para quien solo puede consultarla (co-tutor de solo lectura).
 */
export function PetDetails({ pet, speciesName, breedLabel, isShared, photo }: PetDetailsProps) {
  const rows: { label: string; value: string | null }[] = [
    { label: t('pets.fields.species'), value: speciesName },
    { label: t('pets.fields.sex'), value: formatSex(pet) },
    { label: t('pets.fields.breed'), value: breedLabel },
    { label: t('pets.fields.birthDate'), value: formatBirthDate(pet.birth_date) },
    { label: t('pets.fields.weightKg'), value: formatWeight(pet.weight_kg) },
    { label: t('pets.fields.sterilized'), value: formatSterilized(pet.sterilized) },
    { label: t('pets.fields.knownConditions'), value: formatList(pet.known_conditions) },
    { label: t('pets.fields.allergies'), value: formatList(pet.allergies) },
    { label: t('pets.fields.temperamentNotes'), value: pet.temperament_notes },
  ];

  return (
    <View style={styles.container}>
      {photo ? (
        <View style={styles.header}>
          {photo}
          <Text variant="title1" style={styles.center} accessibilityRole="header">
            {pet.name}
          </Text>
          {isShared ? <Tag label={t('pets.list.shared')} tone="brand" icon={Users} /> : null}
        </View>
      ) : null}
      <Card flush>
        {rows.map((row, index) => (
          <ListItem
            key={row.label}
            plain
            title={row.label}
            subtitle={row.value ?? t('common.notSpecified')}
            divider={index < rows.length - 1}
          />
        ))}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing['3'],
  },
  header: {
    alignItems: 'center',
    gap: spacing['2'],
  },
  center: {
    textAlign: 'center',
  },
});
