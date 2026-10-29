import type { SupabaseClient } from '@supabase/supabase-js';

import type { Reminder, ReminderWrite } from '@/features/reminders/reminder-model';
import type { Database, TablesUpdate } from '@/types/database.types';

import { REMINDER_COLUMNS } from '../reminder-model.ts';

/**
 * Acceso a `reminders` con el cliente inyectado (se prueba contra el Supabase local:
 * `reminders.integration.test.mjs`). RLS: leen los miembros de la mascota (`is_pet_member`) y escriben
 * los editores (`can_edit_pet`; al crear, además, `created_by = auth.uid()`). GRANT por columna: nunca
 * se envían `pet_id`/`created_by` al editar (un recordatorio no cambia de mascota), ni `id`,
 * `created_at` o `updated_at`. `completed_at` lo pone el trigger `sync_reminder_completion` según
 * `status`. Lanzan el error de supabase-js tal cual (la UI lo traduce con `reminderErrorMessage`).
 */

/** Días que se siguen mostrando los recordatorios ya hechos. */
export const DONE_RETENTION_DAYS = 30;
/** Tope de filas por consulta (una agenda doméstica no se acerca). */
const LIMIT = 300;

/** Otro dispositivo o co-tutor lo cambió (o lo borró) después de leerlo. */
export class ReminderChangedError extends Error {
  readonly code = 'reminder_changed';

  constructor() {
    super('reminder_changed');
    this.name = 'ReminderChangedError';
  }
}

/**
 * La escritura no tocó ninguna fila y no es un conflicto: `not_allowed` si la fila se ve pero no se
 * puede cambiar (co-tutor lector: RLS deja leer, no escribir); `gone` si ya no se ve (borrada, o sin
 * acceso a la mascota).
 */
export class ReminderNotWritableError extends Error {
  readonly code = 'reminder_not_writable';
  readonly reason: 'not_allowed' | 'gone';

  constructor(reason: 'not_allowed' | 'gone') {
    super(`reminder_${reason}`);
    this.name = 'ReminderNotWritableError';
    this.reason = reason;
  }
}

export type ReminderPatch = Pick<
  TablesUpdate<'reminders'>,
  'type' | 'title' | 'description' | 'due_at' | 'recurrence_rule' | 'snooze_until' | 'status' | 'is_active'
>;

export function createRemindersRemote(client: SupabaseClient<Database>) {
  async function fetchReminder(reminderId: string): Promise<Reminder | null> {
    const { data, error } = await client.from('reminders').select(REMINDER_COLUMNS).eq('id', reminderId).maybeSingle();
    if (error) throw error;
    return data;
  }

  /**
   * Por qué una escritura no tocó ninguna fila (RLS no da error: filtra). Se relee la fila: si no se ve,
   * ya no está; si cambió desde `expectedUpdatedAt`, es un conflicto; si sigue igual, falta permiso.
   */
  async function rejection(reminderId: string, expectedUpdatedAt?: string): Promise<Error> {
    const current = await fetchReminder(reminderId);
    if (!current) return new ReminderNotWritableError('gone');
    if (expectedUpdatedAt && current.updated_at !== expectedUpdatedAt) return new ReminderChangedError();
    return new ReminderNotWritableError('not_allowed');
  }

  return {
    /** Agenda de una mascota: pendientes y los hechos en los últimos 30 días. */
    async fetchPetReminders(petId: string, now = new Date()): Promise<Reminder[]> {
      const since = new Date(now.getTime() - DONE_RETENTION_DAYS * 86_400_000).toISOString();
      const { data, error } = await client
        .from('reminders')
        .select(REMINDER_COLUMNS)
        .eq('pet_id', petId)
        // Valor entre comillas: el instante lleva `:` y `.` (sintaxis de filtros de PostgREST).
        .or(`status.eq.pending,completed_at.gte."${since}"`)
        .order('due_at', { ascending: true })
        .limit(LIMIT);
      if (error) throw error;
      return data;
    },

    /** Pendientes de todas las mascotas visibles, vencidos y desactivados incluidos (listado general). */
    async fetchPendingReminders(): Promise<Reminder[]> {
      const { data, error } = await client
        .from('reminders')
        .select(REMINDER_COLUMNS)
        .eq('status', 'pending')
        .order('due_at', { ascending: true })
        .limit(LIMIT);
      if (error) throw error;
      return data;
    },

    /**
     * Pendientes activos que aún tienen que sonar (`due_at` o `snooze_until` después de `now`), para
     * programar los avisos del dispositivo. Sin los vencidos (muchos vencidos nunca dejan fuera a los
     * próximos) ni los desactivados.
     */
    async fetchUpcomingReminders(now = new Date()): Promise<Reminder[]> {
      const at = now.toISOString();
      const { data, error } = await client
        .from('reminders')
        .select(REMINDER_COLUMNS)
        .eq('status', 'pending')
        .eq('is_active', true)
        .or(`due_at.gt."${at}",snooze_until.gt."${at}"`)
        .order('due_at', { ascending: true })
        .limit(LIMIT);
      if (error) throw error;
      return data;
    },

    /** `null` si no existe o no hay acceso (RLS no distingue ambos casos). */
    fetchReminder,

    async createReminder(petId: string, userId: string, values: ReminderWrite): Promise<Reminder> {
      const { data, error } = await client
        .from('reminders')
        .insert({ ...values, pet_id: petId, created_by: userId, status: 'pending' })
        .select(REMINDER_COLUMNS)
        .single();
      if (error) throw error;
      return data;
    },

    /**
     * Cambia un recordatorio. Con `expectedUpdatedAt`, solo si nadie lo ha cambiado desde esa versión
     * (`updated_at` tal cual lo dio el servidor). Si no toca ninguna fila: `ReminderChangedError` (otra
     * versión) o `ReminderNotWritableError` (sin permiso, o ya no está).
     */
    async updateReminder(reminderId: string, patch: ReminderPatch, expectedUpdatedAt?: string): Promise<Reminder> {
      let query = client.from('reminders').update(patch).eq('id', reminderId);
      if (expectedUpdatedAt) query = query.eq('updated_at', expectedUpdatedAt);
      const { data, error } = await query.select(REMINDER_COLUMNS);
      if (error) throw error;
      if (!data[0]) throw await rejection(reminderId, expectedUpdatedAt);
      return data[0];
    },

    async deleteReminder(reminderId: string): Promise<void> {
      const { data, error } = await client.from('reminders').delete().eq('id', reminderId).select('id');
      if (error) throw error;
      if (data.length === 0) throw await rejection(reminderId);
    },
  };
}

export type RemindersRemote = ReturnType<typeof createRemindersRemote>;
