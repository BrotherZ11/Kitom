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
import { authErrorMessage } from '@/features/auth/auth-errors';
import { completeAuthRedirect, type AuthRedirectResult } from '@/features/auth/auth-redirect';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';
import { spacing } from '@/theme/tokens';

/** Sin URL o sin respuesta en este tiempo, se ofrece salir (antes el indicador giraba para siempre). */
const STALLED_AFTER_MS = 15_000;

/**
 * Destino de los enlaces de Supabase Auth (`kitom://auth-callback?…`). Si el intercambio crea la
 * sesión, la protección de rutas del layout raíz saca al usuario de aquí (a la app o a
 * /update-password); esta pantalla solo muestra el progreso o el motivo del fallo.
 */
export default function AuthCallbackScreen() {
  const router = useRouter();
  const theme = useTheme();
  const url = Linking.useLinkingURL();
  const [result, setResult] = useState<AuthRedirectResult | null>(null);
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setStalled(true), STALLED_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!url) return;
    let isActive = true;
    completeAuthRedirect(url).then((next) => {
      if (isActive) setResult(next);
    });
    return () => {
      isActive = false;
    };
  }, [url]);

  const goToLogin = () => router.replace('/login');

  if (result?.status === 'email_confirmed' || result?.status === 'error') {
    const isError = result.status === 'error';
    return (
      <Screen
        footer={
          <Button
            // En error, volver al login es la salida, no la acción principal.
            variant={isError ? 'secondary' : 'primary'}
            label={t('auth.callback.goToLogin')}
            onPress={goToLogin}
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
    <Screen
      footer={stalled ? <Button variant="secondary" label={t('auth.callback.goToLogin')} onPress={goToLogin} /> : undefined}>
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
