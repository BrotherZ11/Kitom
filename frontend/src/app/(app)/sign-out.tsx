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
import { unsyncedTotal, type SignOutOutcome, type SyncAttemptResult } from '@/features/auth/sign-out-flow';
import { useSignOutFlow, useUnsyncedChanges } from '@/features/auth/sign-out-provider';
import { needsReview, signOutTotal, type SignOutSummary } from '@/features/auth/unsynced-changes';
import { petUnsyncedTotal, type PetUnsyncedSummary } from '@/features/pets/offline/pet-operation';
import { t } from '@/i18n';
import { spacing } from '@/theme/tokens';

const DAILY_LOG_COUNTS = ['pending', 'conflict', 'failed'] as const;
const PET_COUNTS = ['pendingCreate', 'pendingUpdate', 'uncertain', 'conflict', 'failed', 'forbidden', 'unreadable'] as const satisfies readonly (keyof PetUnsyncedSummary)[];

/**
 * Cerrar sesión con cambios que solo existen en el dispositivo (`features/auth/sign-out-flow.ts`): de
 * registros diarios y de mascotas (altas, ediciones, envíos sin confirmar, conflictos, fallos, sin
 * permiso e ilegibles). Se llega desde «Cerrar sesión» solo si hay alguno, o si no se pudo comprobar.
 * Ninguna opción borra datos del dispositivo. Salir de la pantalla (atrás o «Cancelar») no cambia nada
 * y anula el cierre de un intento de sincronización en curso.
 */
export default function SignOutScreen() {
  const router = useRouter();
  const { flow, state } = useSignOutFlow();
  const { view } = useUnsyncedChanges();
  const [attempt, setAttempt] = useState<SyncAttemptResult | null>(null);
  const [error, setError] = useState<AuthErrorCode | null>(null);
  const busy = state !== 'idle';

  // Al salir de la pantalla, una pasada en curso ya no cierra la sesión al terminar.
  useEffect(() => () => flow.cancel(), [flow]);

  const handle = (outcome: SignOutOutcome<AuthErrorCode, SignOutSummary>) => {
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

  // Si un almacén no se pudo leer, no se afirma que no haya nada: se ofrecen las mismas opciones.
  const summary = view.state === 'ready' ? view.summary : null;
  const total = summary ? signOutTotal(summary) : null;
  const dailyLogs = summary ? unsyncedTotal(summary.dailyLogs) : 0;
  const pets = summary ? petUnsyncedTotal(summary.pets) : 0;

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
          <View accessibilityLiveRegion="polite" style={styles.counts}>
            {dailyLogs > 0 ? (
              <>
                <Text variant="overline" color="inkMuted" accessibilityRole="header">
                  {t('signOut.dailyLogs')}
                </Text>
                <Card flush>
                  {DAILY_LOG_COUNTS.map((status, index) => (
                    <ListItem
                      key={status}
                      plain
                      title={t(`signOut.counts.${status}`)}
                      value={String(summary.dailyLogs[status])}
                      divider={index < DAILY_LOG_COUNTS.length - 1}
                    />
                  ))}
                </Card>
              </>
            ) : null}
            {pets > 0 ? (
              <>
                <Text variant="overline" color="inkMuted" accessibilityRole="header">
                  {t('signOut.pets')}
                </Text>
                <Card flush>
                  {PET_COUNTS.filter((status) => summary.pets[status] > 0).map((status, index, shown) => (
                    <ListItem
                      key={status}
                      plain
                      title={t(`signOut.petCounts.${status}`)}
                      value={String(summary.pets[status])}
                      divider={index < shown.length - 1}
                    />
                  ))}
                </Card>
              </>
            ) : null}
          </View>
          <Alert tone="warning" message={t('signOut.localOnly')} />
          {needsReview(summary) ? (
            <Text variant="caption" color="inkMuted">
              {t('signOut.needsReview')}
            </Text>
          ) : null}
        </>
      )}

      <FormMessage message={attempt ? t(`signOut.result.${attempt}`) : null} />
      <FormMessage message={error ? authErrorMessage(error) : null} />

      {total === 0 ? (
        <Button label={t('settings.signOut')} loading={busy} onPress={async () => handle(await flow.request())} />
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

          {summary === null || dailyLogs > 0 ? (
            <Button
              variant="ghost"
              size="md"
              label={t('signOut.review')}
              disabled={busy}
              onPress={() => router.push('/daily-logs/unsynced')}
            />
          ) : null}
          {summary === null || pets > 0 ? (
            <Button variant="ghost" size="md" label={t('signOut.reviewPets')} disabled={busy} onPress={() => router.push('/pets')} />
          ) : null}
        </>
      )}

      {/* Cancelar también vale durante un intento de sincronización (no espera a la red). */}
      <Button variant="ghost" size="md" label={t('signOut.cancel')} disabled={state === 'signing_out'} onPress={cancel} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  counts: {
    gap: spacing['2'],
  },
  // La explicación va pegada a su botón.
  explanation: {
    marginTop: -spacing['2'],
  },
});
