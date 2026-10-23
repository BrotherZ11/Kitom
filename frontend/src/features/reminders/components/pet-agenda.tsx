import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Alert } from '@/components/ui/alert';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { IconButton } from '@/components/ui/icon-button';
import { CalendarDays, Plus, WifiOff } from '@/components/ui/icons';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Text } from '@/components/ui/text';
import { useToast } from '@/components/ui/toast';
import { useAuth } from '@/features/auth/auth-context';
import { formatLogDateLabel } from '@/features/daily-logs/log-date';
import { ExactAlarmsNotice } from '@/features/notifications/components/exact-alarms-notice';
import { notificationsSupported, openSystemSettings } from '@/features/notifications/device-notifications';
import { useNotificationPermission } from '@/features/notifications/hooks/use-notification-permission';
import { TAB_SCREEN_EDGES } from '@/features/pets/components/active-pet-gate';
import { PetSelectorSheet } from '@/features/pets/components/pet-selector-sheet';
import { useCanEditPet } from '@/features/pets/hooks/use-pets';
import { isLocalPetId } from '@/features/pets/offline/pet-operation';
import type { Pet } from '@/features/pets/types';
import { ReminderItem } from '@/features/reminders/components/reminder-item';
import { ReminderMonth, type MonthCursor } from '@/features/reminders/components/reminder-month';
import { useCompleteReminder, usePetReminders, useReopenReminder } from '@/features/reminders/hooks/use-reminders';
import { reminderErrorMessage } from '@/features/reminders/reminder-errors';
import {
  effectiveDueAt,
  groupReminders,
  localDateKey,
  reminderDaysInRange,
  REMINDER_TYPES,
  type Reminder,
  type ReminderType,
} from '@/features/reminders/reminder-model';
import { formatReminderDay } from '@/features/reminders/reminder-format';
import { REMINDER_TYPE_ICONS, reminderWhenLabel } from '@/features/reminders/reminder-text';
import { useIsOnline } from '@/hooks/use-is-online';
import { getLocale, t, tf } from '@/i18n';
import { size, spacing } from '@/theme/tokens';

type View_ = 'list' | 'month';

/**
 * Agenda de la mascota activa (tableros 8.1, 8.2 y 8.6): lista (vencidos, hoy, próximos y hechos) o
 * mes. «Hecho» con un toque y «Deshacer». Solo con conexión (no hay copia en el dispositivo); los
 * avisos ya programados siguen llegando sin red.
 */
export function PetAgenda({ pet, petCount }: { pet: Pet; petCount: number }) {
  const router = useRouter();
  const { canUseServer } = useAuth();
  const online = useIsOnline();
  const reminders = usePetReminders(pet.id);
  const permission = useCanEditPet(pet.id);
  const [view, setView] = useState<View_>('list');
  const [selectorOpen, setSelectorOpen] = useState(false);
  const canWrite = permission.data === true && canUseServer && online;
  const openNew = (params: { date?: string; type?: ReminderType } = {}) =>
    router.push({ pathname: '/reminders/new', params: { petId: pet.id, ...params } });

  const header = (
    <View style={styles.header}>
      <View style={styles.flex}>
        <Text variant="title1" accessibilityRole="header">
          {t('agenda.title')}
        </Text>
        {petCount > 1 ? (
          <Chip label={pet.name} onPress={() => setSelectorOpen(true)} accessibilityHint={t('pets.profile.swap')} />
        ) : null}
      </View>
      {canWrite ? (
        <IconButton variant="soft" icon={Plus} accessibilityLabel={t('agenda.new')} onPress={() => openNew()} />
      ) : null}
    </View>
  );

  const body = (): ReactNode => {
    if (isLocalPetId(pet.id)) {
      return <EmptyState icon={CalendarDays} title={tf('agenda.errors.localPet', { name: pet.name })} />;
    }
    if (reminders.data === undefined) {
      if (!canUseServer || !online || reminders.fetchStatus === 'idle') {
        return (
          <ErrorState
            offline
            message={t('agenda.errors.offlineTitle')}
            description={t('agenda.errors.offlineText')}
            onRetry={() => void reminders.refetch()}
          />
        );
      }
      if (reminders.isError) {
        return (
          <ErrorState
            message={tf('agenda.errors.load', { name: pet.name })}
            description={reminderErrorMessage(reminders.error)}
            onRetry={() => void reminders.refetch()}
          />
        );
      }
      return <LoadingState />;
    }
    if (reminders.data.length === 0) {
      return (
        <AgendaEmpty
          petName={pet.name}
          canWrite={canWrite}
          readOnly={permission.data === false}
          onAdd={(type) => openNew({ type })}
        />
      );
    }
    return view === 'list' ? (
      <AgendaList reminders={reminders.data} canWrite={canWrite} />
    ) : (
      <AgendaMonth reminders={reminders.data} canWrite={canWrite} onAdd={(date) => openNew({ date })} />
    );
  };

  return (
    <Screen align="top" edges={[...TAB_SCREEN_EDGES]} gap={18}>
      {header}
      {reminders.data !== undefined && reminders.data.length > 0 ? (
        <SegmentedControl
          accessibilityLabel={t('agenda.view')}
          options={[
            { value: 'list', label: t('agenda.viewList') },
            { value: 'month', label: t('agenda.viewMonth') },
          ]}
          value={view}
          onChange={setView}
        />
      ) : null}
      {reminders.data !== undefined && (!canUseServer || !online) ? (
        <Banner icon={WifiOff} message={t('agenda.errors.network')} />
      ) : null}
      <NotificationsNotice />
      <ExactAlarmsNotice />
      {permission.data === false ? <Alert tone="info" message={tf('agenda.detail.readOnly', { name: pet.name })} /> : null}
      {body()}
      <PetSelectorSheet visible={selectorOpen} onClose={() => setSelectorOpen(false)} />
    </Screen>
  );
}

