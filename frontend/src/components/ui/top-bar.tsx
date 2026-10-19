import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { IconButton } from '@/components/ui/icon-button';
import { ChevronLeft, type LucideIcon } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { t } from '@/i18n';
import { fontFamily, size, spacing } from '@/theme/tokens';

type TopBarProps = {
  /** Sin `onBack` no hay botón (p. ej. pantalla abierta desde un enlace, sin historial). */
  onBack?: () => void;
  /** Lo que hace el botón («Volver» por defecto, «Cerrar», «Cancelar y cerrar sesión»). */
  backLabel?: string;
  /** Título corto centrado (15/600), opcional. */
  title?: string;
  /** Línea bajo el título (`caption`, apagada): p. ej. la mascota en el registro (tablero 5.1). */
  subtitle?: string;
  /** Icono del botón izquierdo: `ChevronLeft` (volver) o `X` (cerrar una pantalla modal). */
  backIcon?: LucideIcon;
  /** Acción a la derecha (p. ej. un `IconButton`) o un texto corto (`TopBarText`). */
  right?: ReactNode;
};

/**
 * Barra superior propia (`.top` del prototipo) para pantallas sin cabecera de navegación: «atrás» a la
 * izquierda, título opcional centrado y acción a la derecha. Va dentro de `Screen`, que ya respeta el
 * área segura.
 */
export function TopBar({ onBack, backLabel = t('common.back'), title, subtitle, backIcon = ChevronLeft, right }: TopBarProps) {
  return (
    <View style={styles.bar}>
      <View style={styles.side}>
        {onBack ? <IconButton icon={backIcon} accessibilityLabel={backLabel} onPress={onBack} /> : null}
      </View>
      {title && subtitle ? (
        <View style={styles.titleBlock} accessible accessibilityRole="header">
          <Text style={styles.centered} numberOfLines={1}>
            {title}
          </Text>
          <Text variant="caption" color="inkMuted" style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
      ) : title ? (
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
  titleBlock: {
    flex: 1,
  },
  centered: {
    textAlign: 'center',
    fontFamily: fontFamily.sans600,
  },
  subtitle: {
    textAlign: 'center',
  },
  rightText: {
    marginRight: 10,
  },
});

/**
 * Texto corto a la derecha de la barra («2/4», «Opcional»): alineado con el margen de la pantalla (la
 * barra se desplaza 10 a cada lado para centrar los iconos de 44).
 */
export function TopBarText({ text, mono = false, accessibilityLabel }: { text: string; mono?: boolean; accessibilityLabel?: string }) {
  return (
    <Text
      variant={mono ? 'data' : 'caption'}
      color="inkMuted"
      numberOfLines={1}
      accessibilityLabel={accessibilityLabel}
      style={styles.rightText}>
      {text}
    </Text>
  );
}
