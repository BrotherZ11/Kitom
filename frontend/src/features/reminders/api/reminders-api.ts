import { createRemindersRemote } from '@/features/reminders/api/reminders-remote';
import { supabase } from '@/lib/supabase';

/**
 * Acceso a `reminders` con el cliente de la app. La lógica y el contrato (RLS, GRANT por columna,
 * precondición `updated_at`) están en `reminders-remote.ts`.
 */

export { ReminderChangedError, ReminderNotWritableError } from '@/features/reminders/api/reminders-remote';

export const {
  fetchPetReminders,
  fetchPendingReminders,
  fetchUpcomingReminders,
  fetchReminder,
  createReminder,
  updateReminder,
  deleteReminder,
} = createRemindersRemote(supabase);
