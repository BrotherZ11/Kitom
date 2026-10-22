import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Alert } from '@/components/ui/alert';
import { Avatar } from '@/components/ui/avatar';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FormMessage } from '@/components/ui/form-message';
import { Icon } from '@/components/ui/icon';
import {
  Bell,
  CircleHelp,
  Clock,
  CloudUpload,
  FileText,
  Globe,
  House,
  KeyRound,
  LogOut,
  Moon,
  Pencil,
  Shield,
} from '@/components/ui/icons';
import { ListItem } from '@/components/ui/list-item';
import { Screen } from '@/components/ui/screen';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Tag } from '@/components/ui/tag';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { useToast } from '@/components/ui/toast';
import { TopBar } from '@/components/ui/top-bar';
import { useAuth } from '@/features/auth/auth-context';
import { authErrorMessage, type AuthErrorCode } from '@/features/auth/auth-errors';
import { useSignOutFlow, useUnsyncedChanges } from '@/features/auth/sign-out-provider';
import { useUnsyncedDailyLogs } from '@/features/daily-logs/hooks/use-daily-log';
import { formatTimeOfDay, parseTimeOfDay } from '@/features/notifications/notification-plan';
import { petUnsyncedTotal } from '@/features/pets/offline/pet-operation';
import {
  useNotificationPreferences,
  useProfile,
  useSubscription,
  useUpdateProfile,
} from '@/features/profile/hooks/use-profile';
import { useProfileName } from '@/features/profile/hooks/use-profile-name';
import { useProfileTimeZone } from '@/features/profile/hooks/use-profile-timezone';
import { PROFILE_NAME_MAX_LENGTH, validateProfileName } from '@/features/profile/onboarding';
import { getDeviceTimeZone, normalizeTimeZone } from '@/features/profile/timezone';
import { useIsOnline } from '@/hooks/use-is-online';
import { useTheme } from '@/hooks/use-theme';
import { t, tf } from '@/i18n';
import { createSubmitGuard } from '@/lib/submit-guard';
import { useAppTheme, type ThemePreference } from '@/theme/theme-provider';
import { borderWidth, radius, size, spacing } from '@/theme/tokens';

/**
 * Tu cuenta y ajustes (tablero 10.1): quién eres y tu plan, preferencias (idioma, zona horaria, tema y
 * notificaciones), seguridad y privacidad, tus datos, ayuda y cerrar sesión. Exportar, suscripción y
 * eliminar la cuenta no se muestran hasta tener su servicio (Edge Functions y RevenueCat pendientes).
 */
