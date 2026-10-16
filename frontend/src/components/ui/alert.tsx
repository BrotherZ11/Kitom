import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Check, CircleAlert, Info, TriangleAlert, type LucideIcon } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { useTheme, type ThemeColor } from '@/hooks/use-theme';
import { fontFamily, radius, size, spacing } from '@/theme/tokens';

export type AlertTone = 'info' | 'success' | 'warning' | 'error';

type AlertProps = {
  tone: AlertTone;
  /** Qué ha pasado. */
  title?: string;
  /** Qué hacer. */
  message?: string;
  /** Icono propio (p. ej. sin conexión); por defecto, el del tono. */
  icon?: LucideIcon;
  action?: { label: string; onPress: () => void };
};

const TONES: Record<AlertTone, { background: ThemeColor; foreground: ThemeColor; icon: LucideIcon }> = {
  info: { background: 'observeBg', foreground: 'observeFg', icon: Info },
  success: { background: 'successBg', foreground: 'successFg', icon: Check },
  warning: { background: 'routineBg', foreground: 'routineFg', icon: TriangleAlert },
  error: { background: 'dangerBg', foreground: 'dangerInk', icon: CircleAlert },
};

/**
 * Alerta en línea (docs/design/componentes/Alert): icono + título + mensaje. Errores y avisos se
 * quedan hasta resolverse y se anuncian; los éxitos breves van en `Toast`.
 */
export function Alert({ tone, title, message, icon, action }: AlertProps) {
  const theme = useTheme();
  const spec = TONES[tone];
  const isUrgent = tone === 'error' || tone === 'warning';

  return (
    <View
      accessibilityRole={isUrgent ? 'alert' : undefined}
      accessibilityLiveRegion={isUrgent ? 'assertive' : 'polite'}
      style={[styles.container, { backgroundColor: theme[spec.background] }]}>
      <View style={styles.icon}>
        <Icon icon={icon ?? spec.icon} size="sm" color={spec.foreground} />
      </View>
      <View style={styles.text}>
        {title ? (
          <Text color={spec.foreground} style={[styles.body, styles.title]}>
            {title}
          </Text>
        ) : null}
        {message ? (
          <Text color={spec.foreground} style={styles.body}>
            {message}
          </Text>
        ) : null}
        {action ? (
          <Pressable
            accessibilityRole="button"
            onPress={action.onPress}
            hitSlop={spacing['3']}
            style={styles.action}>
            <Text color={spec.foreground} style={[styles.body, styles.title, styles.underline]}>
              {action.label}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: spacing['3'],
    paddingHorizontal: 14,
    borderRadius: radius.md,
  },
  icon: {
    // Alineado con la primera línea de texto (20 de alto).
    height: 20,
    justifyContent: 'center',
  },
  text: {
    flex: 1,
    gap: 2,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
  },
  title: {
    fontFamily: fontFamily.sans600,
  },
  action: {
    alignSelf: 'flex-start',
    minHeight: size.touchMin - spacing['3'] * 2,
    justifyContent: 'center',
    marginTop: spacing['1'],
  },
  underline: {
    textDecorationLine: 'underline',
  },
});
