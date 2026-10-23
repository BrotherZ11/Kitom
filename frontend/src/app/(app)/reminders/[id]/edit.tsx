import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';

import { CalendarDays } from '@/components/ui/icons';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { useToast } from '@/components/ui/toast';
import { TopBar } from '@/components/ui/top-bar';
import { useReminderNotifyHint } from '@/features/notifications/hooks/use-notify-hint';
import { ReminderChangedError } from '@/features/reminders/api/reminders-api';
import { ReminderForm } from '@/features/reminders/components/reminder-form';
import { ReminderScreenGate } from '@/features/reminders/components/reminder-screen-gate';
import { useEditReminder, useReminder } from '@/features/reminders/hooks/use-reminders';
import { reminderErrorMessage } from '@/features/reminders/reminder-errors';
import {
  toReminderFormValues,
  toReminderWrite,
  type Reminder,
  type ReminderFormValues,
} from '@/features/reminders/reminder-model';
import { t } from '@/i18n';

/** Editar un recordatorio (tablero 8.3 con sus datos). */
export default function EditReminderScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const reminder = useReminder(id);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/agenda'));

  if (reminder.data) {
    const current = reminder.data;
    return (
      <ReminderScreenGate petId={current.pet_id}>
        {(petName) => <EditReminderForm reminder={current} petName={petName} onRefetch={() => void reminder.refetch()} />}
      </ReminderScreenGate>
    );
  }
  return (
    <Screen align="top">
      <TopBar onBack={back} />
      {reminder.isPending ? (
        <LoadingState />
      ) : reminder.isError ? (
        <ErrorState message={reminderErrorMessage(reminder.error)} onRetry={() => void reminder.refetch()} />
      ) : (
        <EmptyState
          icon={CalendarDays}
          title={t('agenda.detail.notFound')}
          description={t('agenda.detail.notFoundText')}
          actionLabel={t('common.back')}
          onAction={back}
        />
      )}
    </Screen>
  );
}

function EditReminderForm({ reminder, petName, onRefetch }: { reminder: Reminder; petName: string; onRefetch: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const edit = useEditReminder(reminder);
  const notifyHint = useReminderNotifyHint();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => (router.canGoBack() ? router.back() : router.replace({ pathname: '/reminders/[id]', params: { id: reminder.id } }));

  const submit = async (values: ReminderFormValues) => {
    setError(null);
    try {
      await edit.mutateAsync(toReminderWrite(values));
      setSaved(true);
      toast({ message: t('agenda.toast.saved') });
      close();
    } catch (cause) {
      setError(reminderErrorMessage(cause));
      // Otro dispositivo lo cambió: se carga la versión nueva (el formulario se vuelve a montar con ella).
      if (cause instanceof ReminderChangedError) onRefetch();
    }
  };

  return (
    <ReminderForm
      // Una versión nueva del servidor vuelve a montar el formulario con sus datos.
      key={reminder.updated_at}
      mode="edit"
      petName={petName}
      initialValues={toReminderFormValues(reminder, { now: new Date() })}
      isSubmitting={edit.isPending}
      submitError={error}
      notifyHint={notifyHint}
      leaveAllowed={saved}
      onSubmit={(values) => void submit(values)}
      onClose={close}
    />
  );
}
