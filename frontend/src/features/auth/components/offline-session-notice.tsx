import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/auth-context';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

/**
 * Aviso de sesión `offline` (`auth-state.ts`): la sesión está guardada en el dispositivo, pero no se ha
 * podido renovar ni comprobar con el servidor. No dice que siga siendo válida. La comprobación se
 * repite sola al volver la red o la app a primer plano; el botón la pide ahora.
 */
export function OfflineSessionNotice() {
  const theme = useTheme();
  const { status, recoverSession } = useAuth();
  const [checking, setChecking] = useState(false);
  if (status !== 'offline') return null;

  return (
    <View style={[styles.card, { borderColor: theme.danger }]} accessibilityLiveRegion="polite">
      <ThemedText type="smallBold">{t('offlineSession.title')}</ThemedText>
      <ThemedText type="small">{t('offlineSession.description')}</ThemedText>
      <Button
        variant="secondary"
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
  card: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.two,
  },
});
