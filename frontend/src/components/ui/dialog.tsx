import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import type { LucideIcon } from '@/components/ui/icons';
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
  /**
   * `danger` para acciones destructivas: «Cancelar» va arriba y la acción roja debajo (tableros 3.11
   * y 10.9), para que lo seguro sea lo primero.
   */
  tone?: 'default' | 'danger';
  /** Icono en una placa sobre el título (tablero 3.11: papelera sobre `danger-bg`). */
  icon?: LucideIcon;
  /** Acción en curso: se bloquea cerrar y repetir. */
  loading?: boolean;
  /** Error de la última confirmación (ya traducido); el diálogo sigue abierto. */
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  /**
   * Velo y «atrás» de Android; por defecto, `onCancel`. Cuando el botón secundario es la acción con
   * consecuencias («Salir sin guardar»), cerrar sin elegir debe ser lo seguro (seguir).
   */
  onDismiss?: () => void;
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
  icon,
  loading = false,
  error,
  onConfirm,
  onCancel,
  onDismiss,
  children,
}: DialogProps) {
  const theme = useTheme();
  const raised = useElevation('3');
  const cancel = () => {
    if (!loading) onCancel();
  };
  const dismiss = () => {
    if (!loading) (onDismiss ?? onCancel)();
  };
  const cancelButton = <Button label={cancelLabel} variant="secondary" disabled={loading} onPress={cancel} />;

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent onRequestClose={dismiss}>
      <Animated.View entering={scrimEntering} style={[styles.scrim, { backgroundColor: theme.scrim }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          onPress={dismiss}
        />
        <Animated.View
          entering={popEntering}
          accessibilityViewIsModal
          accessibilityRole="alert"
          style={[styles.dialog, { backgroundColor: theme.surfaceRaised }, raised]}>
          {icon ? (
            <View
              style={[styles.iconTile, { backgroundColor: tone === 'danger' ? theme.dangerBg : theme.surfaceBrand }]}>
              <Icon icon={icon} size={22} color={tone === 'danger' ? 'dangerInk' : 'primary'} />
            </View>
          ) : null}
          <View style={styles.text}>
            <Text variant="title2" accessibilityRole="header">
              {title}
            </Text>
            {message ? <Text color="inkMuted">{message}</Text> : null}
          </View>
          {children}
          {error ? <Alert tone="error" message={error} /> : null}
          <View style={styles.actions}>
            {tone === 'danger' ? cancelButton : null}
            <Button
              label={confirmLabel}
              variant={tone === 'danger' ? 'danger' : 'primary'}
              loading={loading}
              onPress={onConfirm}
            />
            {tone === 'danger' ? null : cancelButton}
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
  iconTile: {
    width: 40,
    height: 40,
    borderRadius: radius.md - 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    gap: 6,
  },
  actions: {
    gap: 10,
  },
});
