import {
  Droplets,
  Heart,
  Pill,
  ShieldPlus,
  Stethoscope,
  Syringe,
  type LucideIcon,
} from '@/components/ui/icons';
import { formatReminderDay, formatReminderTime, relativeDay } from '@/features/reminders/reminder-format';
import {
  effectiveDueAt,
  isReminderActive,
  parseRecurrence,
  startOfDay,
  type Reminder,
  type ReminderType,
} from '@/features/reminders/reminder-model';
import { getLocale, t, tf } from '@/i18n';

/** Icono de cada tipo (tablero 8.3). */
export const REMINDER_TYPE_ICONS: Record<ReminderType, LucideIcon> = {
  vaccine: Syringe,
  medication: Pill,
  appointment: Stethoscope,
  bath: Droplets,
  deworming: ShieldPlus,
  other: Heart,
};

/** «hoy», «mañana», «ayer» o «sábado 18» / «lunes 2 nov». */
export function reminderDayLabel(date: Date, now: Date): string {
  const relative = relativeDay(date, now);
  return relative ? t(`agenda.relative.${relative}`) : formatReminderDay(date, now, getLocale());
}

/** Día y hora de la próxima vez: «mañana · 10:00». */
export function reminderWhenLabel(date: Date, now: Date): string {
  return tf('agenda.when', { day: reminderDayLabel(date, now), time: formatReminderTime(date) });
}

/**
 * Subtítulo de una fila de la agenda (tablero 8.1): tipo y cuándo, o «era ayer, 15:00» si venció. Un
 * desactivado lo dice delante y nunca aparece como vencido.
 */
export function reminderSubtitle(reminder: Reminder, now: Date): string {
  const type = t(`agenda.types.${reminder.type}`);
  const at = effectiveDueAt(reminder);
  const paused = reminder.status === 'pending' && !isReminderActive(reminder);
  const overdue = reminder.status === 'pending' && !paused && at.getTime() < startOfDay(now).getTime();
  const when = overdue
    ? tf('agenda.overdueWhen', { day: reminderDayLabel(at, now), time: formatReminderTime(at) })
    : reminderWhenLabel(at, now);
  const recurrence = parseRecurrence(reminder.recurrence_rule);
  const parts = [tf(paused ? 'agenda.pausedSubtitle' : 'agenda.itemSubtitle', { type, when })];
  if (recurrence !== 'NONE') parts.push(t(`agenda.recurrence.${recurrence}`).toLowerCase());
  return parts.join(' · ');
}
