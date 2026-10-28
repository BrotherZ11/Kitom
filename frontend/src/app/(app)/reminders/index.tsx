import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Banner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
import { CalendarDays, WifiOff } from '@/components/ui/icons';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { TopBar } from '@/components/ui/top-bar';
import { useAuth } from '@/features/auth/auth-context';
import { useActivePet } from '@/features/pets/active-pet-context';
import { ReminderItem } from '@/features/reminders/components/reminder-item';
import { usePendingReminders } from '@/features/reminders/hooks/use-reminders';
import { reminderErrorMessage } from '@/features/reminders/reminder-errors';
import { formatReminderDay } from '@/features/reminders/reminder-format';
import { groupReminders, remindersOfPets, type Reminder } from '@/features/reminders/reminder-model';
import { useIsOnline } from '@/hooks/use-is-online';
import { getLocale, t, tf } from '@/i18n';

/**
 * Lo pendiente de todas las mascotas (vencido, hoy y próximo), con el nombre de cada una. Solo lectura:
 * cada fila abre el detalle, que decide si se puede cambiar (RLS y `can_edit_pet` de esa mascota). Las
 * mascotas que se están eliminando en este dispositivo no salen. Solo con conexión (sin copia local).
 */
export default function AllRemindersScreen() {
  const router = useRouter();
  const { canUseServer } = useAuth();
  const online = useIsOnline();
  const { pets } = useActivePet();
  const reminders = usePendingReminders();
  const back = () => (router.canGoBack() ? router.back() : router.replace('/agenda'));

  const body = (): ReactNode => {
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
            message={t('agenda.all.load')}
            description={reminderErrorMessage(reminders.error)}
            onRetry={() => void reminders.refetch()}
          />
        );
      }
      return <LoadingState />;
    }
    // Hasta tener la lista de mascotas no se sabe cuáles se están eliminando.
    if (!pets.data) {
      return pets.view.state === 'loading' ? (
        <LoadingState />
      ) : (
        <ErrorState message={t('agenda.all.load')} onRetry={pets.refetch} />
      );
    }
    const names = new Map(pets.data.map((pet) => [pet.id, pet.name]));
    const visible = remindersOfPets(reminders.data, new Set(names.keys()));
    if (visible.length === 0) return <EmptyState icon={CalendarDays} title={t('agenda.all.empty')} />;
    const now = new Date();
    const groups = groupReminders(visible, now);
    const rows = (items: Reminder[]) =>
      items.map((reminder, index) => (
        <ReminderItem
          key={reminder.id}
          reminder={reminder}
          now={now}
          petName={names.get(reminder.pet_id)}
          divider={index < items.length - 1}
          onOpen={() => router.push({ pathname: '/reminders/[id]', params: { id: reminder.id } })}
        />
      ));
    return (
      <View style={styles.sections}>
        {groups.overdue.length > 0 ? (
          <Section title={t('agenda.sections.overdue')} warning>
            {rows(groups.overdue)}
          </Section>
        ) : null}
        {groups.today.length > 0 ? (
          <Section title={tf('agenda.sections.today', { day: formatReminderDay(now, now, getLocale()) })}>{rows(groups.today)}</Section>
        ) : null}
        {groups.upcoming.length > 0 ? (
          <Section title={t('agenda.sections.upcoming')}>{rows(groups.upcoming)}</Section>
        ) : null}
      </View>
    );
  };

  return (
    <Screen align="top" gap={18}>
      <TopBar onBack={back} />
      <View style={styles.heading}>
        <Text variant="title1" accessibilityRole="header">
          {t('agenda.all.title')}
        </Text>
        <Text color="inkMuted">{t('agenda.all.subtitle')}</Text>
      </View>
      {reminders.data !== undefined && (!canUseServer || !online) ? (
        <Banner icon={WifiOff} message={t('agenda.errors.network')} />
      ) : null}
      {body()}
    </Screen>
  );
}

function Section({ title, warning = false, children }: { title: string; warning?: boolean; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text variant="overline" color={warning ? 'routineFg' : 'inkMuted'} accessibilityRole="header">
        {title}
      </Text>
      <Card flush>{children}</Card>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: {
    gap: 4,
  },
  sections: {
    gap: 18,
  },
  section: {
    gap: 10,
  },
});
