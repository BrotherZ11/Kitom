/**
 * Avisos locales de Kitom (programados en el dispositivo con expo-notifications; sin push remoto).
 * Módulo puro: qué avisos deberían existir y qué cambiar respecto a los ya programados. Se prueba con
 * `npm test`. Contrato: `docs/FRONTEND_ARCHITECTURE.md` §7 «Avisos locales».
 *
 * - Recordatorio diario del registro (`notification_preferences.daily_reminder_*`): un aviso por día,
 *   como mucho, durante los próximos `DAILY_LOG_DAYS_AHEAD` días; hoy no, si ya está registrado o la
 *   hora ya pasó. Son avisos de fecha concreta (no repetitivos) para poder saltarse el día hecho: se
 *   vuelven a calcular cada vez que se abre la app o cambia el registro de hoy.
 * - Agenda: un aviso a la hora de cada recordatorio pendiente (la pospuesta, si lo está) que aún no
 *   haya pasado, solo de las mascotas visibles: una mascota que se está eliminando en este dispositivo
 *   (o que ya no se ve) no avisa, aunque el servidor aún tenga sus recordatorios.
 * - Las horas son instantes: un aviso suena en el mismo momento en todos los dispositivos (las 12:00 de
 *   Madrid son las 11:00 de Londres). El texto lleva la hora local: si cambia la zona del dispositivo,
 *   cambia la huella y se vuelve a programar en el siguiente arranque.
 */

export const DAILY_LOG_DAYS_AHEAD = 14;
/** Los sistemas limitan los avisos programados (iOS: 64 por app). Se dejan los más próximos. */
export const MAX_SCHEDULED = 60;

export const DAILY_LOG_PREFIX = 'daily-log:';
export const REMINDER_PREFIX = 'reminder:';

export type TimeOfDay = { hour: number; minute: number };

const TIME = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

/** `HH:MM[:SS]` (columna `time` de Postgres) → hora y minuto; `null` si no es válida. */
export function parseTimeOfDay(value: string | null | undefined): TimeOfDay | null {
  const match = TIME.exec(value ?? '');
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

const pad = (value: number) => String(value).padStart(2, '0');

/** Hora para guardar en la columna `time` (`HH:MM:00`). */
export function toTimeColumn({ hour, minute }: TimeOfDay): string {
  return `${pad(hour)}:${pad(minute)}:00`;
}

/** Hora visible (`20:00`). */
export function formatTimeOfDay({ hour, minute }: TimeOfDay): string {
  return `${pad(hour)}:${pad(minute)}`;
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Días (hora local) en los que toca el recordatorio diario. */
export function dailyLogDates(
  now: Date,
  time: TimeOfDay,
  { loggedToday, days = DAILY_LOG_DAYS_AHEAD }: { loggedToday: boolean; days?: number }
): Date[] {
  const dates: Date[] = [];
  for (let offset = 0; offset < days; offset += 1) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, time.hour, time.minute, 0, 0);
    if (offset === 0 && (loggedToday || date.getTime() <= now.getTime())) continue;
    dates.push(date);
  }
  return dates;
}

export type PlannedNotification = {
  /** Identificador estable en el dispositivo (`daily-log:YYYY-MM-DD` o `reminder:<id>`). */
  id: string;
  date: Date;
  title: string;
  body: string;
  /** Ruta de la app que se abre al tocarlo. */
  url: string;
};

export type ReminderForPlan = {
  id: string;
  petId: string;
  title: string;
  /** `snooze_until` si lo pospuso, si no `due_at` (`effectiveDueAt`). */
  at: Date;
  petName: string | null;
};

export type PlanInput = {
  now: Date;
  daily: { time: TimeOfDay; loggedToday: boolean; title: string; body: string; url: string } | null;
  reminders: readonly ReminderForPlan[];
  reminderBody: (reminder: ReminderForPlan) => string;
  /** Mascotas que se ven en la app; los recordatorios de las demás no se programan. */
  visiblePetIds: ReadonlySet<string>;
};

