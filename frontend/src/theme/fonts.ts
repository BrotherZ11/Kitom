import { HankenGrotesk_400Regular } from '@expo-google-fonts/hanken-grotesk/400Regular';
import { HankenGrotesk_500Medium } from '@expo-google-fonts/hanken-grotesk/500Medium';
import { HankenGrotesk_600SemiBold } from '@expo-google-fonts/hanken-grotesk/600SemiBold';
import { IBMPlexMono_500Medium } from '@expo-google-fonts/ibm-plex-mono/500Medium';

import { fontFamily } from '@/theme/tokens';

/**
 * Fuentes de marca para `useFonts` (layout raíz). Solo los cuatro cortes de `fontFamily` (tokens):
 * se importan por peso para no empaquetar el resto. Las claves son los nombres de familia que usan
 * los estilos de `typography`; en Android el peso va en la familia, no en `fontWeight`.
 */
export const brandFonts = {
  [fontFamily.sans400]: HankenGrotesk_400Regular,
  [fontFamily.sans500]: HankenGrotesk_500Medium,
  [fontFamily.sans600]: HankenGrotesk_600SemiBold,
  [fontFamily.mono500]: IBMPlexMono_500Medium,
};
