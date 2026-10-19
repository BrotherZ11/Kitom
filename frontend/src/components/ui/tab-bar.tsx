import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Check, Plus, type LucideIcon } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { useTheme } from '@/hooks/use-theme';
import { borderWidth, fontFamily, opacity, radius, spacing } from '@/theme/tokens';

export type TabBarItem = {
  key: string;
  label: string;
  icon: LucideIcon;
  selected: boolean;
  onPress: () => void;
};

/**
 * Acción central «Registrar» (no es un destino). `pending`: punto sol (hoy sin registro); `done`:
 * «Hecho», abre la edición del de hoy; `unavailable`: sin mascota no hay nada que registrar.
 */
export type TabBarAction = {
  state: 'pending' | 'done' | 'unavailable';
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
};

type TabBarProps = {
  /** Destinos en orden; la acción va en el centro (`items.length / 2`). */
  items: readonly TabBarItem[];
  action: TabBarAction;
  accessibilityLabel: string;
  /** Área segura inferior (indicador de inicio / barra de gestos). */
  bottomInset: number;
};

/** Altura útil de la barra (tablero: 90 = 6 + 50 + 34 de área segura del iPhone). */
const CONTENT_HEIGHT = 50;
/** Sin área segura (web, Android con botones): un margen mínimo bajo las etiquetas. */
const MIN_BOTTOM_PADDING = spacing['2'];

/**
 * Barra inferior de cinco posiciones (docs/design/componentes/TabBar, PANTALLAS.md §1): Hoy ·
 * Historial · Registrar · Agenda · Perfil. Pastilla `surfaceBrand` en el destino activo; la acción
 * central es un botón primario (o `surfaceBrand` si hoy ya está hecho).
 */
export function TabBar({ items, action, accessibilityLabel, bottomInset }: TabBarProps) {
  const theme = useTheme();
  const middle = Math.floor(items.length / 2);

  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.bar,
        {
          backgroundColor: theme.surface,
          borderTopColor: theme.line,
          paddingBottom: Math.max(bottomInset, MIN_BOTTOM_PADDING),
        },
      ]}>
      {items.slice(0, middle).map((item) => (
        <TabButton key={item.key} item={item} />
      ))}
      <ActionButton action={action} />
      {items.slice(middle).map((item) => (
        <TabButton key={item.key} item={item} />
      ))}
    </View>
  );
}

function TabButton({ item }: { item: TabBarItem }) {
  const theme = useTheme();
  const color = item.selected ? 'primary' : 'inkMuted';

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: item.selected }}
      accessibilityLabel={item.label}
      onPress={item.onPress}
      style={({ pressed }) => [styles.tab, pressed && styles.pressed]}>
      <View style={[styles.pill, item.selected && { backgroundColor: theme.surfaceBrand }]}>
        <Icon icon={item.icon} size={22} color={color} />
      </View>
      <Text color={color} style={[styles.label, item.selected && styles.labelSelected]} numberOfLines={1}>
        {item.label}
      </Text>
    </Pressable>
  );
}

function ActionButton({ action }: { action: TabBarAction }) {
  const theme = useTheme();
  const done = action.state === 'done';
  const unavailable = action.state === 'unavailable';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={action.accessibilityLabel}
      accessibilityState={{ disabled: unavailable }}
      disabled={unavailable}
      onPress={action.onPress}
      style={({ pressed }) => [styles.tab, pressed && styles.pressed, unavailable && styles.disabled]}>
      <View style={[styles.fab, { backgroundColor: done ? theme.surfaceBrand : theme.primary }]}>
        <Icon icon={done ? Check : Plus} size={22} color={done ? 'primary' : 'onPrimary'} />
        {action.state === 'pending' ? (
          <View style={[styles.sun, { backgroundColor: theme.accent, borderColor: theme.surface }]} />
        ) : null}
      </View>
      <Text color={done ? 'primary' : 'ink'} style={[styles.label, styles.labelSelected]} numberOfLines={1}>
        {action.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    paddingTop: 6,
    paddingHorizontal: spacing['2'],
    borderTopWidth: borderWidth.hairline,
  },
  tab: {
    flex: 1,
    minWidth: 0,
    height: CONTENT_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    borderRadius: radius.md,
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: opacity.disabled,
  },
  pill: {
    width: 52,
    height: 28,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontFamily: fontFamily.sans500,
    fontSize: 11,
    lineHeight: 14,
  },
  labelSelected: {
    fontFamily: fontFamily.sans600,
  },
  fab: {
    width: 56,
    height: 36,
    marginTop: -4,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Punto de 11 con un anillo de 2 del color de la barra (en el tablero, `box-shadow` por fuera).
  sun: {
    position: 'absolute',
    top: -5,
    right: 2,
    width: 15,
    height: 15,
    borderRadius: radius.full,
    borderWidth: 2,
  },
});
