import type { PropsWithChildren, ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { useTheme, type ThemeColor } from '@/hooks/use-theme';
import { layout, spacing } from '@/theme/tokens';

type ScreenProps = PropsWithChildren<{
  /** `center` (por defecto) para formularios cortos; `top` para listas y fichas. */
  align?: 'center' | 'top';
  /** Bordes de safe area a respetar; con cabecera de navegación, el superior ya lo cubre ella. */
  edges?: Edge[];
  /** Separación entre bloques; por defecto `space-5` (20). */
  gap?: number;
  /**
   * Acción principal fija abajo (fuera del desplazamiento), a `bottomCtaGap` del área segura
   * (GUIA-DE-MARCA.md › Espaciado). Normalmente un `Button` `lg`.
   */
  footer?: ReactNode;
  /** Fondo de la pantalla (y del pie); por defecto `bg`. La bienvenida usa `surfaceInverse`. */
  background?: ThemeColor;
}>;

/**
 * Margen superior del contenido bajo el área segura cuando no hay cabecera nativa: en el prototipo,
 * `.scr` empieza a 58 px del borde, que son 44 de barra de estado + 14.
 */
const TOP_GAP_UNDER_STATUS_BAR = 14;

/** Contenedor de pantalla: fondo, safe area, teclado, desplazamiento y margen lateral de 20. */
export function Screen({
  children,
  align = 'center',
  edges,
  gap = spacing['5'],
  footer,
  background = 'bg',
}: ScreenProps) {
  const theme = useTheme();
  const backgroundColor = theme[background];
  // Sin cabecera nativa, la pantalla gestiona el borde superior y sigue la rejilla del prototipo.
  const handlesTopEdge = !edges || edges.includes('top');

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor }]} edges={edges}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { gap },
            handlesTopEdge && styles.underStatusBar,
            align === 'top' && styles.top,
          ]}
          keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
        {footer ? <View style={[styles.footer, { backgroundColor }]}>{footer}</View> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: layout.screenGutter,
    paddingVertical: spacing['6'],
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
  },
  underStatusBar: {
    paddingTop: TOP_GAP_UNDER_STATUS_BAR,
  },
  top: {
    justifyContent: 'flex-start',
  },
  footer: {
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
    gap: spacing['3'],
    paddingHorizontal: layout.screenGutter,
    paddingTop: spacing['3'],
    paddingBottom: layout.bottomCtaGap,
  },
});
