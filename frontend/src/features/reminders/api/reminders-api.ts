import { REMINDER_COLUMNS, type Reminder, type ReminderWrite } from '@/features/reminders/reminder-model';
import { supabase } from '@/lib/supabase';
import type { TablesUpdate } from '@/types/database.types';

/**
 * Acceso a `reminders`. RLS: leen los miembros de la mascota (`is_pet_member`) y escriben los editores
 * (`can_edit_pet`; al crear, además, `created_by = auth.uid()`). GRANT por columna: nunca se envían
 * `pet_id`/`created_by` al editar, ni `id`, `created_at` o `updated_at`. `completed_at` lo pone el
 * trigger `sync_reminder_completion` según `status`.
 */

/** Días que se siguen mostrando los recordatorios ya hechos. */
export const DONE_RETENTION_DAYS = 30;
/** Tope de filas por consulta (una agenda doméstica no se acerca). */
const LIMIT = 300;

/** Agenda de una mascota: pendientes y los hechos en los últimos 30 días. */
export async function fetchPetReminders(petId: string, now = new Date()): Promise<Reminder[]> {
  const since = new Date(now.getTime() - DONE_RETENTION_DAYS * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from('reminders')
    .select(REMINDER_COLUMNS)
    .eq('pet_id', petId)
    // Valor entre comillas: el instante lleva `:` y `.` (sintaxis de filtros de PostgREST).
    .or(`status.eq.pending,completed_at.gte."${since}"`)
    .order('due_at', { ascending: true })
    .limit(LIMIT);
  if (error) throw error;
  return data;
}

/** Pendientes de todas las mascotas visibles (para programar los avisos del dispositivo). */
export async function fetchPendingReminders(): Promise<Reminder[]> {
  const { data, error } = await supabase
    .from('reminders')
    .select(REMINDER_COLUMNS)
    .eq('status', 'pending')
    .order('due_at', { ascending: true })
    .limit(LIMIT);
  if (error) throw error;
  return data;
}

export async function fetchReminder(reminderId: string): Promise<Reminder | null> {
  const { data, error } = await supabase.from('reminders').select(REMINDER_COLUMNS).eq('id', reminderId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function createReminder(petId: string, userId: string, values: ReminderWrite): Promise<Reminder> {
  const { data, error } = await supabase
    .from('reminders')
    .insert({ ...values, pet_id: petId, created_by: userId, status: 'pending' })
    .select(REMINDER_COLUMNS)
    .single();
  if (error) throw error;
  return data;
}

/** Otro dispositivo o co-tutor lo cambió (o lo borró) después de leerlo. */
export class ReminderChangedError extends Error {
  readonly code = 'reminder_changed';

  constructor() {
    super('reminder_changed');
    this.name = 'ReminderChangedError';
  }
}

type ReminderPatch = Pick<
  TablesUpdate<'reminders'>,
  'type' | 'title' | 'description' | 'due_at' | 'recurrence_rule' | 'snooze_until' | 'status'
>;

/**
 * Cambia un recordatorio. Con `expectedUpdatedAt`, solo si nadie lo ha cambiado desde esa versión
 * (`updated_at` tal cual lo dio el servidor): si no toca ninguna fila, `ReminderChangedError`.
 */
export async function updateReminder(
  reminderId: string,
  patch: ReminderPatch,
  expectedUpdatedAt?: string
): Promise<Reminder> {
  let query = supabase.from('reminders').update(patch).eq('id', reminderId);
  if (expectedUpdatedAt) query = query.eq('updated_at', expectedUpdatedAt);
  const { data, error } = await query.select(REMINDER_COLUMNS);
  if (error) throw error;
  if (!data[0]) throw new ReminderChangedError();
  return data[0];
}

export async function deleteReminder(reminderId: string): Promise<void> {
  const { data, error } = await supabase.from('reminders').delete().eq('id', reminderId).select('id');
  if (error) throw error;
  if (data.length === 0) throw new ReminderChangedError();
}
