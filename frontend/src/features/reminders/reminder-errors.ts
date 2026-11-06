import { ReminderChangedError, ReminderNotWritableError } from '@/features/reminders/api/reminders-remote';
import { ReminderOperationRepositoryError } from '@/features/reminders/offline/reminder-operation-repository';
import { ReminderEditRejectedError } from '@/features/reminders/offline/reminder-sync-engine';
import { t } from '@/i18n';
import { classifyServerError } from '@/lib/server-errors';

/** Mensaje de un error de la agenda (nunca el error crudo de Supabase). */
export function reminderErrorMessage(error: unknown): string {
  if (error instanceof ReminderChangedError) return t('agenda.errors.changed');
  if (error instanceof ReminderNotWritableError) {
    return error.reason === 'not_allowed' ? t('agenda.errors.notAllowed') : t('agenda.errors.gone');
  }
  if (error instanceof ReminderEditRejectedError) {
    return error.code === 'invalid_content' ? t('agenda.errors.invalid') : t('agenda.sync.blockedEdit');
  }
  if (error instanceof ReminderOperationRepositoryError || (error as { name?: unknown } | null)?.name === 'LocalStoreError') {
    return t('agenda.errors.localWrite');
  }
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