/** Todos los avisos que deberían estar programados ahora, los más próximos primero (con tope). */
export function planNotifications({ now, daily, reminders, reminderBody, visiblePetIds }: PlanInput): PlannedNotification[] {
  const planned: PlannedNotification[] = [];
  if (daily) {
    for (const date of dailyLogDates(now, daily.time, { loggedToday: daily.loggedToday })) {
      planned.push({ id: `${DAILY_LOG_PREFIX}${dateKey(date)}`, date, title: daily.title, body: daily.body, url: daily.url });
    }
  }
  for (const reminder of reminders) {
    if (reminder.at.getTime() <= now.getTime() || !visiblePetIds.has(reminder.petId)) continue;
    planned.push({
      id: `${REMINDER_PREFIX}${reminder.id}`,
      date: reminder.at,
      title: reminder.petName ? `${reminder.petName} · ${reminder.title}` : reminder.title,
      body: reminderBody(reminder),
      url: `/reminders/${reminder.id}`,
    });
  }
  planned.sort((a, b) => a.date.getTime() - b.date.getTime());
  return planned.slice(0, MAX_SCHEDULED);
}

/**
 * Huella de un aviso: si cambia (fecha, texto o modo de programación), hay que volver a programarlo.
 * `mode` distingue, p. ej., avisos exactos de inexactos en Android: al conceder el permiso de alarmas
 * exactas, los ya programados se vuelven a programar para que pasen a ser exactos.
 */
export function fingerprint(
  notification: Pick<PlannedNotification, 'date' | 'title' | 'body' | 'url'>,
  mode = ''
): string {
  return [notification.date.toISOString(), notification.title, notification.body, notification.url, mode].join('|');
}

export type ScheduledSummary = { id: string; fingerprint: string | null };

/**
 * Qué cancelar y qué programar para pasar de lo programado a lo deseado. Solo se tocan los avisos
 * de Kitom (prefijos propios); un aviso igual que ya está programado se deja tal cual.
 */
export function diffSchedule(
  scheduled: readonly ScheduledSummary[],
  desired: readonly PlannedNotification[],
  mode = ''
): { cancel: string[]; schedule: PlannedNotification[] } {
  const ours = scheduled.filter((item) => item.id.startsWith(DAILY_LOG_PREFIX) || item.id.startsWith(REMINDER_PREFIX));
  const wanted = new Map(desired.map((item) => [item.id, item]));
  const current = new Map(ours.map((item) => [item.id, item.fingerprint]));
  const cancel = ours
    .filter((item) => {
      const target = wanted.get(item.id);
      return !target || fingerprint(target, mode) !== item.fingerprint;
    })
    .map((item) => item.id);
  const schedule = desired.filter((item) => current.get(item.id) !== fingerprint(item, mode));
  return { cancel, schedule };
}

/**
 * Qué se puede decir del aviso de un recordatorio en este dispositivo (detalle 8.4). Nunca se afirma que
 * sonará si la plataforma no puede, falta el permiso, la hora ya pasó, está desactivado o la mascota se
 * está eliminando aquí (no se programa).
 */
export type ReminderNotifyState = 'on' | 'off' | 'web' | 'unavailable' | 'past' | 'paused' | 'pet_deleting' | 'none';

export function reminderNotifyState({
  unavailable,
  permission,
  pending,
  active,
  at,
  now,
  petDeleting,
}: {
  /** `notificationsUnavailableReason`: en web nunca hay avisos; en móvil, si falta el módulo nativo. */
  unavailable: 'web' | 'unavailable' | null;
  permission: 'granted' | 'denied' | 'undetermined' | 'unavailable' | null;
  /** Solo los pendientes avisan. */
  pending: boolean;
  /** Los desactivados (`is_active = false`) no avisan. */
  active: boolean;
  /** Hora efectiva (`effectiveDueAt`). */
  at: Date;
  now: Date;
  petDeleting: boolean;
}): ReminderNotifyState {
  if (!pending) return 'none';
  if (unavailable) return unavailable;
  if (!active) return 'paused';
  if (petDeleting) return 'pet_deleting';
  if (at.getTime() <= now.getTime()) return 'past';
  return permission === 'granted' ? 'on' : 'off';
}
