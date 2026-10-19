import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { IconButton } from '@/components/ui/icon-button';
import { ChevronLeft } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { fontFamily, size, spacing } from '@/theme/tokens';

type TopBarProps = {
  /** Sin `onBack` no hay botón (p. ej. pantalla abierta desde un enlace, sin historial). */
  onBack?: () => void;
  /** Lo que hace el botón («Volver», «Cancelar y cerrar sesión»). */
  backLabel?: string;
  /** Título corto centrado (15/600), opcional. */
  title?: string;
  /** Acción a la derecha (p. ej. un `IconButton`). */
  right?: ReactNode;
};

/**
 * Barra superior propia (`.top` del prototipo) para pantallas sin cabecera de navegación: «atrás» a la
 * izquierda, título opcional centrado y acción a la derecha. Va dentro de `Screen`, que ya respeta el
 * área segura.
 */
export function TopBar({ onBack, backLabel, title, right }: TopBarProps) {
  return (
    <View style={styles.bar}>
      <View style={styles.side}>
        {onBack && backLabel ? <IconButton icon={ChevronLeft} accessibilityLabel={backLabel} onPress={onBack} /> : null}
      </View>
      {title ? (
        <Text style={styles.title} accessibilityRole="header" numberOfLines={2}>
          {title}
        </Text>
      ) : (
        <View style={styles.title} />
      )}
      <View style={[styles.side, styles.right]}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    minHeight: size.touchMin,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing['2'],
    // El botón de 44 tiene el icono centrado: se compensa para alinear el icono con el margen.
    marginHorizontal: -10,
  },
  side: {
    width: size.touchMin,
  },
  right: {
    alignItems: 'flex-end',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fontFamily.sans600,
  },
});
