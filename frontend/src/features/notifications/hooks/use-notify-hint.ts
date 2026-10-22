import { notificationsUnavailableReason } from '@/features/notifications/device-notifications';
import { useNotificationPermission } from '@/features/notifications/hooks/use-notification-permission';
import { t } from '@/i18n';

/** Qué pasará con el aviso de un recordatorio en este dispositivo (texto bajo el formulario). */
export function useReminderNotifyHint(): string {
  const { permission } = useNotificationPermission();
  if (notificationsUnavailableReason === 'web') return t('agenda.form.notifyWeb');
  if (notificationsUnavailableReason === 'unavailable') return t('agenda.form.notifyUnavailable');
  return permission?.status === 'granted' ? t('agenda.form.notifyOn') : t('agenda.form.notifyOff');
}