export default function SettingsScreen() {
  const router = useRouter();
  const { user, canUseServer } = useAuth();
  const online = useIsOnline();
  const profileName = useProfileName();
  const timeZone = useProfileTimeZone();
  const preferences = useNotificationPreferences();
  const subscription = useSubscription();
  const { view } = useUnsyncedDailyLogs();
  const { flow, state } = useSignOutFlow();
  const changes = useUnsyncedChanges();
  const { preference, setPreference } = useAppTheme();
  const petChanges = changes.view.state === 'ready' && petUnsyncedTotal(changes.view.summary.pets) > 0;
  const [error, setError] = useState<AuthErrorCode | null>(null);
  const [sheet, setSheet] = useState<'name' | 'timezone' | null>(null);
  const serverUsable = canUseServer && online;

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
  const dailyTime = parseTimeOfDay(preferences.data?.daily_reminder_time);
  const notificationsSubtitle = preferences.data
    ? preferences.data.daily_reminder_enabled && dailyTime
      ? tf('settings.notificationsDaily', { time: formatTimeOfDay(dailyTime) })
      : t('settings.notificationsDailyOff')
    : undefined;
  const plan = subscription.data?.plan;

  return (
    <Screen align="top">
      <TopBar
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        title={t('settings.title')}
      />

      {!serverUsable ? <Alert tone="warning" message={t('settings.offline')} /> : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t('settings.editName')}. ${name ?? email}`}
        disabled={!serverUsable}
        onPress={() => setSheet('name')}>
        {({ pressed }) => (
          <Card style={[styles.account, pressed && styles.pressed]}>
            <Avatar name={name ?? email} size="lg" />
            <View style={styles.flex}>
              {name ? <Text variant="title3">{name}</Text> : null}
              <Text variant={name ? 'caption' : 'bodyStrong'} color={name ? 'inkMuted' : 'ink'}>
                {email}
              </Text>
              {plan ? (
                <View style={styles.planTag}>
                  <Tag label={plan === 'premium' ? t('settings.planPremium') : t('settings.planFree')} tone={plan === 'premium' ? 'accent' : 'neutral'} />
                </View>
              ) : null}
            </View>
            {serverUsable ? <Icon icon={Pencil} size="sm" color="inkMuted" /> : null}
          </Card>
        )}
      </Pressable>

      <Group title={t('settings.preferences')}>
        <ListItem plain icon={Globe} title={t('settings.language')} value={t('settings.languageValue')} divider />
        <ListItem
          plain
          icon={Clock}
          title={t('settings.timezone')}
          value={timeZone.data ?? t('settings.timezoneUnset')}
          onPress={serverUsable ? () => setSheet('timezone') : undefined}
          divider
        />
        <ThemeRow preference={preference} onChange={setPreference} />
        <ListItem
          plain
          icon={Bell}
          title={t('settings.notifications')}
          subtitle={notificationsSubtitle}
          onPress={() => router.push('/settings/notifications')}
        />
      </Group>

      <Group title={t('settings.accountPrivacy')}>
        <ListItem plain icon={KeyRound} title={t('settings.security')} onPress={() => router.push('/settings/security')} divider />
        <ListItem plain icon={Shield} title={t('settings.privacy')} onPress={() => router.push('/settings/privacy')} />
      </Group>

      <Group title={t('settings.data')}>
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
        />
      </Group>

      <Group title={t('settings.help')}>
        <ListItem plain icon={CircleHelp} title={t('settings.helpFaq')} onPress={() => router.push('/settings/help')} divider />
        <ListItem plain icon={FileText} title={t('settings.legal')} onPress={() => router.push('/settings/legal')} />
      </Group>

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

      <NameSheet visible={sheet === 'name'} onClose={() => setSheet(null)} />
      <TimeZoneSheet visible={sheet === 'timezone'} current={timeZone.data ?? null} onClose={() => setSheet(null)} />
    </Screen>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.group}>
      <Text variant="overline" color="inkMuted" accessibilityRole="header">
        {title}
      </Text>
      <Card flush>{children}</Card>
    </View>
  );
}

/** Tema: sistema, claro u oscuro (preferencia de este dispositivo). */
function ThemeRow({ preference, onChange }: { preference: ThemePreference; onChange: (value: ThemePreference) => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.themeRow, { borderBottomColor: theme.line }]}>
      <View style={styles.themeLabel}>
        <View style={[styles.iconTile, { backgroundColor: theme.surfaceBrand }]}>
          <Icon icon={Moon} size="sm" color="primary" />
        </View>
        <Text>{t('settings.theme')}</Text>
      </View>
      <SegmentedControl
        accessibilityLabel={t('settings.theme')}
        options={[
          { value: 'system', label: t('settings.themeSystem') },
          { value: 'light', label: t('settings.themeLight') },
          { value: 'dark', label: t('settings.themeDark') },
        ]}
        value={preference}
        onChange={onChange}
      />
    </View>
  );
}

function NameSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return visible ? <NameSheetContent onClose={onClose} /> : null;
}

function NameSheetContent({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const profile = useProfile();
  const update = useUpdateProfile();
  const [name, setName] = useState(profile.data?.full_name ?? '');
  const [error, setError] = useState<string | null>(null);
  const [guard] = useState(createSubmitGuard);

  const save = () => {
    void guard.run(async () => {
      if (validateProfileName(name)) {
        setError(tf('setup.profile.nameTooLong', { max: PROFILE_NAME_MAX_LENGTH }));
        return;
      }
      try {
        await update.mutateAsync({ full_name: name.trim() === '' ? null : name.trim() });
        toast({ message: t('settings.nameSaved') });
        onClose();
      } catch {
        setError(t('settings.saveError'));
      }
    });
  };

  return (
    <BottomSheet
      visible
      title={t('settings.nameTitle')}
      onClose={onClose}
      footer={<Button label={t('common.save')} loading={update.isPending} onPress={save} />}>
      <TextField
        label={t('setup.profile.name')}
        value={name}
        onChangeText={(value) => {
          setName(value);
          setError(null);
        }}
        autoFocus
        autoCapitalize="words"
        autoComplete="given-name"
        returnKeyType="done"
        onSubmitEditing={save}
        maxLength={PROFILE_NAME_MAX_LENGTH + 10}
        error={error}
      />
    </BottomSheet>
  );
}

function TimeZoneSheet({ visible, current, onClose }: { visible: boolean; current: string | null; onClose: () => void }) {
  const toast = useToast();
  const update = useUpdateProfile();
  const [error, setError] = useState<string | null>(null);
  const device = normalizeTimeZone(getDeviceTimeZone());
  const same = device !== null && device === current;

  const applyDeviceTimeZone = async () => {
    if (!device) return;
    setError(null);
    try {
      await update.mutateAsync({ timezone: device });
      toast({ message: t('settings.timezoneSaved') });
      onClose();
    } catch {
      setError(t('settings.saveError'));
    }
  };

  return (
    <BottomSheet
      visible={visible}
      title={t('settings.timezoneTitle')}
      onClose={onClose}
      footer={
        device && !same ? (
          <Button
            label={t('settings.timezoneUseDevice')}
            loading={update.isPending}
            onPress={() => void applyDeviceTimeZone()}
          />
        ) : undefined
      }>
      <Text color="inkMuted">{t('settings.timezoneText')}</Text>
      <Card flush>
        <ListItem plain title={t('settings.timezoneCurrent')} value={current ?? t('settings.timezoneUnset')} divider />
        <ListItem plain title={t('settings.timezoneDevice')} value={device ?? '—'} />
      </Card>
      {same ? (
        <Text variant="caption" color="inkMuted">
          {t('settings.timezoneSame')}
        </Text>
      ) : null}
      {error ? <Alert tone="error" message={error} /> : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  account: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  pressed: {
    opacity: 0.85,
  },
  flex: {
    flex: 1,
    gap: 2,
  },
  planTag: {
    alignSelf: 'flex-start',
    marginTop: spacing['1'],
  },
  group: {
    gap: spacing['2'],
  },
  center: {
    textAlign: 'center',
  },
  themeRow: {
    gap: 10,
    paddingTop: spacing['3'],
    paddingBottom: 14,
    paddingHorizontal: spacing['4'],
    borderBottomWidth: borderWidth.hairline,
  },
  themeLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing['3'],
    minHeight: size.touchMin - 8,
  },
  iconTile: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
