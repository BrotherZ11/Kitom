import { Alert } from '@/components/ui/alert';
import { openExactAlarmSettings, openSystemSettings } from '@/features/notifications/device-notifications';
import { useNotificationPermission } from '@/features/notifications/hooks/use-notification-permission';
import { t } from '@/i18n';

/**
 * Android 12+: con los avisos activados pero sin «Alarmas y recordatorios», el sistema puede retrasarlos
 * hasta 1 h. Se dice y se ofrece abrir ese ajuste (al volver a la app se reprograman como exactos).
 * No se muestra si no aplica (iOS, web, Expo Go) o si los avisos están desactivados.
 */
export function ExactAlarmsNotice() {
  const { permission, exactAlarms } = useNotificationPermission();
  if (permission?.status !== 'granted' || exactAlarms !== false) return null;
  return (
    <Alert
      tone="warning"
      title={t('notifications.exactTitle')}
      message={t('notifications.exactText')}
      action={{
        label: t('notifications.exactAction'),
        onPress: () => {
          if (!openExactAlarmSettings()) openSystemSettings();
        },
      }}
    />
  );
}
