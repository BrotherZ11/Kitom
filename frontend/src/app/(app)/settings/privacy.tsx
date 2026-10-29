import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Alert } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { Camera, Mail, Stethoscope } from '@/components/ui/icons';
import { ListItem } from '@/components/ui/list-item';
import { ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { Switch } from '@/components/ui/switch';
import { Text } from '@/components/ui/text';
import { useToast } from '@/components/ui/toast';
import { TopBar } from '@/components/ui/top-bar';
import { useAuth } from '@/features/auth/auth-context';
import { useProfile, useUpdateProfile } from '@/features/profile/hooks/use-profile';
import { DISCLAIMER_VERSION } from '@/features/profile/onboarding';
import { formatFullDate } from '@/features/reminders/reminder-format';
import { useIsOnline } from '@/hooks/use-is-online';
import { getLocale, t, tf } from '@/i18n';
import { spacing } from '@/theme/tokens';

/**
 * Privacidad y consentimientos (tablero 10.4): el aviso veterinario aceptado (fecha y versión) y las
 * comunicaciones (`marketing_opt_in`, revocable). El consentimiento de la foto de cada consulta se pide
 * en la propia consulta (`consult/new`) y no se guarda en el servidor (sin columna, `PANTALLAS.md` §6.4).
 */
export default function PrivacyScreen() {
  const router = useRouter();
  const toast = useToast();
  const { canUseServer } = useAuth();
  const online = useIsOnline();
  const profile = useProfile();
  const update = useUpdateProfile();
  const [error, setError] = useState<string | null>(null);
  const writable = canUseServer && online;
  const back = () => (router.canGoBack() ? router.back() : router.replace('/settings'));

  const data = profile.data;
  const acceptedAt = data?.disclaimer_accepted_at && data.disclaimer_version ? data.disclaimer_accepted_at : null;

  const setMarketing = (value: boolean) => {
    setError(null);
    update.mutate(
      { marketing_opt_in: value },
      {
        onSuccess: () => toast({ message: t('settings.privacyScreen.saved') }),
        onError: () => setError(t('settings.saveError')),
      }
    );
  };

  return (
    <Screen align="top">
      <TopBar onBack={back} title={t('settings.privacyScreen.title')} />
      {!writable ? <Alert tone="warning" message={t('settings.offline')} /> : null}
      {error ? <Alert tone="error" message={error} /> : null}
      {data === undefined ? (
        profile.isError ? (
          <ErrorState message={t('setup.errors.load')} onRetry={() => void profile.refetch()} />
        ) : profile.fetchStatus === 'idle' ? null : (
          <LoadingState />
        )
      ) : (
        <>
          <Card flush>
            <ListItem
              plain
              icon={Stethoscope}
              title={t('settings.privacyScreen.disclaimer')}
              subtitle={
                acceptedAt
                  ? tf('setup.disclaimer.accepted', {
                      date: formatFullDate(new Date(acceptedAt), getLocale()),
                      version: data?.disclaimer_version ?? DISCLAIMER_VERSION,
                    })
                  : t('settings.privacyScreen.disclaimerPending')
              }
              onPress={() => router.push({ pathname: '/setup/disclaimer', params: { review: '1' } })}
            />
          </Card>

          <View style={styles.group}>
            <Text variant="overline" color="inkMuted" accessibilityRole="header">
              {t('settings.privacyScreen.communications')}
            </Text>
            <Card flush>
              <ListItem
                icon={Mail}
                title={t('settings.privacyScreen.marketing')}
                subtitle={t('settings.privacyScreen.marketingText')}
                trailing={
                  <View style={styles.switch}>
                    <Switch
                      value={data?.marketing_opt_in ?? false}
                      disabled={!writable || update.isPending}
                      onValueChange={setMarketing}
                      accessibilityLabel={t('settings.privacyScreen.marketing')}
                    />
                  </View>
                }
              />
            </Card>
          </View>

          <View style={styles.group}>
            <Text variant="overline" color="inkMuted" accessibilityRole="header">
              {t('settings.privacyScreen.photos')}
            </Text>
            <Card flush>
              <ListItem icon={Camera} title={t('settings.privacyScreen.photos')} subtitle={t('settings.privacyScreen.photosText')} />
            </Card>
          </View>

          <Text variant="caption" color="inkMuted">
            {t('settings.privacyScreen.rights')}
          </Text>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: {
    gap: spacing['2'],
  },
  switch: {
    paddingLeft: spacing['2'],
  },
});
