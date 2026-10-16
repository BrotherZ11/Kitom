import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import type { LucideIcon } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { useTheme } from '@/hooks/use-theme';
import { radius } from '@/theme/tokens';

type BannerProps = {
  message: string;
  icon?: LucideIcon;
  /** `neutral` (estado: pendiente de enviar) o `warning` (sin conexión). */
  tone?: 'neutral' | 'warning';
  /** Muestra un indicador de actividad a la derecha (enviando…). */
  busy?: boolean;
};

/** Banda de estado bajo la cabecera mientras dura una situación (sin conexión, pendiente de enviar). */
export function Banner({ message, icon, tone = 'neutral', busy = false }: BannerProps) {
  const theme = useTheme();
  const foreground = tone === 'warning' ? 'routineFg' : 'ink';

  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.container, { backgroundColor: tone === 'warning' ? theme.routineBg : theme.surfaceSunken }]}>
      {icon ? <Icon icon={icon} size="sm" color={foreground} /> : null}
      <Text color={foreground} style={styles.text}>
        {message}
      </Text>
      {busy ? <ActivityIndicator size="small" color={theme.inkMuted} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: radius.md,
  },
  text: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
});
