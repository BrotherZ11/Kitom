import type { Enums, Tables } from '@/types/database.types';

/**
 * Recordatorios de la agenda (`reminders`, tableros 8.1–8.6). Módulo puro: se prueba con `npm test`
 * (solo `import type`). Las fechas se manejan en la hora local del dispositivo, que es la que usan los
 * avisos; en la BD se guardan como instantes (`timestamptz`). Contrato:
 * `docs/FRONTEND_ARCHITECTURE.md` §4 «RemindersScreen».
 */

export type Reminder = Pick<
  Tables<'reminders'>,
  | 'id'
  | 'pet_id'
  | 'type'
  | 'title'
  | 'description'
  | 'due_at'
  | 'snooze_until'
  | 'recurrence_rule'
  | 'status'
  | 'is_active'
  | 'completed_at'
  | 'attachment_path'
  | 'created_by'
  | 'created_at'
  | 'updated_at'
>;

export const REMINDER_COLUMNS =
  'id, pet_id, type, title, description, due_at, snooze_until, recurrence_rule, status, is_active, completed_at, attachment_path, created_by, created_at, updated_at';

/**
 * ¿Está activo? (`is_active`, migración `20261028200659`). Un desactivado sigue `pending` en el
 * servidor, pero no avisa, no cuenta como vencido ni como «Próximo» y no sale en el calendario. Sin la
 * columna (datos de una versión anterior en caché), activo.
 */
export function isReminderActive(reminder: Pick<Reminder, 'is_active'>): boolean {
  return reminder.is_active !== false;
}

export type ReminderType = Enums<'reminder_type'>;

/** Orden del selector (tablero 8.3). */
export const REMINDER_TYPES: readonly ReminderType[] = ['vaccine', 'medication', 'appointment', 'bath', 'deworming', 'other'];

export type Recurrence = 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export const RECURRENCES: readonly Recurrence[] = ['NONE', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];

/**
 * Repetición guardada (`recurrence_rule`, RRULE con CHECK `^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)`). La
 * app solo escribe `FREQ=…`; de una regla con más partes (otro cliente) se usa la frecuencia.
 */
export function parseRecurrence(rule: string | null): Recurrence {
  const match = /^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)\b/.exec(rule ?? '');
  return match ? (match[1] as Recurrence) : 'NONE';
}

export function toRecurrenceRule(recurrence: Recurrence): string | null {
  return recurrence === 'NONE' ? null : `FREQ=${recurrence}`;
}

/** Último día de un mes (0–11). */
function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/**
 * Siguiente vez de un recordatorio que se repite, a la misma hora local. Un mensual del día 31 pasa al
 * último día de los meses más cortos (no salta al mes siguiente); un anual del 29 de febrero, al 28.
 * Con `NONE`, `null`.
 */
export function nextOccurrence(from: Date, recurrence: Recurrence): Date | null {
  const year = from.getFullYear();
  const month = from.getMonth();
  const day = from.getDate();
  const keepTime = (date: Date) => {
    date.setHours(from.getHours(), from.getMinutes(), from.getSeconds(), 0);
    return date;
  };
  switch (recurrence) {
    case 'NONE':
      return null;
    case 'DAILY':
      return keepTime(new Date(year, month, day + 1));
    case 'WEEKLY':
      return keepTime(new Date(year, month, day + 7));
    case 'MONTHLY': {
      const target = month + 1;
      const targetYear = year + Math.floor(target / 12);
      const targetMonth = target % 12;
      return keepTime(new Date(targetYear, targetMonth, Math.min(day, daysInMonth(targetYear, targetMonth))));
    }
    case 'YEARLY':
      return keepTime(new Date(year + 1, month, Math.min(day, daysInMonth(year + 1, month))));
  }
}

/**
 * Cuándo toca de verdad: si está pospuesto, la hora de `snooze_until` (solo si es posterior a la
 * fecha prevista); si no, `due_at`.
 */
