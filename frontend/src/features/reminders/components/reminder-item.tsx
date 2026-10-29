import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Check } from '@/components/ui/icons';
import { PressedOverlay } from '@/components/ui/pressed-overlay';
import { Text } from '@/components/ui/text';
import { isReminderActive, type Reminder } from '@/features/reminders/reminder-model';
import { REMINDER_TYPE_ICONS, reminderSubtitle } from '@/features/reminders/reminder-text';
import { useTheme } from '@/hooks/use-theme';
import { tf, t } from '@/i18n';
import { borderWidth, radius, size, spacing } from '@/theme/tokens';

type ReminderItemProps = {
  reminder: Reminder;
  now: Date;
  /** En el listado de todas las mascotas, de quién es. */
  petName?: string;
  /** Abre el detalle. */
  onOpen: () => void;
  /** Marcar hecho / pendiente; sin permiso de edición (o desactivado) no se muestra el círculo. */
  onToggle?: () => void;
  /** Escritura en curso de esta fila. */
  busy?: boolean;
  divider?: boolean;
};

/**
 * Fila de la agenda (`check_item` del tablero 8.1): icono del tipo, título (tachado si está hecho),
 * tipo y cuándo, y el círculo de «hecho» a la derecha (44 de área táctil). El estado se dice con
 * icono y texto, no solo con color.
 */
export function ReminderItem({ reminder, now, petName, onOpen, onToggle, busy = false, divider = false }: ReminderItemProps) {
  const theme = useTheme();
  const done = reminder.status !== 'pending';
  // Desactivado: atenuado y sin «hecho» (se activa desde el detalle).
  const paused = !done && !isReminderActive(reminder);
  const muted = done || paused;
  const subtitle = petName ? `${petName} · ${reminderSubtitle(reminder, now)}` : reminderSubtitle(reminder, now);

  return (
    <View
      style={[
        styles.row,
        divider && { borderBottomWidth: borderWidth.hairline, borderBottomColor: theme.line },
      ]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${tf(done ? 'agenda.doneA11y' : paused ? 'agenda.pausedA11y' : 'agenda.pendingA11y', { title: reminder.title })}. ${subtitle}`}
        onPress={onOpen}
        style={styles.main}>
        {({ pressed }) => (
          <>
            {pressed ? <PressedOverlay /> : null}
            <View style={[styles.iconTile, { backgroundColor: muted ? theme.surfaceSunken : theme.surfaceBrand }]}>
              <Icon icon={REMINDER_TYPE_ICONS[reminder.type]} size="sm" color={muted ? 'inkMuted' : 'primary'} />
            </View>
            <View style={styles.text}>
              <Text
                variant="bodyStrong"
                color={muted ? 'inkMuted' : 'ink'}
                style={done ? styles.strike : undefined}>
                {reminder.title}
              </Text>
              <Text variant="caption" color="inkMuted">
                {subtitle}
              </Text>
            </View>
          </>
        )}
      </Pressable>
      {onToggle && !paused ? (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityLabel={done ? t('agenda.markPending') : t('agenda.markDone')}
          accessibilityState={{ checked: done, busy, disabled: busy }}
          disabled={busy}
          onPress={onToggle}
          style={styles.toggle}>
          {busy ? (
            <ActivityIndicator color={theme.primary} />
          ) : (
            <View
              style={[
                styles.circle,
                done
                  ? { backgroundColor: theme.primary, borderColor: theme.primary }
                  : { borderColor: theme.lineControl },
              ]}>
              {done ? <Icon icon={Check} size={14} color="onPrimary" /> : null}
            </View>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: spacing['2'],
  },
  main: {
    flex: 1,
    minHeight: size.listRow,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing['3'],
    paddingVertical: 10,
    paddingLeft: spacing['4'],
    paddingRight: spacing['2'],
  },
  iconTile: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
  },
  strike: {
    textDecorationLine: 'line-through',
  },
  toggle: {
    width: size.touchMin,
    height: size.touchMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circle: {
    width: 26,
    height: 26,
    borderRadius: radius.full,
    borderWidth: borderWidth.focus,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
