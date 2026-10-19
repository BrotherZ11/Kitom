import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/auth-context';
import { t } from '@/i18n';
import { spacing } from '@/theme/tokens';

/**
 * Aviso de sesión `offline` (`auth-state.ts`): la sesión está guardada en el dispositivo, pero no se ha
 * podido renovar ni comprobar con el servidor. No dice que siga siendo válida. La comprobación se
 * repite sola al volver la red o la app a primer plano; el botón la pide ahora.
 */
export function OfflineSessionNotice() {
  const { status, recoverSession } = useAuth();
  const [checking, setChecking] = useState(false);
  if (status !== 'offline') return null;

  return (
    <View style={styles.container}>
      <Alert tone="warning" title={t('offlineSession.title')} message={t('offlineSession.description')} />
      <Button
        variant="secondary"
        size="md"
        label={t('offlineSession.retry')}
        loading={checking}
        onPress={async () => {
          setChecking(true);
          try {
            await recoverSession();
          } finally {
            setChecking(false);
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing['2'],
  },
});
