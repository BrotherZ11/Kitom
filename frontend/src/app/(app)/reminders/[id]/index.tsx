import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Alert } from '@/components/ui/alert';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import { IconButton } from '@/components/ui/icon-button';
import { Bell, BellOff, CalendarDays, Check, Clock, Pencil, Repeat, Trash } from '@/components/ui/icons';
import { ListItem } from '@/components/ui/list-item';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { Tag } from '@/components/ui/tag';
import { Text } from '@/components/ui/text';
import { useToast } from '@/components/ui/toast';
import { TopBar } from '@/components/ui/top-bar';
import { useAuth } from '@/features/auth/auth-context';
import { notificationsUnavailableReason } from '@/features/notifications/device-notifications';
import { useNotificationPermission } from '@/features/notifications/hooks/use-notification-permission';
import { reminderNotifyState } from '@/features/notifications/notification-plan';
import { useActivePet } from '@/features/pets/active-pet-context';
import { useCanEditPet } from '@/features/pets/hooks/use-pets';
import {
  useCompleteReminder,
  useDeleteReminder,
  useReminder,
  useReopenReminder,
  useSnoozeReminder,
} from '@/features/reminders/hooks/use-reminders';
import { reminderErrorMessage } from '@/features/reminders/reminder-errors';
import { formatReminderLongDay, formatReminderTime } from '@/features/reminders/reminder-format';
import {
  effectiveDueAt,
  nextOccurrence,
  parseRecurrence,
  SNOOZE_OPTIONS,
  type Reminder,
  type SnoozeOption,
} from '@/features/reminders/reminder-model';
import { REMINDER_TYPE_ICONS, reminderWhenLabel } from '@/features/reminders/reminder-text';
import { useIsOnline } from '@/hooks/use-is-online';
import { useTheme } from '@/hooks/use-theme';
import { getLocale, t, tf } from '@/i18n';
import { createSubmitGuard } from '@/lib/submit-guard';
import { radius, spacing } from '@/theme/tokens';

