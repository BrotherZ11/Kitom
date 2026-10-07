import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { PetPhoto } from '@/features/pets/components/pet-photo';
import type { Pet } from '@/features/pets/types';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

type PetListItemProps = {
  pet: Pet;
  speciesName: string | null;
  /** Mascota de otro propietario a la que el usuario tiene acceso como co-tutor. */
  isShared: boolean;
  onPress: () => void;
};

export function PetListItem({ pet, speciesName, isShared, onPress }: PetListItemProps) {
  const theme = useTheme();
  const subtitle = [speciesName, isShared ? t('pets.list.shared') : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[pet.name, subtitle].filter(Boolean).join(', ')}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
        pressed && styles.pressed,
      ]}>
      <PetPhoto name={pet.name} photoPath={pet.photo_path} size={48} />
      <View style={styles.text}>
        <ThemedText type="smallBold">{pet.name}</ThemedText>
        {subtitle ? (
          <ThemedText type="small" themeColor="textSecondary">
            {subtitle}
          </ThemedText>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.two,
  },
  text: {
    flex: 1,
    gap: Spacing.half,
  },
  pressed: {
    opacity: 0.7,
  },
});
