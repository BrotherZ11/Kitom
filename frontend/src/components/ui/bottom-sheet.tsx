import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '@/components/ui/icon-button';
import { X } from '@/components/ui/icons';
import { scrimEntering, sheetEntering } from '@/components/ui/motion';
import { Text } from '@/components/ui/text';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';
import { layout, radius, spacing } from '@/theme/tokens';
import { useElevation } from '@/theme/use-elevation';

type BottomSheetProps = {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Acción fija abajo (botón principal), fuera del desplazamiento. */
  footer?: ReactNode;
};

/**
 * Hoja inferior (elegir entre opciones, formularios cortos): `surface-raised`, radio `xl` arriba,
 * asa, título y cerrar. Se cierra con «Cerrar», tocando el velo o con «atrás» en Android.
 */
export function BottomSheet({ visible, title, onClose, children, footer }: BottomSheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const raised = useElevation('3');

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Animated.View entering={scrimEntering} style={[styles.scrim, { backgroundColor: theme.scrim }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
            onPress={onClose}
          />
          <Animated.View
            entering={sheetEntering}
            accessibilityViewIsModal
            style={[
              styles.sheet,
              { backgroundColor: theme.surfaceRaised, paddingBottom: insets.bottom + layout.bottomCtaGap },
              raised,
            ]}>
            <View style={[styles.handle, { backgroundColor: theme.line }]} />
            <View style={styles.header}>
              <Text variant="title2" accessibilityRole="header" style={styles.title}>
                {title}
              </Text>
              <IconButton icon={X} accessibilityLabel={t('common.close')} onPress={onClose} />
            </View>
            <ScrollView
              style={styles.content}
              contentContainerStyle={styles.contentContainer}
              keyboardShouldPersistTaps="handled">
              {children}
            </ScrollView>
            {footer ? <View style={styles.footer}>{footer}</View> : null}
          </Animated.View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  scrim: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '90%',
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing['2'],
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radius.full,
    marginBottom: spacing['2'],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing['2'],
    paddingLeft: layout.screenGutter,
    paddingRight: spacing['2'],
  },
  title: {
    flex: 1,
  },
  content: {
    flexGrow: 0,
  },
  contentContainer: {
    paddingHorizontal: layout.screenGutter,
    paddingTop: spacing['2'],
    paddingBottom: spacing['4'],
    gap: spacing['4'],
  },
  footer: {
    paddingHorizontal: layout.screenGutter,
    paddingTop: spacing['3'],
    gap: spacing['3'],
  },
});
