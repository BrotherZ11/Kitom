import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/features/auth/auth-context';
import { isLocalPetId } from '@/features/pets/offline/pet-operation';
import { petKeys } from '@/features/pets/query-keys';
import {
  createReminder,
  deleteReminder,
  fetchPendingReminders,
  fetchPetReminders,
  fetchReminder,
  fetchUpcomingReminders,
  ReminderChangedError,
  ReminderNotWritableError,
  updateReminder,
} from '@/features/reminders/api/reminders-api';
import { reminderKeys } from '@/features/reminders/query-keys';
import {
  planCompletion,
  snoozeUntil,
  type Reminder,
  type ReminderWrite,
  type SnoozeOption,
} from '@/features/reminders/reminder-model';
import { classifyServerError } from '@/lib/server-errors';

/**
 * Agenda (`reminders`) con TanStack Query. Solo con conexión: sin sesión utilizable no se pide nada
 * (`enabled: canUseServer`) y las escrituras fallan al instante (`serverCall`). La agenda no tiene
 * copia en el dispositivo (decisión 2026-10-21 en `docs/DECISIONS.md`); los avisos ya programados sí
 * siguen funcionando sin red.
 */

function useReminderSession() {
  const auth = useAuth();
  const userId = auth.user?.id ?? '';
  return { auth, userId };
}

/** Agenda de una mascota. Una mascota aún sin crear en el servidor (id local) no tiene. */
export function usePetReminders(petId: string) {
  const { auth, userId } = useReminderSession();
  return useQuery({
    queryKey: reminderKeys.pet(userId, petId),
    enabled: auth.canUseServer && userId !== '' && !isLocalPetId(petId),
    queryFn: () => auth.serverCall(() => fetchPetReminders(petId)),
  });
}

/** Pendientes de todas las mascotas visibles, vencidos incluidos (listado general). */
export function usePendingReminders() {
  const { auth, userId } = useReminderSession();
  return useQuery({
    queryKey: reminderKeys.pending(userId),
    enabled: auth.canUseServer && userId !== '',
    queryFn: () => auth.serverCall(() => fetchPendingReminders()),
  });
}

/** Pendientes que aún tienen que sonar (para los avisos del dispositivo). */
export function useUpcomingReminders(enabled: boolean) {
  const { auth, userId } = useReminderSession();
  return useQuery({
    queryKey: reminderKeys.upcoming(userId),
    enabled: enabled && auth.canUseServer && userId !== '',
    queryFn: () => auth.serverCall(() => fetchUpcomingReminders()),
  });
}

export function useReminder(reminderId: string) {
  const { auth, userId } = useReminderSession();
  return useQuery({
    queryKey: reminderKeys.detail(userId, reminderId),
    enabled: auth.canUseServer && userId !== '',
    queryFn: () => auth.serverCall(() => fetchReminder(reminderId)),
  });
}

/** Tras escribir: la fila nueva en su detalle y el resto de la agenda (y los avisos) se revalidan. */
function useAfterWrite() {
  const queryClient = useQueryClient();
  const { userId } = useReminderSession();
  return (saved: Reminder | null, removedId?: string) => {
    if (saved) queryClient.setQueryData(reminderKeys.detail(userId, saved.id), saved);
    if (removedId) queryClient.removeQueries({ queryKey: reminderKeys.detail(userId, removedId) });
    return queryClient.invalidateQueries({
      queryKey: reminderKeys.user(userId),
      // El detalle recién escrito ya está al día.
      predicate: (query) => !saved || query.queryKey[3] !== saved.id,
    });
  };
}

/**
 * Tras una escritura rechazada (otra versión, sin permiso o ya no está): lo que se ve está viejo. Se
 * revalidan la agenda y el permiso de la mascota (p. ej. le quitaron la co-tutoría o lo bajaron a
 * lector), para que la pantalla deje de ofrecer lo que ya no puede hacer.
 */
function useAfterRejection() {
  const queryClient = useQueryClient();
  const { userId } = useReminderSession();
  return (error: unknown, petId: string) => {
    const rejected =
      error instanceof ReminderChangedError ||
      error instanceof ReminderNotWritableError ||
      classifyServerError(error) === 'not_allowed';
    if (!rejected) return;
    void queryClient.invalidateQueries({ queryKey: reminderKeys.user(userId) });
    void queryClient.invalidateQueries({ queryKey: petKeys.canEdit(userId, petId) });
  };
}

export function useCreateReminder(petId: string) {
  const { auth, userId } = useReminderSession();
  const afterWrite = useAfterWrite();
  const afterRejection = useAfterRejection();
  return useMutation({
    mutationFn: (values: ReminderWrite) => auth.serverCall(() => createReminder(petId, userId, values)),
    onSuccess: (saved) => afterWrite(saved),
    onError: (error) => afterRejection(error, petId),
  });
}

