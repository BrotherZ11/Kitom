import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CalendarDays } from '@/components/ui/icons';
import { ListItem } from '@/components/ui/list-item';
import { ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { Switch } from '@/components/ui/switch';
import { Text } from '@/components/ui/text';
import { TopBar } from '@/components/ui/top-bar';
import { useAuth } from '@/features/auth/auth-context';
import { notificationsUnavailableReason, openSystemSettings } from '@/features/notifications/device-notifications';
import { useNotificationPermission } from '@/features/notifications/hooks/use-notification-permission';
import { formatTimeOfDay, parseTimeOfDay, toTimeColumn } from '@/features/notifications/notification-plan';
import { useActivePet } from '@/features/pets/active-pet-context';
import { useNotificationPreferences, useSaveNotificationPreferences } from '@/features/profile/hooks/use-profile';
import { TimeSheet } from '@/features/reminders/components/time-sheet';
import { useIsOnline } from '@/hooks/use-is-online';
import { t, tf } from '@/i18n';
import { spacing } from '@/theme/tokens';

const DEFAULT_TIME = { hour: 20, minute: 0 };

/**
 * Notificaciones (tablero 8.7): permiso del sistema (con «abrir ajustes» si se denegó) y el
 * recordatorio diario (`notification_preferences.daily_reminder_*`). Los avisos de la agenda van con
 * cada recordatorio (no hay preferencia por tipo: falta columna, `PANTALLAS.md` §6.6).
 */
export default function NotificationSettingsScreen() {
  const router = useRouter();
  const { canUseServer } = useAuth();
  const online = useIsOnline();
  const { pets } = useActivePet();
  const preferences = useNotificationPreferences();
  const save = useSaveNotificationPreferences();
  const { permission, request } = useNotificationPermission();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const writable = canUseServer && online;
  const back = () => (router.canGoBack() ? router.back() : router.replace('/settings'));

  const persist = (patch: Parameters<typeof save.mutate>[0]) => {
    setError(null);
    save.mutate(patch, { onError: () => setError(t('settings.saveError')) });
  };

  const onlyPet = pets.data?.length === 1 ? pets.data[0].name : null;
  const prefs = preferences.data;
  const enabled = prefs?.daily_reminder_enabled ?? true;
  const time = parseTimeOfDay(prefs?.daily_reminder_time) ?? DEFAULT_TIME;

  const permissionNotice = notificationsUnavailableReason ? (
    <Alert
      tone="info"
      message={notificationsUnavailableReason === 'web' ? t('notifications.web') : t('notifications.unavailable')}
    />
  ) : permission?.status === 'denied' ? (
    <Alert
      tone="warning"
      title={t('notifications.deniedTitle')}
      message={t('notifications.deniedText')}
      action={
        permission.canAskAgain
          ? { label: t('notifications.enable'), onPress: () => request.mutate() }
          : { label: t('notifications.openSettings'), onPress: openSystemSettings }
      }
    />
  ) : permission?.status === 'undetermined' ? (
    <Card variant="brand" style={styles.ask}>
      <Text variant="bodyStrong">{t('notifications.undeterminedTitle')}</Text>
      <Text variant="caption" color="inkMuted">
        {t('notifications.undeterminedText')}
      </Text>
      <Button label={t('notifications.enable')} size="md" loading={request.isPending} onPress={() => request.mutate()} />
    </Card>
  ) : null;

  return (
    <Screen align="top">
      <TopBar onBack={back} title={t('notifications.title')} />
      {permissionNotice}
      {!writable ? <Alert tone="warning" message={t('settings.offline')} /> : null}
      {error ? <Alert tone="error" message={error} /> : null}

      {prefs === undefined ? (
        preferences.isError ? (
          <ErrorState message={t('notifications.loadError')} onRetry={() => void preferences.refetch()} />
        ) : preferences.fetchStatus === 'idle' ? null : (
          <LoadingState />
        )
      ) : (
        <>
          <Card flush>
            <ListItem
              title={t('notifications.dailyTitle')}
              subtitle={onlyPet ? tf('notifications.dailyText', { name: onlyPet }) : t('notifications.dailyTextGeneric')}
              trailing={
                <View style={styles.switch}>
                  <Switch
                    value={enabled}
                    disabled={!writable || save.isPending}
                    onValueChange={(value) => persist({ daily_reminder_enabled: value })}
                    accessibilityLabel={t('notifications.dailyTitle')}
                  />
                </View>
              }
              divider={enabled}
            />
            {enabled ? (
              <ListItem
                plain
                title={t('notifications.time')}
                value={formatTimeOfDay(time)}
                onPress={writable ? () => setSheetOpen(true) : undefined}
              />
            ) : null}
          </Card>
          <Card flush>
            <ListItem icon={CalendarDays} title={t('notifications.agendaTitle')} subtitle={t('notifications.agendaText')} />
          </Card>
          <Text variant="caption" color="inkMuted">
            {t('notifications.footer')}
          </Text>
        </>
      )}

      <TimeSheet
        visible={sheetOpen}
        title={t('notifications.timeTitle')}
        value={time}
        onClose={() => setSheetOpen(false)}
        onConfirm={(value) => {
          setSheetOpen(false);
          persist({ daily_reminder_time: toTimeColumn(value) });
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  ask: {
    gap: spacing['2'],
  },
  switch: {
    paddingLeft: spacing['2'],
  },
});
