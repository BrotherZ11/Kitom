import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';

import { CalendarDays } from '@/components/ui/icons';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { useToast } from '@/components/ui/toast';
import { TopBar } from '@/components/ui/top-bar';
import { useReminderNotifyHint } from '@/features/notifications/hooks/use-notify-hint';
import { ReminderForm } from '@/features/reminders/components/reminder-form';
import { ReminderScreenGate } from '@/features/reminders/components/reminder-screen-gate';
import { reminderOutcomeMessage } from '@/features/reminders/components/reminder-sync-status';
import { useEditReminder, useReminder } from '@/features/reminders/hooks/use-reminders';
import { reminderErrorMessage } from '@/features/reminders/reminder-errors';
import {
  toReminderFormValues,
  toReminderWrite,
  type Reminder,
  type ReminderFormValues,
} from '@/features/reminders/reminder-model';
import { t } from '@/i18n';

/**
 * Editar un recordatorio (tablero 8.3 con sus datos), también sin conexión desde la copia o un alta local. Con un
 * conflicto, sin permiso o con una eliminación guardada no se edita: primero se decide qué hacer (en el detalle).
 */
export default function EditReminderScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { view, refetch } = useReminder(id);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/agenda'));

  if (view.state === 'redirect') return <Redirect href={{ pathname: '/reminders/[id]/edit', params: { id: view.reminderId } }} />;
  if (view.state === 'ready') {
    const blocked = view.op && (view.op.kind === 'delete' || view.op.status === 'conflict' || view.op.status === 'forbidden');
    if (!blocked) {
      const current = view.reminder;
      return (
        <ReminderScreenGate petId={current.pet_id}>
          {(petName) => <EditReminderForm reminder={current} petName={petName} />}
        </ReminderScreenGate>
      );
    }
  }
  const content = () => {
    switch (view.state) {
      case 'loading':
        return <LoadingState />;
      case 'ready':
        return <EmptyState icon={CalendarDays} title={t('agenda.sync.blockedEdit')} actionLabel={t('common.back')} onAction={back} />;
      case 'offline_unavailable':
        return <ErrorState offline message={t('agenda.errors.offlineTitle')} description={t('agenda.offline.neverLoaded')} onRetry={refetch} />;
      case 'local_error':
        return <ErrorState message={t('agenda.offline.localError')} onRetry={refetch} />;
      case 'error':
        return <ErrorState message={reminderErrorMessage(view.error)} onRetry={refetch} />;
      default:
        return (
          <EmptyState
            icon={CalendarDays}
            title={t('agenda.detail.notFound')}
            description={t('agenda.detail.notFoundText')}
            actionLabel={t('common.back')}
            onAction={back}
          />
        );
    }
  };
  return (
    <Screen align="top">
      <TopBar onBack={back} />
      {content()}
    </Screen>
  );
}

function EditReminderForm({ reminder, petName }: { reminder: Reminder; petName: string }) {
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
      const outcome = await edit.mutateAsync(toReminderWrite(values));
      setSaved(true);
      toast({ message: reminderOutcomeMessage(outcome, t('agenda.toast.saved')) });
      close();
    } catch (cause) {
      setError(reminderErrorMessage(cause));
    }
  };

  return (
    <ReminderForm
      // Una versión nueva vuelve a montar el formulario con sus datos.
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
