import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Bell, Clock } from '@/components/ui/icons';
import { PickerField } from '@/components/ui/picker-field';
import { Text } from '@/components/ui/text';
import { WeekRing } from '@/components/ui/week-ring';
import { notificationsSupported, notificationsUnavailableReason } from '@/features/notifications/device-notifications';
import { useNotificationPermission } from '@/features/notifications/hooks/use-notification-permission';
import { formatTimeOfDay, parseTimeOfDay, toTimeColumn, type TimeOfDay } from '@/features/notifications/notification-plan';
import { isLocalPetId } from '@/features/pets/offline/pet-operation';
import { SetupFrame } from '@/features/profile/components/setup-frame';
import {
  useCompleteOnboarding,
  useNotificationPreferences,
  useSaveNotificationPreferences,
} from '@/features/profile/hooks/use-profile';
import { TimeSheet } from '@/features/reminders/components/time-sheet';
import { useTheme } from '@/hooks/use-theme';
import { t, tf } from '@/i18n';
import { createSubmitGuard } from '@/lib/submit-guard';
import { radius, spacing } from '@/theme/tokens';

const DEFAULT_TIME: TimeOfDay = { hour: 20, minute: 0 };

/**
 * Mascota creada (tablero 3.4) y permiso de avisos (3.5, explicado antes del diálogo del sistema): hora
 * del recordatorio diario (`notification_preferences`) y fin de la configuración inicial. Después, el
 * primer registro.
 */
export default function SetupPetCreatedScreen() {
  const router = useRouter();
  const { petId, name } = useLocalSearchParams<{ petId: string; name?: string }>();
  const theme = useTheme();
  const preferences = useNotificationPreferences();
  const save = useSaveNotificationPreferences();
  const complete = useCompleteOnboarding();
  const { permission, request } = useNotificationPermission();
  const [time, setTime] = useState<TimeOfDay | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guard] = useState(createSubmitGuard);
  const current = time ?? parseTimeOfDay(preferences.data?.daily_reminder_time) ?? DEFAULT_TIME;
  const petName = name ?? '';
  const denied = permission?.status === 'denied' && !permission.canAskAgain;
  const busy = save.isPending || complete.isPending || request.isPending;

  const finish = (enabled: boolean) => {
    void guard.run(async () => {
      setError(null);
      try {
        // El permiso del sistema es del dispositivo; la preferencia, de la cuenta.
        if (enabled && notificationsSupported && permission?.status !== 'granted') await request.mutateAsync();
        await save.mutateAsync({ daily_reminder_enabled: enabled, daily_reminder_time: toTimeColumn(current) });
        await complete.mutateAsync();
        router.replace('/');
        // El primer registro, encima de Hoy (una mascota aún sin subir no tiene registros).
        if (petId && !isLocalPetId(petId)) router.push({ pathname: '/pets/[id]/daily-log', params: { id: petId } });
      } catch {
        setError(t('setup.errors.save'));
      }
    });
  };

  return (
    <>
      <SetupFrame
        hero={
          <View style={[styles.hero, { backgroundColor: theme.surfaceBrand }]}>
            <WeekRing days={['off', 'off', 'off', 'off', 'off', 'off']} today="pending" size={56} accessibilityLabel="" />
          </View>
        }
        overline={t('setup.petCreated.overline')}
        title={tf('setup.petCreated.title', { name: petName })}
        text={t('setup.petCreated.text')}
        footer={
          <>
            {error ? <Alert tone="error" message={error} /> : null}
            <Button
              label={t('setup.petCreated.enable')}
              icon={Bell}
              loading={busy}
              loadingLabel={t('setup.saving')}
              onPress={() => finish(true)}
            />
            <Button label={t('setup.petCreated.skip')} variant="ghost" size="md" disabled={busy} onPress={() => finish(false)} />
          </>
        }>
        <PickerField
          label={t('setup.petCreated.time')}
          icon={Clock}
          mono
          value={formatTimeOfDay(current)}
          onPress={() => setSheetOpen(true)}
        />
        <Card variant="flat" style={styles.permission}>
          <Icon icon={Bell} size="sm" color="primary" />
          <View style={styles.flex}>
            <Text variant="bodyStrong">{t('setup.petCreated.permissionTitle')}</Text>
            <Text variant="caption" color="inkMuted">
              {notificationsUnavailableReason === 'web'
                ? t('setup.petCreated.web')
                : notificationsUnavailableReason === 'unavailable'
                  ? t('notifications.unavailable')
                : denied
                  ? t('setup.petCreated.denied')
                  : t('setup.petCreated.permissionText')}
            </Text>
          </View>
        </Card>
      </SetupFrame>
      <TimeSheet
        visible={sheetOpen}
        title={t('notifications.timeTitle')}
        value={current}
        onClose={() => setSheetOpen(false)}
        onConfirm={(value) => {
          setTime(value);
          setSheetOpen(false);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  hero: {
    width: 80,
    height: 80,
    borderRadius: radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing['1'],
  },
  permission: {
    flexDirection: 'row',
    gap: spacing['3'],
    alignItems: 'flex-start',
  },
  flex: {
    flex: 1,
    gap: 2,
  },
});
