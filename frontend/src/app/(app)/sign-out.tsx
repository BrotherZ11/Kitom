import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { Spacing } from '@/constants/theme';
import { authErrorMessage, type AuthErrorCode } from '@/features/auth/auth-errors';
import type { SignOutOutcome, SyncAttemptResult } from '@/features/auth/sign-out-flow';
import { summarizeUnsynced } from '@/features/daily-logs/offline/daily-log-cache';
import { useUnsyncedDailyLogs } from '@/features/daily-logs/hooks/use-daily-log';
import { useSignOutFlow } from '@/features/daily-logs/sync/daily-log-sync-provider';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

/**
 * Cerrar sesión con registros diarios sin sincronizar (`features/auth/sign-out-flow.ts`). Se llega
 * desde «Cerrar sesión» solo si hay cambios pendientes, en conflicto o fallidos, o si no se pudo
 * comprobar. Ninguna opción borra datos del dispositivo. Salir de la pantalla (atrás o «Cancelar»)
 * no cambia nada y anula el cierre de un intento de sincronización en curso.
 */
export default function SignOutScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { flow, state } = useSignOutFlow();
  const { view } = useUnsyncedDailyLogs();
  const [attempt, setAttempt] = useState<SyncAttemptResult | null>(null);
  const [error, setError] = useState<AuthErrorCode | null>(null);
  const busy = state !== 'idle';

  // Al salir de la pantalla, una pasada en curso ya no cierra la sesión al terminar.
  useEffect(() => () => flow.cancel(), [flow]);

  const handle = (outcome: SignOutOutcome<AuthErrorCode>) => {
    if (outcome.status === 'signed_out') setError(outcome.error);
    if (outcome.status === 'needs_decision') setAttempt(outcome.attempt);
  };

  const cancel = () => {
    flow.cancel();
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  if (view.state === 'loading') return <LoadingState />;

  const summary = view.state === 'ready' ? summarizeUnsynced(view.items.map((item) => item.record)) : null;
  const total = summary ? summary.pending + summary.conflict + summary.failed : null;

  return (
    <Screen align="top" edges={['bottom', 'left', 'right']}>
      {summary === null ? (
        <FormMessage message={t('signOut.checkFailed')} />
      ) : total === 0 ? (
        <ThemedText>{t('signOut.allSynced')}</ThemedText>
      ) : (
        <>
          <ThemedText type="smallBold">{t('signOut.intro')}</ThemedText>
          <View style={[styles.counts, { borderColor: theme.danger }]} accessibilityLiveRegion="polite">
            {(['pending', 'conflict', 'failed'] as const).map((status) => (
              <ThemedText key={status} type="small">
                {`${t(`signOut.counts.${status}`)}: ${summary[status]}`}
              </ThemedText>
            ))}
          </View>
          <ThemedText type="small">{t('signOut.localOnly')}</ThemedText>
          {summary.conflict + summary.failed > 0 && (
            <ThemedText type="small" themeColor="textSecondary">
              {t('signOut.needsReview')}
            </ThemedText>
          )}
        </>
      )}

      <FormMessage message={attempt ? t(`signOut.result.${attempt}`) : null} />
      <FormMessage message={error ? authErrorMessage(error) : null} />

      {total === 0 ? (
        <Button
          label={t('home.signOut')}
          loading={busy}
          onPress={async () => handle(await flow.request())}
        />
      ) : (
        <>
          <Button
            label={t('signOut.syncAndSignOut')}
            loading={state === 'syncing'}
            disabled={busy}
            onPress={async () => {
              setAttempt(null);
              setError(null);
              handle(await flow.syncAndSignOut());
            }}
          />
          <ThemedText type="small" themeColor="textSecondary">
            {t('signOut.syncExplanation')}
          </ThemedText>

          <Button
            variant="secondary"
            label={t('signOut.keepAndSignOut')}
            loading={state === 'signing_out'}
            disabled={busy}
            onPress={async () => {
              setError(null);
              handle(await flow.keepAndSignOut());
            }}
          />
          <ThemedText type="small" themeColor="textSecondary">
            {t('signOut.keepExplanation')}
          </ThemedText>

          <Button
            variant="link"
            label={t('signOut.review')}
            disabled={busy}
            onPress={() => router.push('/daily-logs/unsynced')}
          />
        </>
      )}

      {/* Cancelar también vale durante un intento de sincronización (no espera a la red). */}
      <Button variant="link" label={t('signOut.cancel')} disabled={state === 'signing_out'} onPress={cancel} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  counts: {
    gap: Spacing.half,
    padding: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.two,
  },
});