/** Avisos desactivados (o sin preguntar): se dice y se ofrece activarlos (tablero 8.7, `denied`). */
function NotificationsNotice() {
  const { permission, request } = useNotificationPermission();
  if (!notificationsSupported || !permission || permission.status === 'granted') return null;
  return (
    <Alert
      tone="warning"
      message={t('agenda.notificationsBanner')}
      action={{
        label: permission.status === 'denied' && !permission.canAskAgain ? t('notifications.openSettings') : t('agenda.notificationsEnable'),
        onPress: () => {
          if (permission.status === 'denied' && !permission.canAskAgain) openSystemSettings();
          else request.mutate();
        },
      }}
    />
  );
}

/** «Hecho» y «pendiente» desde una fila, con «Deshacer» (tablero 8.1). */
function useToggleReminder() {
  const toast = useToast();
  const complete = useCompleteReminder();
  const reopen = useReopenReminder();
  const [busyId, setBusyId] = useState<string | null>(null);

  const toggle = (reminder: Reminder) => {
    if (busyId) return;
    setBusyId(reminder.id);
    const action =
      reminder.status === 'pending'
        ? complete.mutateAsync(reminder).then((result) =>
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
            })
          )
        : reopen.mutateAsync(reminder).then(() => toast({ message: t('agenda.toast.reopened') }));
    action
      .catch((cause: unknown) => toast({ message: reminderErrorMessage(cause) }))
      .finally(() => setBusyId(null));
  };

  return { toggle, busyId };
}

function Section({ title, tone, children }: { title: string; tone?: 'warning'; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text variant="overline" color={tone === 'warning' ? 'routineFg' : 'inkMuted'} accessibilityRole="header">
        {title}
      </Text>
      <Card flush>{children}</Card>
    </View>
  );
}

function ReminderRows({ items, canWrite }: { items: Reminder[]; canWrite: boolean }) {
  const router = useRouter();
  const { toggle, busyId } = useToggleReminder();
  const now = new Date();
  return items.map((reminder, index) => (
    <ReminderItem
      key={reminder.id}
      reminder={reminder}
      now={now}
      divider={index < items.length - 1}
      busy={busyId === reminder.id}
      onOpen={() => router.push({ pathname: '/reminders/[id]', params: { id: reminder.id } })}
      onToggle={canWrite ? () => toggle(reminder) : undefined}
    />
  ));
}

