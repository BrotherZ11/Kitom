import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { ChevronRight, Plus } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/features/auth/auth-context';
import { isLocalPetId } from '@/features/pets/offline/pet-operation';
import { usePetReminders } from '@/features/reminders/hooks/use-reminders';
import { effectiveDueAt, nextPendingReminder, startOfDay } from '@/features/reminders/reminder-model';
import { REMINDER_TYPE_ICONS, reminderSubtitle } from '@/features/reminders/reminder-text';
import { useTheme } from '@/hooks/use-theme';
import { t, tf } from '@/i18n';
import { radius, spacing } from '@/theme/tokens';

/**
 * «Próximo» en Hoy (tableros 4.2/4.3): el siguiente cuidado pendiente de la agenda (o el vencido) y,
 * sin nada apuntado, una invitación breve a apuntarlo. Sin conexión o sin datos aún, no se muestra
 * (Hoy no depende de la agenda).
 */
export function NextReminderCard({ petId, petName, canEdit }: { petId: string; petName: string; canEdit: boolean }) {
  const router = useRouter();
  const theme = useTheme();
  const { canUseServer } = useAuth();
  const reminders = usePetReminders(petId);
  if (isLocalPetId(petId) || !canUseServer || reminders.data === undefined) return null;

  const next = nextPendingReminder(reminders.data);
  if (!next) {
    if (!canEdit) return null;
    return (
      <Card variant="flat" style={styles.empty}>
        <Text variant="caption" color="inkMuted" style={styles.flex}>
          {tf('agenda.nextEmpty', { name: petName })}
        </Text>
        <Button
          variant="ghost"
          size="sm"
          icon={Plus}
          label={t('agenda.nextAdd')}
          onPress={() => router.push({ pathname: '/reminders/new', params: { petId } })}
        />
      </Card>
    );
  }

  const now = new Date();
  const overdue = effectiveDueAt(next).getTime() < startOfDay(now).getTime();
  return (
    <View style={styles.block}>
      <Text variant="overline" color={overdue ? 'routineFg' : 'inkMuted'} accessibilityRole="header">
        {overdue ? t('agenda.nextOverdue') : t('agenda.next')}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${tf('agenda.nextOpenA11y', { title: next.title })}. ${reminderSubtitle(next, now)}`}
        onPress={() => router.push({ pathname: '/reminders/[id]', params: { id: next.id } })}>
        {({ pressed }) => (
          <Card style={[styles.card, pressed && styles.pressed]}>
            <View style={[styles.tile, { backgroundColor: overdue ? theme.routineBg : theme.surfaceBrand }]}>
              <Icon icon={REMINDER_TYPE_ICONS[next.type]} size="sm" color={overdue ? 'routineFg' : 'primary'} />
            </View>
            <View style={styles.flex}>
              <Text variant="bodyStrong">{next.title}</Text>
              <Text variant="caption" color="inkMuted">
                {reminderSubtitle(next, now)}
              </Text>
            </View>
            <Icon icon={ChevronRight} size="sm" color="inkSubtle" />
          </Card>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: spacing['2'],
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing['3'],
  },
  pressed: {
    opacity: 0.85,
  },
  tile: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: {
    flex: 1,
  },
  empty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing['2'],
  },
});
