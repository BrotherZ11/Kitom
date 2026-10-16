import type { PropsWithChildren, ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { useTheme } from '@/hooks/use-theme';
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
}>;

/** Contenedor de pantalla: fondo, safe area, teclado, desplazamiento y margen lateral de 20. */
export function Screen({ children, align = 'center', edges, gap = spacing['5'], footer }: ScreenProps) {
  const theme = useTheme();

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.bg }]} edges={edges}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[styles.content, { gap }, align === 'top' && styles.top]}
          keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
        {footer ? <View style={[styles.footer, { backgroundColor: theme.bg }]}>{footer}</View> : null}
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
