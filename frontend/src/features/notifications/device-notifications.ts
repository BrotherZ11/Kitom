import type * as NotificationsModule from 'expo-notifications';
import { Linking, Platform } from 'react-native';

import {
  DAILY_LOG_PREFIX,
  diffSchedule,
  fingerprint,
  REMINDER_PREFIX,
  type PlannedNotification,
} from '@/features/notifications/notification-plan';

/**
 * Avisos locales del dispositivo (expo-notifications). Solo iOS y Android: en web no hay avisos
 * programados y todo es un no-op (`notificationsSupported`). Ningún aviso lleva datos privados más
 * allá del nombre de la mascota y el título del recordatorio.
 *
 * El módulo se carga al usarlo y dentro de `try`: si su parte nativa no está (p. ej. una versión de
 * Expo Go anterior a la del paquete, que no trae `ExpoTopicSubscriptionModule`), los avisos quedan
 * «no disponibles» y la app sigue funcionando, en lugar de romperse al arrancar.
 */

type Notifications = typeof NotificationsModule;

let loaded: Notifications | null | undefined;

function load(): Notifications | null {
  if (loaded !== undefined) return loaded;
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    loaded = null;
    return loaded;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    loaded = require('expo-notifications') as Notifications;
  } catch (error) {
    if (__DEV__) console.warn('[notifications] no disponibles en este entorno', error);
    loaded = null;
  }
  return loaded;
}

/** ¿Hay avisos locales en este dispositivo? (No en web ni sin el módulo nativo.) */
export function areNotificationsSupported(): boolean {
  return load() !== null;
}

/** Constante de módulo para la UI (se evalúa una vez). */
export const notificationsSupported = areNotificationsSupported();

/** Por qué no hay avisos: en web nunca; en móvil, si falta la parte nativa del módulo. */
export const notificationsUnavailableReason: 'web' | 'unavailable' | null = notificationsSupported
  ? null
  : Platform.OS === 'web'
    ? 'web'
    : 'unavailable';

const CHANNEL_ID = 'reminders';

export type NotificationPermission = 'granted' | 'denied' | 'undetermined' | 'unavailable';

export type PermissionState = { status: NotificationPermission; canAskAgain: boolean };

const UNAVAILABLE: PermissionState = { status: 'unavailable', canAskAgain: false };

let configured = false;

/** Mostrar los avisos también con la app abierta y crear el canal de Android. Idempotente. */
export async function configureNotifications(): Promise<void> {
  const N = load();
  if (!N || configured) return;
  configured = true;
  N.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  if (Platform.OS === 'android') {
    await N.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Kitom',
      importance: N.AndroidImportance.HIGH,
    });
  }
}

function toPermission(N: Notifications, response: NotificationsModule.NotificationPermissionsStatus): PermissionState {
  const provisional = response.ios?.status === N.IosAuthorizationStatus.PROVISIONAL;
  if (response.granted || provisional) return { status: 'granted', canAskAgain: response.canAskAgain };
  if (response.status === 'undetermined') return { status: 'undetermined', canAskAgain: true };
  return { status: 'denied', canAskAgain: response.canAskAgain };
}

export async function getNotificationPermission(): Promise<PermissionState> {
  const N = load();
  if (!N) return UNAVAILABLE;
  return toPermission(N, await N.getPermissionsAsync());
}

/** Pide permiso (diálogo del sistema). Si ya se denegó sin poder volver a preguntar, no muestra nada. */
export async function requestNotificationPermission(): Promise<PermissionState> {
  const N = load();
  if (!N) return UNAVAILABLE;
  await configureNotifications();
  return toPermission(N, await N.requestPermissionsAsync());
}

/** Ajustes del sistema de la app (para activar los avisos denegados). */
export function openSystemSettings(): void {
  void Linking.openSettings();
}

function isOurs(identifier: string): boolean {
  return identifier.startsWith(DAILY_LOG_PREFIX) || identifier.startsWith(REMINDER_PREFIX);
}

/**
 * Deja programados exactamente los avisos de `desired` (solo toca los de Kitom). Devuelve cuántos
 * cambió. Un aviso que falla al programarse no impide los demás.
 */
export async function syncScheduledNotifications(desired: readonly PlannedNotification[]): Promise<number> {
  const N = load();
  if (!N) return 0;
  await configureNotifications();
  const scheduled = await N.getAllScheduledNotificationsAsync();
  const { cancel, schedule } = diffSchedule(
    scheduled.map((request) => {
      const fp = request.content.data?.fp;
      return { id: request.identifier, fingerprint: typeof fp === 'string' ? fp : null };
    }),
    desired
  );
  await Promise.all(cancel.map((id) => N.cancelScheduledNotificationAsync(id).catch(() => undefined)));
  for (const item of schedule) {
    try {
      await N.scheduleNotificationAsync({
        identifier: item.id,
        content: { title: item.title, body: item.body, data: { url: item.url, fp: fingerprint(item) } },
        trigger: { type: N.SchedulableTriggerInputTypes.DATE, date: item.date, channelId: CHANNEL_ID },
      });
    } catch (error) {
      if (__DEV__) console.warn('[notifications] schedule', error);
    }
  }
  return cancel.length + schedule.length;
}

/** Quita todos los avisos de Kitom (al cerrar sesión: no deben llegar los de otra cuenta). */
export async function cancelAllAppNotifications(): Promise<void> {
  const N = load();
  if (!N) return;
  const scheduled = await N.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((request) => isOurs(request.identifier))
      .map((request) => N.cancelScheduledNotificationAsync(request.identifier).catch(() => undefined))
  );
}

/** Ruta de la app de un aviso tocado (solo rutas internas). */
export function notificationUrl(response: NotificationsModule.NotificationResponse | null): string | null {
  const url = response?.notification.request.content.data?.url;
  return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') ? url : null;
}

/** Al tocar un aviso (con la app abierta o desde segundo plano). Devuelve cómo dejar de escuchar. */
export function onNotificationOpened(listener: (url: string) => void): () => void {
  const N = load();
  if (!N) return () => undefined;
  const subscription = N.addNotificationResponseReceivedListener((response) => {
    const url = notificationUrl(response);
    if (!url) return;
    N.clearLastNotificationResponse();
    listener(url);
  });
  return () => subscription.remove();
}

/**
 * El aviso que abrió la app desde cerrada, si lo hubo. Se consume: después se borra para no volver a
 * abrir esa pantalla en el siguiente arranque.
 */
export function takeInitialNotificationUrl(): string | null {
  const N = load();
  if (!N) return null;
  const url = notificationUrl(N.getLastNotificationResponse());
  if (url) N.clearLastNotificationResponse();
  return url;
}
