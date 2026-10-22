import { useRouter } from 'expo-router';

import { Card } from '@/components/ui/card';
import { Check, KeyRound, Mail, Smartphone } from '@/components/ui/icons';
import { ListItem } from '@/components/ui/list-item';
import { Screen } from '@/components/ui/screen';
import { Tag } from '@/components/ui/tag';
import { Text } from '@/components/ui/text';
import { TopBar } from '@/components/ui/top-bar';
import { useAuth } from '@/features/auth/auth-context';
import { GoogleLogo } from '@/features/auth/components/google-logo';
import { t } from '@/i18n';

/**
 * Seguridad y acceso (tablero 10.2): el email, con qué se entra (Supabase Auth: `identities`) y cambiar
 * la contraseña. El teléfono está pendiente de OTP en Auth; «cerrar sesión en todos los dispositivos»
 * no se ofrece (necesita decidir qué pasa con lo pendiente de otros dispositivos).
 */
export default function SecurityScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const providers = new Set((user?.identities ?? []).map((identity) => identity.provider));
  const hasPassword = providers.has('email');
  const verified = Boolean(user?.email_confirmed_at);

  return (
    <Screen align="top">
      <TopBar onBack={() => (router.canGoBack() ? router.back() : router.replace('/settings'))} title={t('settings.security')} />
      <Card flush>
        <ListItem
          plain
          icon={Mail}
          title={t('settings.securityScreen.email')}
          subtitle={user?.email ?? ''}
          trailing={
            <Tag
              label={verified ? t('settings.securityScreen.verified') : t('settings.securityScreen.unverified')}
              tone={verified ? 'success' : 'neutral'}
              icon={verified ? Check : undefined}
            />
          }
        />
      </Card>

      <Text variant="overline" color="inkMuted" accessibilityRole="header">
        {t('settings.securityScreen.methods')}
      </Text>
      <Card flush>
        {providers.has('google') ? (
          <ListItem
            plain
            leading={<GoogleLogo />}
            title={t('settings.securityScreen.google')}
            subtitle={t('settings.securityScreen.connected')}
            divider
          />
        ) : null}
        {hasPassword ? (
          <ListItem
            plain
            icon={KeyRound}
            title={t('settings.securityScreen.emailPassword')}
            subtitle={t('settings.securityScreen.changePassword')}
            onPress={() => router.push('/settings/password')}
            divider
          />
        ) : null}
        <ListItem
          plain
          icon={Smartphone}
          title={t('settings.securityScreen.phone')}
          subtitle={t('settings.securityScreen.phoneText')}
          trailing={<Tag label={t('common.soon')} />}
        />
      </Card>
      <Text variant="caption" color="inkMuted">
        {t('settings.securityScreen.signOutNote')}
      </Text>
    </Screen>
  );
}
