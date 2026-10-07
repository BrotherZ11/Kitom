import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { usePetPhotoUrl } from '@/features/pets/hooks/use-pets';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

type PetPhotoProps = {
  name: string;
  photoPath: string | null;
  size: number;
};

/**
 * Foto de la mascota desde el bucket privado `pet-photos` (URL firmada bajo demanda). Sin foto, o si
 * no se puede firmar, muestra la inicial del nombre. La subida de fotos aún no está implementada.
 */
export function PetPhoto({ name, photoPath, size }: PetPhotoProps) {
  const theme = useTheme();
  const { data: url } = usePetPhotoUrl(photoPath);
  const shape = { width: size, height: size, borderRadius: size / 2 };

  if (url) {
    return (
      <Image
        source={{ uri: url }}
        style={shape}
        contentFit="cover"
        accessibilityLabel={`${t('pets.fields.photo')}: ${name}`}
      />
    );
  }

  return (
    <View
      style={[styles.placeholder, shape, { backgroundColor: theme.backgroundSelected }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <ThemedText type="smallBold" style={{ fontSize: size / 2.5, lineHeight: size / 2 }}>
        {name.trim().charAt(0).toUpperCase()}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
