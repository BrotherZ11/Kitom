import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { usePetPhotoUrl } from '@/features/pets/hooks/use-pet-photo';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

type PetPhotoProps = {
  name: string;
  photoPath: string | null;
  size: number;
  /** URI local (foto elegida aún sin guardar); tiene prioridad sobre la foto guardada. */
  previewUri?: string | null;
};

/**
 * Foto de la mascota desde el bucket privado `pet-photos` (URL firmada bajo demanda). Sin foto, o si
 * no se puede firmar, muestra la inicial del nombre. Subir/cambiar/quitar: `PetPhotoEditor`.
 */
export function PetPhoto({ name, photoPath, size, previewUri = null }: PetPhotoProps) {
  const theme = useTheme();
  const { data: url } = usePetPhotoUrl(previewUri ? null : photoPath);
  const shape = { width: size, height: size, borderRadius: size / 2 };

  if (previewUri) {
    return (
      <Image
        source={{ uri: previewUri }}
        style={shape}
        contentFit="cover"
        accessibilityLabel={`${t('pets.photo.preview')}: ${name}`}
      />
    );
  }

  if (url && photoPath) {
    return (
      <Image
        // La caché de imagen va por path: renovar la URL firmada no vuelve a descargar la foto.
        source={{ uri: url, cacheKey: photoPath }}
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
