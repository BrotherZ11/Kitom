import { createContext, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui/icon';
import { Check } from '@/components/ui/icons';
import { popEntering } from '@/components/ui/motion';
import { Text } from '@/components/ui/text';
import { useTheme } from '@/hooks/use-theme';
import { fontFamily, layout, radius, spacing } from '@/theme/tokens';
import { useElevation } from '@/theme/use-elevation';

const TOAST_DURATION_MS = 4000;

type ToastOptions = {
  message: string;
  /** Acción para revertir lo hecho («Deshacer»). */
  action?: { label: string; onPress: () => void };
};

type ToastState = ToastOptions & { id: number };

const ToastContext = createContext<((options: ToastOptions) => void) | null>(null);

/**
 * Avisos breves de éxito (docs/design/componentes/Alert › Toast): abajo, 4 s, con «Deshacer» si se
 * puede revertir. Errores y avisos no van aquí: se quedan en pantalla hasta resolverse (`Alert`).
 * Un aviso nuevo sustituye al anterior.
 */
export function ToastProvider({ children }: PropsWithChildren) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const nextId = useRef(0);

  const show = (options: ToastOptions) => {
    nextId.current += 1;
    setToast({ ...options, id: nextId.current });
    AccessibilityInfo.announceForAccessibility(options.message);
  };

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast ? <ToastView key={toast.id} toast={toast} onDismiss={() => setToast(null)} /> : null}
    </ToastContext.Provider>
  );
}

/** Muestra un aviso breve de éxito. Solo dentro de `ToastProvider` (layout raíz). */
export function useToast() {
  const show = useContext(ToastContext);
  if (!show) throw new Error('useToast debe usarse dentro de ToastProvider');
  return show;
}

function ToastView({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const raised = useElevation('2');

  return (
    <View style={[styles.host, { bottom: insets.bottom + spacing['4'] }]}>
      <Animated.View
        entering={popEntering}
        accessibilityLiveRegion="polite"
        style={[styles.toast, { backgroundColor: theme.surfaceInverse }, raised]}>
        <Icon icon={Check} size="sm" color="inkInverse" />
        <Text color="inkInverse" style={styles.message}>
          {toast.message}
        </Text>
        {toast.action ? (
          <Pressable
            accessibilityRole="button"
            hitSlop={spacing['3']}
            onPress={() => {
              toast.action?.onPress();
              onDismiss();
            }}>
            <Text color="inkInverse" style={[styles.message, styles.action]}>
              {toast.action.label}
            </Text>
          </Pressable>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: spacing['4'],
    right: spacing['4'],
    alignItems: 'center',
    // Los toques fuera del aviso llegan a la pantalla.
    pointerEvents: 'box-none',
  },
  toast: {
    width: '100%',
    maxWidth: layout.maxContentWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: spacing['3'],
    paddingHorizontal: 14,
    borderRadius: radius.md,
  },
  message: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  action: {
    flex: 0,
    fontFamily: fontFamily.sans600,
    textDecorationLine: 'underline',
  },
});
