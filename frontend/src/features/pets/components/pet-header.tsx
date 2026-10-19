import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { ChevronDown } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { PetPhoto } from '@/features/pets/components/pet-photo';
import type { Pet } from '@/features/pets/types';
import { tf } from '@/i18n';
import { size, spacing } from '@/theme/tokens';

type PetHeaderProps = {
  pet: Pick<Pet, 'name' | 'photo_path'>;
  /** Antetítulo (fecha de hoy) sobre el nombre. */
  overline: string;
  /** Abre el selector de mascota (hoja 3.9). */
  onPress: () => void;
  /** Acción a la derecha (en el diseño, «Consultar»; hoy no hay ninguna disponible). */
  right?: ReactNode;
};

/** Cabecera de Hoy (tableros 4.x): avatar, fecha y nombre con selector de mascota. */
export function PetHeader({ pet, overline, onPress, right }: PetHeaderProps) {
  return (
    <View style={styles.bar}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={tf('home.changePet', { name: pet.name })}
        onPress={onPress}
        style={styles.pet}>
        <PetPhoto name={pet.name} photoPath={pet.photo_path} size="md" />
        <View style={styles.text}>
          <Text variant="overline" color="inkMuted">
            {overline}
          </Text>
          <View style={styles.nameRow}>
            <Text variant="title3" numberOfLines={1} style={styles.name}>
              {pet.name}
            </Text>
            <Icon icon={ChevronDown} size={18} color="ink" />
          </View>
        </View>
      </Pressable>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    minHeight: size.touchMin,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing['2'],
  },
  pet: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing['3'],
    flexShrink: 1,
    minHeight: size.touchMin,
  },
  text: {
    flexShrink: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing['1'],
  },
  name: {
    flexShrink: 1,
  },
});
