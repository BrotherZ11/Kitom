import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FormMessage } from '@/components/ui/form-message';
import { ListItem } from '@/components/ui/list-item';
import { LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { TopBar } from '@/components/ui/top-bar';
import { authErrorMessage, type AuthErrorCode } from '@/features/auth/auth-errors';
import type { SignOutOutcome, SyncAttemptResult } from '@/features/auth/sign-out-flow';
import { summarizeUnsynced } from '@/features/daily-logs/offline/daily-log-cache';
import { useUnsyncedDailyLogs } from '@/features/daily-logs/hooks/use-daily-log';
import { useSignOutFlow } from '@/features/daily-logs/sync/daily-log-sync-provider';
import { t } from '@/i18n';
import { spacing } from '@/theme/tokens';

/**
 * Cerrar sesión con registros diarios sin sincronizar (`features/auth/sign-out-flow.ts`). Se llega
 * desde «Cerrar sesión» solo si hay cambios pendientes, en conflicto o fallidos, o si no se pudo
 * comprobar. Ninguna opción borra datos del dispositivo. Salir de la pantalla (atrás o «Cancelar»)
 * no cambia nada y anula el cierre de un intento de sincronización en curso.
 */
export default function SignOutScreen() {
  const router = useRouter();
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

  const header = <TopBar onBack={cancel} backLabel={t('signOut.cancel')} title={t('signOut.title')} />;

  if (view.state === 'loading') {
    return (
      <Screen align="top">
        {header}
        <LoadingState />
      </Screen>
    );
  }

  const summary = view.state === 'ready' ? summarizeUnsynced(view.items.map((item) => item.record)) : null;
  const total = summary ? summary.pending + summary.conflict + summary.failed : null;

  return (
    <Screen align="top">
      {header}
      {summary === null ? (
        <Alert tone="warning" message={t('signOut.checkFailed')} />
      ) : total === 0 ? (
        <Text>{t('signOut.allSynced')}</Text>
      ) : (
        <>
          <Text variant="title3">{t('signOut.intro')}</Text>
          <View accessibilityLiveRegion="polite">
            <Card flush>
              {(['pending', 'conflict', 'failed'] as const).map((status, index) => (
                <ListItem key={status} plain title={t(`signOut.counts.${status}`)} value={String(summary[status])} divider={index < 2} />
              ))}
            </Card>
          </View>
          <Alert tone="warning" message={t('signOut.localOnly')} />
          {summary.conflict + summary.failed > 0 && (
            <Text variant="caption" color="inkMuted">
              {t('signOut.needsReview')}
            </Text>
          )}
        </>
      )}

      <FormMessage message={attempt ? t(`signOut.result.${attempt}`) : null} />
      <FormMessage message={error ? authErrorMessage(error) : null} />

      {total === 0 ? (
        <Button
          label={t('settings.signOut')}
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
          <Text variant="caption" color="inkMuted" style={styles.explanation}>
            {t('signOut.syncExplanation')}
          </Text>

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
          <Text variant="caption" color="inkMuted" style={styles.explanation}>
            {t('signOut.keepExplanation')}
          </Text>

          <Button
            variant="ghost"
            size="md"
            label={t('signOut.review')}
            disabled={busy}
            onPress={() => router.push('/daily-logs/unsynced')}
          />
        </>
      )}

      {/* Cancelar también vale durante un intento de sincronización (no espera a la red). */}
      <Button variant="ghost" size="md" label={t('signOut.cancel')} disabled={state === 'signing_out'} onPress={cancel} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  // La explicación va pegada a su botón.
  explanation: {
    marginTop: -spacing['2'],
  },
});
