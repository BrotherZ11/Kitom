import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import type { LucideIcon } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { useTheme, type ThemeColor } from '@/hooks/use-theme';
import { fontFamily, radius, size } from '@/theme/tokens';

export type TagTone = 'neutral' | 'success' | 'brand' | 'accent' | 'danger';

const TONES: Record<TagTone, { background: ThemeColor; foreground: ThemeColor }> = {
  neutral: { background: 'surfaceSunken', foreground: 'inkMuted' },
  success: { background: 'successBg', foreground: 'successFg' },
  brand: { background: 'surfaceBrand', foreground: 'primary' },
  // «Hoy» y rachas: el sol es relleno, nunca color de texto.
  accent: { background: 'accent', foreground: 'onAccent' },
  // Algo necesita al usuario (no se pudo sincronizar, conflicto). No es urgencia veterinaria.
  danger: { background: 'dangerBg', foreground: 'dangerInk' },
};

type TagProps = {
  label: string;
  tone?: TagTone;
  icon?: LucideIcon;
};

/**
 * Etiqueta de estado (Guardado, Pendiente de enviar, Hoy). No usa los colores de urgencia
 * veterinaria: esos son de `UrgencyTag` (orientación con IA).
 */
export function Tag({ label, tone = 'neutral', icon }: TagProps) {
  const theme = useTheme();
  const spec = TONES[tone];

  return (
    <View style={[styles.container, { backgroundColor: theme[spec.background] }]}>
      {icon ? <Icon icon={icon} size={14} color={spec.foreground} /> : null}
      <Text variant="label" color={spec.foreground} style={styles.text} maxFontSizeMultiplier={1.6}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: size.chip,
    paddingHorizontal: 10,
    borderRadius: radius.xs,
  },
  text: {
    fontFamily: fontFamily.sans600,
  },
});
