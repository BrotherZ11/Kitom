import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { ReminderItem } from '@/features/reminders/components/reminder-item';
import { usePetReminders } from '@/features/reminders/hooks/use-reminders';
import { groupReminders } from '@/features/reminders/reminder-model';
import { t, tf } from '@/i18n';
import { spacing } from '@/theme/tokens';

/** Cuántos pendientes se enseñan en la ficha (el resto, en la agenda). */
const SHOWN = 3;

/**
 * La agenda en la ficha de una mascota del servidor: cuántos hay vencidos y los próximos pendientes
 * (vencidos primero). Solo lectura: cada fila abre el detalle. Sin conexión, de la copia; sin copia, lo
 * dice en una línea (la ficha no depende de la agenda).
 */
export function PetRemindersSummary({ petId, petName, onOpenAgenda }: { petId: string; petName: string; onOpenAgenda: () => void }) {
  const router = useRouter();
  const reminders = usePetReminders(petId);

  const content = () => {
    if (reminders.data === undefined) {
      if (reminders.view.state === 'offline_unavailable') {
        return <Text variant="caption" color="inkMuted">{t('agenda.summary.offline')}</Text>;
      }
      if (reminders.view.state === 'loading') return null;
      return <Text variant="caption" color="inkMuted">{t('agenda.summary.error')}</Text>;
    }
    const now = new Date();
    const groups = groupReminders(reminders.data, now);
    const pending = [...groups.overdue, ...groups.today.filter((item) => item.status === 'pending'), ...groups.upcoming];
    if (pending.length === 0) {
      return <Text variant="caption" color="inkMuted">{tf('agenda.summary.empty', { name: petName })}</Text>;
    }
    const shown = pending.slice(0, SHOWN);
    return (
      <>
        {groups.overdue.length > 0 ? (
          <Text variant="caption" color="routineFg">
            {tf('agenda.summary.overdue', { count: groups.overdue.length })}
          </Text>
        ) : null}
        <Card flush>
          {shown.map((reminder, index) => (
            <ReminderItem
              key={reminder.id}
              reminder={reminder}
              now={now}
              divider={index < shown.length - 1}
              sync={reminders.displayOf(reminder.id)}
              onOpen={() => router.push({ pathname: '/reminders/[id]', params: { id: reminder.id } })}
            />
          ))}
        </Card>
        {pending.length > SHOWN ? (
          <Text variant="caption" color="inkMuted">
            {tf('agenda.summary.more', { count: pending.length - SHOWN })}
          </Text>
        ) : null}
      </>
    );
  };

  return (
    <View style={styles.block}>
      <Text variant="overline" color="inkMuted" accessibilityRole="header">
        {tf('agenda.titleFor', { name: petName })}
      </Text>
      {content()}
      <Button variant="ghost" size="sm" label={t('agenda.summary.open')} onPress={onOpenAgenda} />
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: spacing['2'],
    alignItems: 'stretch',
  },
});