function AgendaList({ reminders, canWrite }: { reminders: Reminder[]; canWrite: boolean }) {
  const now = new Date();
  const groups = groupReminders(reminders, now);
  return (
    <View style={styles.sections}>
      {groups.overdue.length > 0 ? (
        <Section title={t('agenda.sections.overdue')} tone="warning">
          <ReminderRows items={groups.overdue} canWrite={canWrite} />
        </Section>
      ) : null}
      {groups.today.length > 0 ? (
        <Section title={tf('agenda.sections.today', { day: reminderDayLabelLong(now) })}>
          <ReminderRows items={groups.today} canWrite={canWrite} />
        </Section>
      ) : null}
      {groups.upcoming.length > 0 ? (
        <Section title={t('agenda.sections.upcoming')}>
          <ReminderRows items={groups.upcoming} canWrite={canWrite} />
        </Section>
      ) : null}
      {groups.done.length > 0 ? (
        <Section title={t('agenda.sections.done')}>
          <ReminderRows items={groups.done.slice(0, 10)} canWrite={canWrite} />
        </Section>
      ) : null}
    </View>
  );
}

/** «viernes 16» para la sección de hoy. */
function reminderDayLabelLong(now: Date): string {
  return formatReminderDay(now, now, getLocale());
}

function AgendaMonth({
  reminders,
  canWrite,
  onAdd,
}: {
  reminders: Reminder[];
  canWrite: boolean;
  onAdd: (date: string) => void;
}) {
  const now = new Date();
  const today = localDateKey(now);
  const [month, setMonth] = useState<MonthCursor>({ year: now.getFullYear(), index: now.getMonth() });
  const [selected, setSelected] = useState(today);
  const start = new Date(month.year, month.index, 1);
  const end = new Date(month.year, month.index + 1, 1);
  const byDay = new Map<string, Reminder[]>();
  for (const reminder of reminders) {
    for (const day of reminderDaysInRange(reminder, start, end)) {
      byDay.set(day, [...(byDay.get(day) ?? []), reminder]);
    }
  }
  const dayItems = (byDay.get(selected) ?? []).sort(
    (a, b) => effectiveDueAt(a).getTime() - effectiveDueAt(b).getTime()
  );

  return (
    <View style={styles.sections}>
      <Card>
        <ReminderMonth
          month={month}
          onChangeMonth={(next) => {
            setMonth(next);
            setSelected(next.year === now.getFullYear() && next.index === now.getMonth() ? today : localDateKey(new Date(next.year, next.index, 1)));
          }}
          today={today}
          markedDates={new Set(byDay.keys())}
          selectedDate={selected}
          onSelectDate={setSelected}
        />
      </Card>
      <View style={styles.section}>
        <Text variant="overline" color="inkMuted" accessibilityRole="header">
          {formatLogDateLabel(selected, getLocale())}
        </Text>
        {dayItems.length > 0 ? (
          <Card flush>
            <ReminderRows items={dayItems} canWrite={canWrite} />
          </Card>
        ) : (
          <Text color="inkMuted">{t('agenda.month.nothing')}</Text>
        )}
        {canWrite && selected >= today ? (
          <Button variant="ghost" size="md" icon={Plus} label={t('agenda.month.add')} onPress={() => onAdd(selected)} />
        ) : null}
      </View>
    </View>
  );
}

function AgendaEmpty({
  petName,
  canWrite,
  readOnly,
  onAdd,
}: {
  petName: string;
  canWrite: boolean;
  /** Sin permiso de edición (co-tutor lector); sin conexión se sigue invitando a apuntar. */
  readOnly: boolean;
  onAdd: (type: ReminderType) => void;
}) {
  return (
    <View style={styles.empty}>
      <EmptyState
        icon={CalendarDays}
        title={tf('agenda.empty.title', { name: petName })}
        description={readOnly ? tf('agenda.empty.readOnly', { name: petName }) : t('agenda.empty.text')}
      />
      {canWrite ? (
        <View style={styles.chips}>
          {REMINDER_TYPES.map((type) => (
            <Chip key={type} icon={REMINDER_TYPE_ICONS[type]} label={t(`agenda.types.${type}`)} onPress={() => onAdd(type)} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: size.touchMin,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing['3'],
  },
  flex: {
    flex: 1,
    gap: spacing['2'],
    alignItems: 'flex-start',
  },
  sections: {
    gap: 18,
  },
  section: {
    gap: 10,
  },
  empty: {
    gap: spacing['4'],
    paddingTop: spacing['6'],
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing['2'],
  },
});
