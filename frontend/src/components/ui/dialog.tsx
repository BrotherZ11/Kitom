import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { popEntering, scrimEntering } from '@/components/ui/motion';
import { Text } from '@/components/ui/text';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';
import { layout, radius, spacing } from '@/theme/tokens';
import { useElevation } from '@/theme/use-elevation';

type DialogProps = {
  visible: boolean;
  /** Pregunta con el objeto concreto («¿Eliminar el perfil de Kika?»). */
  title: string;
  /** Consecuencia de la acción. */
  message?: string;
  /** Repite el verbo del título («Eliminar perfil»); nunca «Sí» ni «Aceptar». */
  confirmLabel: string;
  cancelLabel?: string;
  /** `danger` para acciones destructivas. */
  tone?: 'default' | 'danger';
  /** Acción en curso: se bloquea cerrar y repetir. */
  loading?: boolean;
  /** Error de la última confirmación (ya traducido); el diálogo sigue abierto. */
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  /** Contenido extra entre el mensaje y los botones (p. ej. lista de consecuencias). */
  children?: ReactNode;
};

/**
 * Diálogo de confirmación (docs/design/componentes/Dialog): solo para decisiones que no se deshacen.
 * Botones apilados: confirmar arriba, cancelar debajo. Velo, botón «atrás» de Android y «Cancelar»
 * cierran sin hacer nada (salvo mientras carga).
 */
export function Dialog({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel = t('common.cancel'),
  tone = 'default',
  loading = false,
  error,
  onConfirm,
  onCancel,
  children,
}: DialogProps) {
  const theme = useTheme();
  const raised = useElevation('3');
  const cancel = () => {
    if (!loading) onCancel();
  };

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent onRequestClose={cancel}>
      <Animated.View entering={scrimEntering} style={[styles.scrim, { backgroundColor: theme.scrim }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel={cancelLabel}
          onPress={cancel}
        />
        <Animated.View
          entering={popEntering}
          accessibilityViewIsModal
          accessibilityRole="alert"
          style={[styles.dialog, { backgroundColor: theme.surfaceRaised }, raised]}>
          <View style={styles.text}>
            <Text variant="title3" accessibilityRole="header">
              {title}
            </Text>
            {message ? <Text color="inkMuted">{message}</Text> : null}
          </View>
          {children}
          {error ? <Alert tone="error" message={error} /> : null}
          <View style={styles.actions}>
            <Button
              label={confirmLabel}
              variant={tone === 'danger' ? 'danger' : 'primary'}
              loading={loading}
              onPress={onConfirm}
            />
            <Button label={cancelLabel} variant="secondary" disabled={loading} onPress={cancel} />
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    justifyContent: 'center',
    padding: layout.screenGutter,
  },
  dialog: {
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
    borderRadius: radius.xl,
    padding: spacing['6'],
    gap: spacing['4'],
  },
  text: {
    gap: spacing['2'],
  },
  actions: {
    gap: spacing['3'],
  },
});