/** Editar desde el formulario: solo si nadie lo cambió desde que se abrió (`updated_at`). */
export function useEditReminder(reminder: Reminder | null) {
  const { auth } = useReminderSession();
  const afterWrite = useAfterWrite();
  const afterRejection = useAfterRejection();
  return useMutation({
    mutationFn: (values: ReminderWrite) => {
      if (!reminder) throw new Error('reminder_missing');
      // Cambiar la fecha o la repetición anula un aplazamiento anterior.
      return auth.serverCall(() =>
        updateReminder(reminder.id, { ...values, snooze_until: null }, reminder.updated_at)
      );
    },
    onSuccess: (saved) => afterWrite(saved),
    onError: (error) => {
      if (reminder) afterRejection(error, reminder.pet_id);
    },
  });
}

export type CompletionResult = { saved: Reminder; undo: () => Promise<void>; next: Date | null };

/**
 * «Hecho»: sin repetición pasa a hecho; con repetición avanza a la próxima vez (`planCompletion`).
 * Devuelve cómo deshacerlo (también con precondición: si alguien lo cambió entretanto, no se pisa).
 */
export function useCompleteReminder() {
  const { auth } = useReminderSession();
  const afterWrite = useAfterWrite();
  const afterRejection = useAfterRejection();
  return useMutation({
    mutationFn: async (reminder: Reminder): Promise<CompletionResult> => {
      const plan = planCompletion(reminder, new Date());
      const saved = await auth.serverCall(() => updateReminder(reminder.id, plan.patch, reminder.updated_at));
      const undo = async () => {
        const restored = await auth.serverCall(() => updateReminder(saved.id, plan.undo, saved.updated_at));
        await afterWrite(restored);
      };
      return { saved, undo, next: plan.kind === 'advance' ? plan.next : null };
    },
    onSuccess: ({ saved }) => afterWrite(saved),
    onError: (error, reminder) => afterRejection(error, reminder.pet_id),
  });
}

/** Volver a pendiente uno hecho (desde la lista, tocando de nuevo el círculo). */
export function useReopenReminder() {
  const { auth } = useReminderSession();
  const afterWrite = useAfterWrite();
  const afterRejection = useAfterRejection();
  return useMutation({
    mutationFn: (reminder: Reminder) =>
      auth.serverCall(() => updateReminder(reminder.id, { status: 'pending' }, reminder.updated_at)),
    onSuccess: (saved) => afterWrite(saved),
    onError: (error, reminder) => afterRejection(error, reminder.pet_id),
  });
}

export type ActiveResult = { saved: Reminder; undo: () => Promise<void> };

/**
 * Activar o desactivar (`is_active`). Desactivar no toca `status`: sigue pendiente y, al reactivarlo,
 * vuelve tal cual (si su hora ya pasó, como vencido). Con precondición y con «Deshacer».
 */
export function useSetReminderActive() {
  const { auth } = useReminderSession();
  const afterWrite = useAfterWrite();
  const afterRejection = useAfterRejection();
  return useMutation({
    mutationFn: async ({ reminder, active }: { reminder: Reminder; active: boolean }): Promise<ActiveResult> => {
      const saved = await auth.serverCall(() => updateReminder(reminder.id, { is_active: active }, reminder.updated_at));
      const undo = async () => {
        const restored = await auth.serverCall(() => updateReminder(saved.id, { is_active: !active }, saved.updated_at));
        await afterWrite(restored);
      };
      return { saved, undo };
    },
    onSuccess: ({ saved }) => afterWrite(saved),
    onError: (error, { reminder }) => afterRejection(error, reminder.pet_id),
  });
}

export function useSnoozeReminder() {
  const { auth } = useReminderSession();
  const afterWrite = useAfterWrite();
  const afterRejection = useAfterRejection();
  return useMutation({
    mutationFn: ({ reminder, option }: { reminder: Reminder; option: SnoozeOption }) =>
      auth.serverCall(() =>
        updateReminder(
          reminder.id,
          { snooze_until: snoozeUntil(option, reminder, new Date()).toISOString() },
          reminder.updated_at
        )
      ),
    onSuccess: (saved) => afterWrite(saved),
    onError: (error, { reminder }) => afterRejection(error, reminder.pet_id),
  });
}

export function useDeleteReminder() {
  const { auth } = useReminderSession();
  const afterWrite = useAfterWrite();
  const afterRejection = useAfterRejection();
  return useMutation({
    mutationFn: (reminder: Reminder) => auth.serverCall(() => deleteReminder(reminder.id)),
    onSuccess: (_, reminder) => afterWrite(null, reminder.id),
    onError: (error, reminder) => afterRejection(error, reminder.pet_id),
  });
}
