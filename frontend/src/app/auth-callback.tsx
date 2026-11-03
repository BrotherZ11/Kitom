import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { MailCheck } from '@/components/ui/icons';
import { KitomSymbol } from '@/components/ui/kitom-symbol';
import { EmptyState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/features/auth/auth-context';
import {
  callbackDestination,
  redirectFlow,
  shouldCompleteRedirect,
  type CallbackOutcome,
} from '@/features/auth/auth-callback-plan';
import { authErrorMessage } from '@/features/auth/auth-errors';
import { completeAuthRedirect, type AuthRedirectResult } from '@/features/auth/auth-redirect';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';
import { spacing } from '@/theme/tokens';

/** Sin URL o sin respuesta en este tiempo, se ofrece salir (antes el indicador giraba para siempre). */
const STALLED_AFTER_MS = 15_000;

type Result = AuthRedirectResult | { status: 'skipped' };

/**
 * Destino de los enlaces de Supabase Auth (`kitom://auth-callback?…`). Disponible con y sin sesión
 * (layout raíz): sin sesión canjea cualquier enlace; con sesión, solo los de recuperación (p. ej. «Crear
 * contraseña» desde ajustes). Reglas en `features/auth/auth-callback-plan.ts`. Cuando hay sesión, la
 * pantalla sale sola: a `/update-password` si hay una recuperación pendiente o a la app; si no, muestra
 * el progreso o el motivo del fallo.
 */
export default function AuthCallbackScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { user, isRecoveringPassword } = useAuth();
  const isSignedIn = user !== null;
  const url = Linking.useLinkingURL();
  const [exchange, setExchange] = useState<AuthRedirectResult | null>(null);
  const [stalled, setStalled] = useState(false);
  // Con sesión, un enlace que no es de recuperación no se canjea (`auth-callback-plan.ts`).
  const skip = url !== null && !shouldCompleteRedirect(redirectFlow(url), isSignedIn);
  const result: Result | null = skip ? { status: 'skipped' } : exchange;

  useEffect(() => {
    const timer = setTimeout(() => setStalled(true), STALLED_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!url || skip) return;
    let isActive = true;
    // El mismo código comparte una sola promesa (`auth-redirect.ts`): volver a pedirlo al cambiar la
    // sesión no lo canjea dos veces.
    completeAuthRedirect(url).then((next) => {
      if (isActive) setExchange(next);
    });
    return () => {
      isActive = false;
    };
  }, [url, skip]);

  const outcome: CallbackOutcome | null = result ? { status: result.status } : null;
  const destination = callbackDestination({ outcome, isSignedIn, isRecoveringPassword });

  useEffect(() => {
    if (destination) router.replace(destination);
  }, [destination, router]);

  // Sin sesión, la salida es iniciar sesión; con sesión (enlace de recuperación fallido), volver a la app.
  const leave = () => router.replace(isSignedIn ? '/' : '/login');
  const leaveLabel = isSignedIn ? t('auth.callback.backToApp') : t('auth.callback.goToLogin');

  if (!destination && (result?.status === 'email_confirmed' || result?.status === 'error')) {
    const isError = result.status === 'error';
    return (
      <Screen
        footer={
          <Button
            // En error, salir es la única salida, no la acción principal.
            variant={isError ? 'secondary' : 'primary'}
            label={leaveLabel}
            onPress={leave}
          />
        }>
        <View accessibilityLiveRegion="polite">
          <EmptyState
            prominent={!isError}
            kind={isError ? 'error' : 'empty'}
            icon={isError ? undefined : MailCheck}
            title={isError ? authErrorMessage(result.error) : t('auth.callback.emailConfirmed')}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen footer={stalled ? <Button variant="secondary" label={leaveLabel} onPress={leave} /> : undefined}>
      <View style={styles.processing} accessibilityLiveRegion="polite">
        <KitomSymbol size={48} />
        <ActivityIndicator color={theme.primary} />
        <Text color="inkMuted" style={styles.center}>
          {stalled ? t('auth.callback.stalled') : t('auth.callback.processing')}
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  processing: {
    alignItems: 'center',
    gap: spacing['4'],
  },
  center: {
    textAlign: 'center',
  },
});
