import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { ChevronRight, type LucideIcon } from '@/components/ui/icons';
import { PressedOverlay } from '@/components/ui/pressed-overlay';
import { Text } from '@/components/ui/text';
import { useTheme } from '@/hooks/use-theme';
import { borderWidth, fontFamily, radius, size, spacing } from '@/theme/tokens';

type ListItemProps = {
  title: string;
  subtitle?: string;
  /** Valor a la derecha («Normal», «12,4 kg»). */
  value?: string;
  /** Icono Lucide en una placa de marca a la izquierda. */
  icon?: LucideIcon;
  /** Elemento propio a la izquierda (avatar, foto); sustituye al icono. */
  leading?: ReactNode;
  onPress?: () => void;
  /** Filete inferior: todas las filas de un grupo menos la última. */
  divider?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
};

/**
 * Fila de lista (56 de alto mínimo). Pulsable si recibe `onPress` (con chevron). Va dentro de una
 * `Card flush` o sobre el fondo; el texto envuelve, nunca se corta.
 */
export function ListItem({
  title,
  subtitle,
  value,
  icon,
  leading,
  onPress,
  divider = false,
  accessibilityLabel,
  accessibilityHint,
}: ListItemProps) {
  const theme = useTheme();

  const content = (pressed: boolean) => (
    <View
      style={[
        styles.row,
        divider && { borderBottomWidth: borderWidth.hairline, borderBottomColor: theme.line },
      ]}>
      {pressed ? (
        <PressedOverlay />
      ) : null}
      {leading ??
        (icon ? (
          <View style={[styles.iconTile, { backgroundColor: theme.surfaceBrand }]}>
            <Icon icon={icon} size="sm" color="primary" />
          </View>
        ) : null)}
      <View style={styles.text}>
        <Text variant="bodyStrong">{title}</Text>
        {subtitle ? (
          <Text variant="label" color="inkMuted" style={styles.subtitle}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? <Text color="inkMuted">{value}</Text> : null}
      {onPress ? <Icon icon={ChevronRight} size="sm" color="inkMuted" /> : null}
    </View>
  );

  if (!onPress) {
    return (
      <View accessible accessibilityLabel={accessibilityLabel}>
        {content(false)}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? [title, subtitle, value].filter(Boolean).join(', ')}
      accessibilityHint={accessibilityHint}
      onPress={onPress}>
      {({ pressed }) => content(pressed)}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: size.listRow,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing['3'],
    paddingVertical: 10,
    paddingHorizontal: spacing['4'],
  },
  iconTile: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
    gap: 2,
  },
  subtitle: {
    fontFamily: fontFamily.sans400,
  },
});