/** Detalle del recordatorio (tablero 8.4): cuándo, repetición, aviso, notas y acciones. */
export default function ReminderDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const reminder = useReminder(id);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/agenda'));

  if (reminder.data) return <ReminderDetail reminder={reminder.data} onBack={back} />;
  return (
    <Screen align="top">
      <TopBar onBack={back} />
      {reminder.isPending && reminder.fetchStatus !== 'idle' ? (
        <LoadingState />
      ) : reminder.isError || reminder.fetchStatus === 'idle' ? (
        <ErrorState
          offline={reminder.fetchStatus === 'idle'}
          message={reminder.isError ? reminderErrorMessage(reminder.error) : t('agenda.errors.offlineTitle')}
          description={reminder.isError ? undefined : t('agenda.errors.offlineText')}
          onRetry={() => void reminder.refetch()}
        />
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

function ReminderDetail({ reminder, onBack }: { reminder: Reminder; onBack: () => void }) {
  const router = useRouter();
  const theme = useTheme();
  const toast = useToast();
  const locale = getLocale();
  const { canUseServer } = useAuth();
  const online = useIsOnline();
  const { pets } = useActivePet();
  const permission = useCanEditPet(reminder.pet_id);
  const { permission: notifications } = useNotificationPermission();
  const complete = useCompleteReminder();
  const reopen = useReopenReminder();
  const snooze = useSnoozeReminder();
  const remove = useDeleteReminder();
  const [guard] = useState(createSubmitGuard);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const now = new Date();
  // Mascota con una eliminación guardada en este dispositivo: ya no está en la lista, no avisa y su
  // agenda no se cambia (el servidor la borrará con sus recordatorios; si se deshace, todo vuelve).
  const deletion = pets.deletions.find((item) => item.op.petId === reminder.pet_id || item.op.localId === reminder.pet_id);
  const petName = pets.data?.find((pet) => pet.id === reminder.pet_id)?.name ?? deletion?.pet.name ?? '';
  const canWrite = permission.data === true && canUseServer && online && !deletion;
  const pending = reminder.status === 'pending';
  const at = effectiveDueAt(reminder);
  const due = new Date(reminder.due_at);
  const recurrence = parseRecurrence(reminder.recurrence_rule);
  const next = nextOccurrence(due, recurrence);
  const snoozed = pending && at.getTime() !== due.getTime();
  const busy = complete.isPending || reopen.isPending || snooze.isPending || remove.isPending;
  const notify = reminderNotifyState({
    unavailable: notificationsUnavailableReason,
    permission: notifications?.status ?? null,
    pending,
    at,
    now,
    petDeleting: deletion !== undefined,
  });

  const run = (action: () => Promise<void>) => {
    void guard.run(async () => {
      setError(null);
      try {
        await action();
      } catch (cause) {
        setError(reminderErrorMessage(cause));
      }
    });
  };

  const markDone = () =>
    run(async () => {
      const result = await complete.mutateAsync(reminder);
      toast({
        message: result.next
          ? tf('agenda.toast.doneNext', { date: reminderWhenLabel(result.next, new Date()) })
          : t('agenda.toast.done'),
        action: {
          label: t('agenda.toast.undo'),
          onPress: () => {
            result.undo().then(
              () => toast({ message: t('agenda.toast.undone') }),
              (cause: unknown) => toast({ message: reminderErrorMessage(cause) })
            );
          },
        },
      });
    });

  const markPending = () =>
    run(async () => {
      await reopen.mutateAsync(reminder);
      toast({ message: t('agenda.toast.reopened') });
    });

  const chooseSnooze = (option: SnoozeOption) => {
    setSheetOpen(false);
    run(async () => {
      const saved = await snooze.mutateAsync({ reminder, option });
      toast({ message: tf('agenda.toast.snoozed', { date: reminderWhenLabel(effectiveDueAt(saved), new Date()) }) });
    });
  };

  const confirmRemove = () =>
    run(async () => {
      await remove.mutateAsync(reminder);
      setConfirmDelete(false);
      toast({ message: t('agenda.toast.deleted') });
      onBack();
    });

  const footer = canWrite ? (
    pending ? (
      <>
        <Button label={t('agenda.detail.markDone')} icon={Check} loading={complete.isPending} disabled={busy} onPress={markDone} />
        <Button
          label={t('agenda.detail.snooze')}
          icon={Clock}
          variant="secondary"
          size="md"
          disabled={busy}
          onPress={() => setSheetOpen(true)}
        />
      </>
    ) : (
      <Button label={t('agenda.detail.reopen')} variant="secondary" loading={reopen.isPending} disabled={busy} onPress={markPending} />
    )
  ) : undefined;

  return (
    <>
      <Screen align="top" footer={footer}>
        <TopBar
          onBack={onBack}
          right={
            canWrite ? (
              <View style={styles.actions}>
                <IconButton
                  icon={Pencil}
                  accessibilityLabel={t('agenda.detail.edit')}
                  disabled={busy}
                  onPress={() => router.push({ pathname: '/reminders/[id]/edit', params: { id: reminder.id } })}
                />
                <IconButton
                  icon={Trash}
                  accessibilityLabel={t('agenda.detail.delete')}
                  disabled={busy}
                  onPress={() => setConfirmDelete(true)}
                />
              </View>
            ) : null
          }
        />

        <View style={styles.heading}>
          <View style={[styles.tile, { backgroundColor: pending ? theme.surfaceBrand : theme.surfaceSunken }]}>
            <Icon icon={REMINDER_TYPE_ICONS[reminder.type]} size={28} color={pending ? 'primary' : 'inkMuted'} />
          </View>
          <Text variant="overline" color="inkMuted">
            {tf('agenda.detail.overline', { type: t(`agenda.types.${reminder.type}`), name: petName })}
          </Text>
          <Text variant="title1" accessibilityRole="header">
            {reminder.title}
          </Text>
          {!pending && reminder.completed_at ? (
            <View style={styles.tag}>
              <Tag
                tone="success"
                icon={Check}
                label={tf('agenda.detail.done', {
                  date: formatReminderLongDay(new Date(reminder.completed_at), now, locale).toLowerCase(),
                })}
              />
            </View>
          ) : null}
        </View>

        {deletion ? <Alert tone="warning" message={tf('agenda.detail.petDeleting', { name: petName })} /> : null}
        {permission.data === false ? <Alert tone="info" message={tf('agenda.detail.readOnly', { name: petName })} /> : null}
        {!canUseServer || !online ? <Alert tone="warning" message={t('agenda.errors.network')} /> : null}
        {error ? <Alert tone="error" message={error} /> : null}

        <Card flush>
          <ListItem
            plain
            icon={CalendarDays}
            title={formatReminderLongDay(at, now, locale)}
            subtitle={
              snoozed
                ? tf('agenda.detail.snoozed', { date: reminderWhenLabel(at, now) })
                : formatReminderTime(at)
            }
            divider
          />
          <ListItem
            plain
            icon={Repeat}
            title={t(`agenda.recurrence.${recurrence}`)}
            subtitle={
              next && pending
                ? tf('agenda.detail.repeatsNext', { date: formatReminderLongDay(next, now, locale).toLowerCase() })
                : recurrence === 'NONE'
                  ? t('agenda.detail.repeatsNone')
                  : undefined
            }
            divider={pending}
          />
          {notify !== 'none' ? (
            <ListItem
              plain
              icon={notify === 'on' ? Bell : BellOff}
              title={t(`agenda.detail.notify.${notify}`)}
              subtitle={notify === 'on' ? formatReminderTime(at) : undefined}
            />
          ) : null}
        </Card>

        {reminder.description ? (
          <Card variant="flat" style={styles.notes}>
            <Text variant="overline" color="inkMuted">
              {t('agenda.detail.notes')}
            </Text>
            <Text>{reminder.description}</Text>
          </Card>
        ) : null}
      </Screen>

      <BottomSheet visible={sheetOpen} title={t('agenda.snooze.title')} onClose={() => setSheetOpen(false)}>
        <Card flush>
          {SNOOZE_OPTIONS.map((option, index) => (
            <ListItem
              key={option}
              plain
              icon={Clock}
              title={t(`agenda.snooze.${option}`)}
              chevron={false}
              divider={index < SNOOZE_OPTIONS.length - 1}
              onPress={() => chooseSnooze(option)}
            />
          ))}
        </Card>
      </BottomSheet>

      <Dialog
        visible={confirmDelete}
        tone="danger"
        icon={Trash}
        title={tf('agenda.delete.title', { title: reminder.title })}
        message={
          recurrence === 'NONE'
            ? t('agenda.delete.text')
            : tf('agenda.delete.textRepeat', { repeat: t(`agenda.recurrence.${recurrence}`).toLowerCase() })
        }
        confirmLabel={t('agenda.delete.confirm')}
        loading={remove.isPending}
        error={confirmDelete ? error : null}
        onConfirm={confirmRemove}
        onCancel={() => {
          setConfirmDelete(false);
          setError(null);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
  },
  heading: {
    gap: spacing['3'],
  },
  tile: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tag: {
    alignSelf: 'flex-start',
  },
  notes: {
    gap: 6,
  },
});
