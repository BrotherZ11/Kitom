import { useRouter, type Href } from 'expo-router';
import { useEffect } from 'react';

import { useAuth } from '@/features/auth/auth-context';
import { useWeekOverview } from '@/features/daily-logs/hooks/use-week-overview';
import {
  cancelAllAppNotifications,
  onNotificationOpened,
  syncScheduledNotifications,
  takeInitialNotificationUrl,
} from '@/features/notifications/device-notifications';
import { useNotificationPermission } from '@/features/notifications/hooks/use-notification-permission';
import { parseTimeOfDay, planNotifications, type ReminderForPlan } from '@/features/notifications/notification-plan';
import { useActivePet } from '@/features/pets/active-pet-context';
import { isLocalPetId } from '@/features/pets/offline/pet-operation';
import type { Pet } from '@/features/pets/types';
import { useNotificationPreferences } from '@/features/profile/hooks/use-profile';
import { usePendingReminders } from '@/features/reminders/hooks/use-reminders';
import { effectiveDueAt, type Reminder } from '@/features/reminders/reminder-model';
import { formatReminderTime } from '@/features/reminders/reminder-format';
import { t, tf } from '@/i18n';

/** Hora por defecto del recordatorio diario (default de la columna). */
const DEFAULT_DAILY_TIME = { hour: 20, minute: 0 };

/**
 * Mantiene los avisos programados del dispositivo al día con los datos del servidor
 * (`notification-plan.ts`) y abre la pantalla de un aviso al tocarlo. Montado una vez en `(app)`.
 * Sin permiso, sin conexión o sin datos todavía no cambia nada (lo programado sigue funcionando).
 * Al cerrar sesión (se desmonta la zona autenticada) quita todos los avisos de Kitom.
 */
export function NotificationSync() {
  const router = useRouter();
  const { activePet } = useActivePet();

  useEffect(() => {
    const open = (url: string) => router.push(url as Href);
    const initial = takeInitialNotificationUrl();
    if (initial) open(initial);
    return onNotificationOpened(open);
  }, [router]);

  useEffect(() => () => void cancelAllAppNotifications().catch(() => undefined), []);

  return activePet && !isLocalPetId(activePet.id) ? (
    <PetNotificationPlanner key={activePet.id} pet={activePet} />
  ) : (
    <NotificationPlanner pet={null} loggedToday={false} />
  );
}

function PetNotificationPlanner({ pet }: { pet: Pet }) {
  const week = useWeekOverview(pet.id);
  // Mientras no se sabe si hoy está registrado, se espera (no se programa un aviso de más).
  if (week.state !== 'ready') return null;
  return <NotificationPlanner pet={pet} loggedToday={week.overview.today !== null} />;
}

function NotificationPlanner({ pet, loggedToday }: { pet: Pet | null; loggedToday: boolean }) {
  const { canUseServer } = useAuth();
  const { pets } = useActivePet();
  const { permission } = useNotificationPermission();
  const granted = permission?.status === 'granted';
  const preferences = useNotificationPreferences();
  const reminders = usePendingReminders(granted);
  // Valores primitivos: la lista de mascotas es un array nuevo en cada render.
  const petNames = pets.data ? JSON.stringify(pets.data.map((item) => [item.id, item.name])) : null;
  const petId = pet?.id ?? null;
  const petName = pet?.name ?? null;

  useEffect(() => {
    // Solo con datos de servidor: sin ellos no se sabría qué quitar.
    if (!granted || !canUseServer || preferences.data === undefined || reminders.data === undefined || !petNames) return;
    const prefs = preferences.data;
    const dailyEnabled = prefs?.daily_reminder_enabled ?? true;
    const time = parseTimeOfDay(prefs?.daily_reminder_time) ?? DEFAULT_DAILY_TIME;
    const names = new Map(JSON.parse(petNames) as [string, string][]);
    const byId = new Map<string, Reminder>(reminders.data.map((item) => [item.id, item]));
    const dailyName = names.size === 1 ? [...names.values()][0] : petName;
    const plan = planNotifications({
      now: new Date(),
      daily: dailyEnabled
        ? {
            time,
            loggedToday,
            title: dailyName ? tf('notifications.daily.title', { name: dailyName }) : t('notifications.daily.titleGeneric'),
            body: t('notifications.daily.body'),
            url: petId ? `/pets/${petId}/daily-log` : '/',
          }
        : null,
      reminders: reminders.data.map(
        (item): ReminderForPlan => ({
          id: item.id,
          title: item.title,
          at: effectiveDueAt(item),
          petName: names.get(item.pet_id) ?? null,
        })
      ),
      reminderBody: (item) => {
        const reminder = byId.get(item.id);
        const type = reminder ? t(`agenda.types.${reminder.type}`) : '';
        return tf('notifications.reminder.body', { type, time: formatReminderTime(item.at) });
      },
    });
    void syncScheduledNotifications(plan).catch((error: unknown) => {
      if (__DEV__) console.warn('[notifications] sync', error);
    });
  }, [granted, canUseServer, preferences.data, reminders.data, petNames, petId, petName, loggedToday]);

  return null;
}
