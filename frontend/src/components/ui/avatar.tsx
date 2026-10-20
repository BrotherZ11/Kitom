import { Image, type ImageSource } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useTheme } from '@/hooks/use-theme';
import { fontFamily, size as sizes } from '@/theme/tokens';

const SIZES = { sm: sizes.avatarSm, md: sizes.avatarMd, lg: sizes.avatarLg, xl: sizes.avatarXl } as const;

type AvatarProps = {
  /** Nombre: da la inicial cuando no hay imagen. */
  name: string;
  /** Imagen (p. ej. URL firmada con `cacheKey`); sin ella, la inicial. */
  source?: ImageSource | null;
  /** Tamaño de los tokens (32/40/64/96) o en píxeles. */
  size?: keyof typeof SIZES | number;
  /** Fondo de la inicial: `brand` (por defecto) o `warm`. */
  tone?: 'brand' | 'warm';
  /** Texto para lectores de pantalla de la imagen; sin imagen, el avatar es decorativo. */
  accessibilityLabel?: string;
};

/**
 * Avatar circular. Sin foto, la inicial del nombre: nunca una silueta de perro o gato
 * (docs/design/componentes/PetCard). Si la imagen no se puede descargar (sin conexión, URL firmada
 * caducada), también la inicial; una imagen nueva (otra URL) se vuelve a intentar.
 */
export function Avatar({ name, source, size = 'md', tone = 'brand', accessibilityLabel }: AvatarProps) {
  const theme = useTheme();
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const pixels = typeof size === 'number' ? size : SIZES[size];
  const shape = { width: pixels, height: pixels, borderRadius: pixels / 2 };
  const uri = source?.uri ?? null;

  if (source && (uri === null || uri !== failedUri)) {
    return (
      <Image
        source={source}
        style={shape}
        contentFit="cover"
        accessibilityLabel={accessibilityLabel}
        onError={() => setFailedUri(uri)}
      />
    );
  }

  const fontSize = Math.round(pixels * 0.375);
  return (
    <View
      style={[styles.placeholder, shape, { backgroundColor: tone === 'warm' ? theme.surfaceWarm : theme.surfaceBrand }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <Text
        color={tone === 'warm' ? 'warmInk' : 'primary'}
        allowFontScaling={false}
        style={{ fontFamily: fontFamily.sans600, fontSize, lineHeight: Math.round(fontSize * 1.25) }}>
        {name.trim().charAt(0).toLocaleUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