export function effectiveDueAt(reminder: Pick<Reminder, 'due_at' | 'snooze_until'>): Date {
  const due = new Date(reminder.due_at);
  if (reminder.snooze_until) {
    const snooze = new Date(reminder.snooze_until);
    if (snooze.getTime() > due.getTime()) return snooze;
  }
  return due;
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** Día local `YYYY-MM-DD` de un instante (para agrupar y para el calendario). */
export function localDateKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export type ReminderGroups = {
  /** Pendientes cuya fecha ya pasó antes de hoy (tablero 8.1, «Pendiente»), los más antiguos arriba. */
  overdue: Reminder[];
  /** Los de hoy: pendientes y los hechos hoy (tachados). */
  today: Reminder[];
  /** Pendientes de mañana en adelante. */
  upcoming: Reminder[];
  /** Hechos antes de hoy (los más recientes primero). */
  done: Reminder[];
  /** Pendientes desactivados, por fecha prevista (no son vencidos ni próximos). */
  paused: Reminder[];
};

/** Agrupa la lista de la agenda. Los `skipped` (no los escribe la app) se tratan como hechos. */
export function groupReminders(reminders: readonly Reminder[], now: Date): ReminderGroups {
  const todayStart = startOfDay(now).getTime();
  const tomorrowStart = addDays(startOfDay(now), 1).getTime();
  const groups: ReminderGroups = { overdue: [], today: [], upcoming: [], done: [], paused: [] };
  for (const reminder of reminders) {
    if (reminder.status === 'pending' && !isReminderActive(reminder)) {
      groups.paused.push(reminder);
    } else if (reminder.status === 'pending') {
      const at = effectiveDueAt(reminder).getTime();
      if (at < todayStart) groups.overdue.push(reminder);
      else if (at < tomorrowStart) groups.today.push(reminder);
      else groups.upcoming.push(reminder);
    } else {
      const doneAt = new Date(reminder.completed_at ?? reminder.updated_at).getTime();
      if (doneAt >= todayStart && doneAt < tomorrowStart) groups.today.push(reminder);
      else groups.done.push(reminder);
    }
  }
  const byDue = (a: Reminder, b: Reminder) => effectiveDueAt(a).getTime() - effectiveDueAt(b).getTime();
  groups.overdue.sort(byDue);
  groups.upcoming.sort(byDue);
  groups.paused.sort(byDue);
  // Hoy: primero lo pendiente (por hora), después lo hecho.
  groups.today.sort((a, b) => {
    if (a.status === 'pending' && b.status !== 'pending') return -1;
    if (a.status !== 'pending' && b.status === 'pending') return 1;
    return byDue(a, b);
  });
  groups.done.sort(
    (a, b) => new Date(b.completed_at ?? b.updated_at).getTime() - new Date(a.completed_at ?? a.updated_at).getTime()
  );
  return groups;
}

/**
 * Solo los recordatorios de las mascotas que se ven en la app (listado general): una mascota con una
 * eliminación guardada en el dispositivo ya no está en la lista y su agenda tampoco se enseña.
 */
export function remindersOfPets(reminders: readonly Reminder[], petIds: ReadonlySet<string>): Reminder[] {
  return reminders.filter((reminder) => petIds.has(reminder.pet_id));
}

/**
 * Próximo pendiente a partir de ahora (para «Próximo» en Hoy). Los vencidos cuentan primero: siguen
 * pendientes de hacer. Los desactivados no cuentan.
 */
export function nextPendingReminder(reminders: readonly Reminder[]): Reminder | null {
  let best: Reminder | null = null;
  for (const reminder of reminders) {
    if (reminder.status !== 'pending' || !isReminderActive(reminder)) continue;
    if (!best || effectiveDueAt(reminder).getTime() < effectiveDueAt(best).getTime()) best = reminder;
  }
  return best;
}

/** Límite de vueltas al proyectar repeticiones (un diario en un mes son ~31). */
const MAX_OCCURRENCES = 400;

/**
 * Días (`YYYY-MM-DD`) en los que cae un recordatorio entre `start` (incluido) y `end` (excluido): su
 * fecha y, si se repite y sigue pendiente, las siguientes repeticiones (para el calendario del mes,
 * tablero 8.2). Los hechos solo cuentan el día en que se hicieron; los desactivados, ninguno.
 */
export function reminderDaysInRange(reminder: Reminder, start: Date, end: Date): string[] {
  if (reminder.status === 'pending' && !isReminderActive(reminder)) return [];
  if (reminder.status !== 'pending') {
    const doneAt = new Date(reminder.completed_at ?? reminder.updated_at);
    return doneAt >= start && doneAt < end ? [localDateKey(doneAt)] : [];
  }
  const recurrence = parseRecurrence(reminder.recurrence_rule);
  const days: string[] = [];
  let at: Date | null = effectiveDueAt(reminder);
  // La primera repetición sale de la fecha prevista (posponer no mueve la serie).
  let base = new Date(reminder.due_at);
  for (let guard = 0; at && at < end && guard < MAX_OCCURRENCES; guard += 1) {
    if (at >= start) days.push(localDateKey(at));
    base = nextOccurrence(base, recurrence) ?? base;
    at = recurrence === 'NONE' ? null : base;
  }
  return [...new Set(days)];
}

export type SnoozeOption = 'hour' | 'tomorrow' | 'week';

export const SNOOZE_OPTIONS: readonly SnoozeOption[] = ['hour', 'tomorrow', 'week'];

/** Hasta cuándo se pospone: una hora desde ahora; mañana o en una semana, a la hora prevista. */
export function snoozeUntil(option: SnoozeOption, reminder: Pick<Reminder, 'due_at'>, now: Date): Date {
  if (option === 'hour') return new Date(now.getTime() + 60 * 60_000);
  const due = new Date(reminder.due_at);
  const days = option === 'tomorrow' ? 1 : 7;
  const target = addDays(startOfDay(now), days);
  target.setHours(due.getHours(), due.getMinutes(), 0, 0);
  return target;
}

export type CompletionPlan =
  /** Sin repetición: pasa a `completed` (el trigger `sync_reminder_completion` pone `completed_at`). */
  | { kind: 'complete'; patch: { status: 'completed' }; undo: { status: 'pending' } }
  /** Con repetición: sigue pendiente y avanza a la siguiente vez (se quita el aplazamiento). */
  | {
      kind: 'advance';
      next: Date;
      patch: { due_at: string; snooze_until: null };
      undo: { due_at: string; snooze_until: string | null };
    };

/**
 * Qué escribe «Hecho». Un recordatorio que se repite es una sola fila: marcarlo lo mueve a su próxima
 * vez (saltando las que ya pasaron, para no dejarlo vencido otra vez). Deshacer restaura lo anterior.
 */
export function planCompletion(
  reminder: Pick<Reminder, 'due_at' | 'snooze_until' | 'recurrence_rule'>,
  now: Date
): CompletionPlan {
  const recurrence = parseRecurrence(reminder.recurrence_rule);
  if (recurrence === 'NONE') return { kind: 'complete', patch: { status: 'completed' }, undo: { status: 'pending' } };
  let next = nextOccurrence(new Date(reminder.due_at), recurrence) as Date;
  for (let guard = 0; next.getTime() <= now.getTime() && guard < MAX_OCCURRENCES; guard += 1) {
    next = nextOccurrence(next, recurrence) as Date;
  }
  return {
    kind: 'advance',
    next,
    patch: { due_at: next.toISOString(), snooze_until: null },
    undo: { due_at: reminder.due_at, snooze_until: reminder.snooze_until },
  };
}

export const REMINDER_TITLE_MAX = 80;
export const REMINDER_NOTES_MAX = 500;

export type ReminderFormValues = {
  type: ReminderType;
  title: string;
  /** Día local `YYYY-MM-DD`. */
  date: string;
  hour: number;
  minute: number;
  recurrence: Recurrence;
  notes: string;
};

export type ReminderFormErrors = Partial<Record<'title' | 'date' | 'notes', 'required' | 'too_long' | 'past'>>;

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Instante local de un día `YYYY-MM-DD` a una hora; `null` si la fecha no es válida. */
export function localDateTime(date: string, hour: number, minute: number): Date | null {
  const match = DATE_KEY.exec(date);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  const result = new Date(year, month, day, hour, minute, 0, 0);
  if (result.getFullYear() !== year || result.getMonth() !== month || result.getDate() !== day) return null;
  return result;
}

/**
 * Valida el formulario (tablero 8.3). Un recordatorio nuevo no puede quedar en el pasado (no avisaría);
 * al editar uno existente sí se permite (p. ej. apuntar lo que ya pasó o corregir el título).
 */
export function validateReminderForm(
  values: ReminderFormValues,
  { now, isNew }: { now: Date; isNew: boolean }
): ReminderFormErrors {
  const errors: ReminderFormErrors = {};
  const title = values.title.trim();
  if (!title) errors.title = 'required';
  else if (title.length > REMINDER_TITLE_MAX) errors.title = 'too_long';
  if (values.notes.trim().length > REMINDER_NOTES_MAX) errors.notes = 'too_long';
  const at = localDateTime(values.date, values.hour, values.minute);
  if (!at) errors.date = 'required';
  else if (isNew && at.getTime() < now.getTime() - 60_000) errors.date = 'past';
  return errors;
}

export type ReminderWrite = Pick<Reminder, 'type' | 'title' | 'description' | 'due_at' | 'recurrence_rule'>;

/** Columnas que escribe el formulario (las demás nunca se envían desde aquí). */
export function toReminderWrite(values: ReminderFormValues): ReminderWrite {
  const at = localDateTime(values.date, values.hour, values.minute);
  if (!at) throw new Error('invalid_reminder_date');
  const notes = values.notes.trim();
  return {
    type: values.type,
    title: values.title.trim(),
    description: notes ? notes : null,
    due_at: at.toISOString(),
    recurrence_rule: toRecurrenceRule(values.recurrence),
  };
}

/** Valores iniciales: de un recordatorio existente o, si es nuevo, mañana a las 10:00. */
export function toReminderFormValues(
  reminder: Reminder | null,
  { now, type }: { now: Date; type?: ReminderType }
): ReminderFormValues {
  if (reminder) {
    const due = new Date(reminder.due_at);
    return {
      type: reminder.type,
      title: reminder.title,
      date: localDateKey(due),
      hour: due.getHours(),
      minute: due.getMinutes(),
      recurrence: parseRecurrence(reminder.recurrence_rule),
      notes: reminder.description ?? '',
    };
  }
  return {
    type: type ?? 'vaccine',
    title: '',
    date: localDateKey(addDays(startOfDay(now), 1)),
    hour: 10,
    minute: 0,
    recurrence: 'NONE',
    notes: '',
  };
}

/** ¿El formulario tiene cambios respecto a los valores iniciales? (para «salir sin guardar»). */
export function isReminderFormDirty(initial: ReminderFormValues, current: ReminderFormValues): boolean {
  return (Object.keys(initial) as (keyof ReminderFormValues)[]).some((key) => initial[key] !== current[key]);
}
