import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { FormMessage } from '@/components/ui/form-message';
import { Icon } from '@/components/ui/icon';
import { Clock, CloudUpload, House, LogOut } from '@/components/ui/icons';
import { ListItem } from '@/components/ui/list-item';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { TopBar } from '@/components/ui/top-bar';
import { useAuth } from '@/features/auth/auth-context';
import { authErrorMessage, type AuthErrorCode } from '@/features/auth/auth-errors';
import { useSignOutFlow, useUnsyncedChanges } from '@/features/auth/sign-out-provider';
import { useUnsyncedDailyLogs } from '@/features/daily-logs/hooks/use-daily-log';
import { petUnsyncedTotal } from '@/features/pets/offline/pet-operation';
import { useProfileName } from '@/features/profile/hooks/use-profile-name';
import { useProfileTimeZone } from '@/features/profile/hooks/use-profile-timezone';
import { t, tf } from '@/i18n';
import { spacing } from '@/theme/tokens';

/**
 * Tu cuenta y ajustes (tablero 10.1, versión mínima). Solo lo que ya funciona: quién eres, tus
 * mascotas, los registros pendientes de subir y cerrar sesión. Idioma, tema, notificaciones,
 * seguridad, privacidad, exportar, suscripción y eliminar la cuenta llegarán con sus servicios (no se
 * muestran botones que no hacen nada).
 */
export default function SettingsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const profileName = useProfileName();
  const timeZone = useProfileTimeZone();
  const { view } = useUnsyncedDailyLogs();
  const { flow, state } = useSignOutFlow();
  const changes = useUnsyncedChanges();
  const petChanges = changes.view.state === 'ready' && petUnsyncedTotal(changes.view.summary.pets) > 0;
  const [error, setError] = useState<AuthErrorCode | null>(null);

  const handleSignOut = async () => {
    setError(null);
    // Sin cambios sin sincronizar, cierra sesión como siempre (la sesión local se borra siempre y la
    // protección de rutas lleva a (auth)). Con ellos, o si no se pueden comprobar, se decide antes.
    const outcome = await flow.request();
    if (outcome.status === 'signed_out') setError(outcome.error);
    if (outcome.status === 'needs_decision') router.push('/sign-out');
  };

  const email = user?.email ?? '';
  const name = profileName.data ?? null;
  const unsynced =
    view.state === 'error'
      ? t('settings.unsyncedError')
      : view.state === 'ready'
        ? view.items.length === 0
          ? t('settings.unsyncedNone')
          : t('settings.unsyncedSome')
        : t('common.loading');
  const version = Constants.expoConfig?.version;

  return (
    <Screen align="top">
      <TopBar
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        title={t('settings.title')}
      />

      <Card style={styles.account}>
        <Avatar name={name ?? email} size="lg" />
        <View style={styles.flex}>
          {name ? <Text variant="title3">{name}</Text> : null}
          <Text variant={name ? 'caption' : 'bodyStrong'} color={name ? 'inkMuted' : 'ink'}>
            {email}
          </Text>
        </View>
      </Card>

      <View style={styles.group}>
        <Text variant="overline" color="inkMuted" accessibilityRole="header">
          {t('settings.data')}
        </Text>
        <Card flush>
          <ListItem
            plain
            icon={House}
            title={t('settings.myPets')}
            subtitle={petChanges ? t('settings.petsUnsynced') : undefined}
            onPress={() => router.push('/pets')}
            divider
          />
          <ListItem
            plain
            icon={CloudUpload}
            title={t('settings.unsynced')}
            subtitle={unsynced}
            onPress={() => router.push('/daily-logs/unsynced')}
            divider
          />
          <ListItem
            plain
            icon={Clock}
            title={t('settings.timezone')}
            value={timeZone.data ?? t('settings.timezoneUnset')}
          />
        </Card>
      </View>

      <Card flush>
        <ListItem
          title={t('settings.signOut')}
          titleColor="primary"
          leading={<Icon icon={LogOut} size="sm" color="primary" />}
          chevron={false}
          accessibilityHint={state !== 'idle' ? t('common.loading') : undefined}
          onPress={() => {
            if (state === 'idle') void handleSignOut();
          }}
        />
      </Card>
      <FormMessage message={error ? authErrorMessage(error) : null} />

      {version ? (
        <Text variant="caption" color="inkMuted" style={styles.center}>
          {tf('settings.version', { version })}
        </Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  account: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  flex: {
    flex: 1,
    gap: 2,
  },
  group: {
    gap: spacing['2'],
  },
  center: {
    textAlign: 'center',
  },
});
