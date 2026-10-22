import { ReminderChangedError } from '@/features/reminders/api/reminders-api';
import { t } from '@/i18n';
import { classifyServerError } from '@/lib/server-errors';

/** Mensaje de un error de la agenda (nunca el error crudo de Supabase). */
export function reminderErrorMessage(error: unknown): string {
  if (error instanceof ReminderChangedError) return t('agenda.errors.changed');
  switch (classifyServerError(error)) {
    case 'network':
      return t('agenda.errors.network');
    case 'not_allowed':
      return t('agenda.errors.notAllowed');
    case 'not_found':
      return t('agenda.errors.notFound');
    case 'invalid':
      return t('agenda.errors.invalid');
    default:
      if (__DEV__) console.warn('[reminders]', error);
      return t('agenda.errors.unknown');
  }
}
