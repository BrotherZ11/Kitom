import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Camera, Flame, Lock, Medal as MedalIcon, PawPrint, Trophy, type LucideIcon } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import type { Badge } from '@/features/achievements/achievements-model';
import { useTheme } from '@/hooks/use-theme';
import { radius } from '@/theme/tokens';

/** Icono de cada logro del catálogo (`achievements_catalog.code`). */
const ICONS: Record<string, LucideIcon> = {
  first_log: PawPrint,
  streak_7: Flame,
  first_photo_scan: Camera,
  streak_30: Trophy,
};

/**
 * Medalla (`.medal` del prototipo): conseguida en sol, en progreso con «4/7» en laguna claro y por
 * conseguir en gris con candado. El estado también va en el texto de la tarjeta (no solo color).
 */
export function Medal({ badge, big = false }: { badge: Badge; big?: boolean }) {
  const theme = useTheme();
  const diameter = big ? 112 : 56;
  const style =
    badge.state === 'earned'
      ? { backgroundColor: theme.accent }
      : badge.state === 'progress'
        ? { backgroundColor: theme.surfaceBrand }
        : { backgroundColor: theme.surfaceSunken };
  return (
    <View
      style={[styles.medal, style, { width: diameter, height: diameter }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      {badge.state === 'earned' ? (
        <Icon icon={ICONS[badge.code] ?? MedalIcon} size={big ? 52 : 26} color="onAccent" />
      ) : badge.state === 'progress' && badge.progress ? (
        <Text variant={big ? 'dataLg' : 'data'} color="primary">{`${badge.progress.count}/${badge.progress.total}`}</Text>
      ) : badge.state === 'progress' ? (
        <Icon icon={ICONS[badge.code] ?? MedalIcon} size={big ? 52 : 26} color="primary" />
      ) : (
        <Icon icon={Lock} size={big ? 44 : 22} color="inkSubtle" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  medal: {
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
