import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';

import { useToast } from '@/components/ui/toast';
import { useReminderNotifyHint } from '@/features/notifications/hooks/use-notify-hint';
import { useActivePet } from '@/features/pets/active-pet-context';
import { ReminderForm } from '@/features/reminders/components/reminder-form';
import { ReminderScreenGate } from '@/features/reminders/components/reminder-screen-gate';
import { useCreateReminder } from '@/features/reminders/hooks/use-reminders';
import { reminderErrorMessage } from '@/features/reminders/reminder-errors';
import {
  localDateKey,
  REMINDER_TYPES,
  toReminderFormValues,
  toReminderWrite,
  type ReminderFormValues,
  type ReminderType,
} from '@/features/reminders/reminder-model';
import { t } from '@/i18n';

/**
 * Nuevo recordatorio (tablero 8.3). `petId` es la mascota; `date` (`YYYY-MM-DD`, desde el calendario)
 * y `type` (desde los accesos de la agenda vacía) son opcionales.
 */
export default function NewReminderScreen() {
  const { petId, date, type } = useLocalSearchParams<{ petId: string; date?: string; type?: string }>();
  return (
    <ReminderScreenGate petId={petId}>
      {(petName) => <NewReminderForm petId={petId} petName={petName} date={date} type={type} />}
    </ReminderScreenGate>
  );
}

function NewReminderForm({ petId, petName, date, type }: { petId: string; petName: string; date?: string; type?: string }) {
  const router = useRouter();
  const toast = useToast();
  const create = useCreateReminder(petId);
  const notifyHint = useReminderNotifyHint();
  const { setActivePet } = useActivePet();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialValues] = useState(() => {
    const now = new Date();
    const values = toReminderFormValues(null, {
      now,
      type: REMINDER_TYPES.includes(type as ReminderType) ? (type as ReminderType) : undefined,
    });
    // Un día del calendario anterior a hoy no vale para uno nuevo: se queda el de por defecto.
    return date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= localDateKey(now) ? { ...values, date } : values;
  });
  const close = () => (router.canGoBack() ? router.back() : router.replace('/agenda'));

  const submit = async (values: ReminderFormValues) => {
    setError(null);
    try {
      await create.mutateAsync(toReminderWrite(values));
      setSaved(true);
      // La agenda que se ve es la de la mascota activa: la del recordatorio nuevo.
      setActivePet(petId);
      toast({ message: t('agenda.toast.created') });
      close();
    } catch (cause) {
      setError(reminderErrorMessage(cause));
    }
  };

  return (
    <ReminderForm
      mode="new"
      petName={petName}
      initialValues={initialValues}
      isSubmitting={create.isPending}
      submitError={error}
      notifyHint={notifyHint}
      leaveAllowed={saved}
      onSubmit={(values) => void submit(values)}
      onClose={close}
    />
  );
}
