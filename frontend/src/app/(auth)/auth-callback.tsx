import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { Screen } from '@/components/ui/screen';
import { authErrorMessage } from '@/features/auth/auth-errors';
import { completeAuthRedirect, type AuthRedirectResult } from '@/features/auth/auth-redirect';
import { t } from '@/i18n';

/**
 * Destino de los enlaces de Supabase Auth (`kitom://auth-callback?…`). Si el intercambio crea la
 * sesión, la protección de rutas del layout raíz saca al usuario de aquí (a la app o a
 * /update-password); esta pantalla solo muestra el progreso o el motivo del fallo.
 */
export default function AuthCallbackScreen() {
  const router = useRouter();
  const url = Linking.useLinkingURL();
  const [result, setResult] = useState<AuthRedirectResult | null>(null);

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

  if (result?.status === 'email_confirmed' || result?.status === 'error') {
    return (
      <Screen>
        <FormMessage
          tone={result.status === 'error' ? 'error' : 'success'}
          message={
            result.status === 'error'
              ? authErrorMessage(result.error)
              : t('auth.callback.emailConfirmed')
          }
        />
        <Button label={t('auth.callback.goToLogin')} onPress={() => router.replace('/login')} />
      </Screen>
    );
  }

  return (
    <Screen>
      <ActivityIndicator />
      <ThemedText themeColor="textSecondary" style={{ textAlign: 'center' }}>
        {t('auth.callback.processing')}
      </ThemedText>
    </Screen>
  );
}
