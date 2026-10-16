import { useRouter } from 'expo-router';
import { useState } from 'react';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { Screen } from '@/components/ui/screen';
import { useAuth } from '@/features/auth/auth-context';
import { authErrorMessage, type AuthErrorCode } from '@/features/auth/auth-errors';
import { OfflineSessionNotice } from '@/features/auth/components/offline-session-notice';
import { UnsyncedDailyLogsEntry } from '@/features/daily-logs/components/unsynced-entry';
import { useSignOutFlow } from '@/features/daily-logs/sync/daily-log-sync-provider';
import { t } from '@/i18n';

/** Pantalla temporal: confirma que la sesión está activa. Se sustituirá por la Home real. */
export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { flow, state } = useSignOutFlow();
  const [error, setError] = useState<AuthErrorCode | null>(null);

  const handleSignOut = async () => {
    setError(null);
    // Sin cambios sin sincronizar, cierra sesión como siempre (la sesión local se borra siempre y la
    // protección de rutas lleva a (auth)). Con ellos, o si no se pueden comprobar, se decide antes.
    const outcome = await flow.request();
    if (outcome.status === 'signed_out') setError(outcome.error);
    if (outcome.status === 'needs_decision') router.push('/sign-out');
  };

  return (
    <Screen>
      <ThemedText type="subtitle">{t('home.title')}</ThemedText>
      <ThemedText themeColor="textSecondary">{t('home.signedInAs')}</ThemedText>
      <ThemedText type="smallBold">{user?.email}</ThemedText>
      <ThemedText themeColor="textSecondary">{t('home.placeholder')}</ThemedText>
      {/* Sesión guardada sin comprobar (arranque sin conexión con el token caducado). */}
      <OfflineSessionNotice />

      <FormMessage message={error ? authErrorMessage(error) : null} />

      <Button label={t('home.goToPets')} onPress={() => router.push('/pets')} />
      {/* Registros con cambios solo en el dispositivo, también de mascotas que ya no se ven. */}
      <UnsyncedDailyLogsEntry />
      <Button
        variant="secondary"
        label={t('home.signOut')}
        loading={state !== 'idle'}
        onPress={handleSignOut}
      />
    </Screen>
  );
}
