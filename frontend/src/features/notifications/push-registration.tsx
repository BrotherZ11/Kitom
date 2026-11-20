import { useQueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { useAuth } from '@/features/auth/auth-context';
import { coOwnerKeys } from '@/features/co-owners/hooks/use-co-owners';
import { registerPushToken, unregisterPushToken } from '@/features/notifications/api/push-tokens-api';
import { getExpoPushToken, notificationsSupported, onPushReceived } from '@/features/notifications/device-notifications';
import { useNotificationPermission } from '@/features/notifications/hooks/use-notification-permission';
import { useIsOnline } from '@/hooks/use-is-online';

/** Tiempo máximo para borrar el token al cerrar sesión: sin red no debe retrasar el cierre. */
const UNREGISTER_TIMEOUT_MS = 3_000;

/** Token registrado en esta ejecución y su cuenta (para no repetir y para borrarlo al salir). */
let registered: { userId: string; token: string } | null = null;

function projectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined;
  const id = extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * Push remotos (invitaciones de co-tutor, `invitation-notify`): con sesión, conexión y el permiso de avisos
 * concedido, registra el token de Expo del dispositivo para la cuenta (`register_push_token`, una vez por
 * ejecución y cuenta; si falla, se reintenta al cambiar la red o el permiso). Con la app abierta, un push de
 * invitación refresca la lista de invitaciones. Montado una vez en `(app)/_layout.tsx`.
 */
export function PushRegistration() {
  const queryClient = useQueryClient();
  const { canUseServer, serverCall, user } = useAuth();
  const online = useIsOnline();
  const { permission } = useNotificationPermission();
  const userId = user?.id ?? null;
  const granted = permission?.status === 'granted';

  useEffect(() => {
    if (!notificationsSupported || !userId || !canUseServer || !online || !granted) return;
    if (Platform.OS !== 'android' && Platform.OS !== 'ios') return;
    const platform = Platform.OS;
    let cancelled = false;
    void (async () => {
      const token = await getExpoPushToken(projectId());
      if (cancelled || !token) return;
      if (registered?.userId === userId && registered.token === token) return;
      try {
        await serverCall(() => registerPushToken(token, platform, Constants.expoConfig?.version ?? null));
        if (!cancelled) registered = { userId, token };
      } catch (error) {
        if (__DEV__) console.warn('[notifications] register push token', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, canUseServer, online, granted, serverCall]);

  useEffect(() => {
    if (!userId) return;
    return onPushReceived((url) => {
      if (url === '/invitations') void queryClient.invalidateQueries({ queryKey: coOwnerKeys.invitations(userId) });
    });
  }, [queryClient, userId]);

  return null;
}

/**
 * Antes de cerrar sesión: borra el token de este dispositivo de la cuenta para que no le lleguen sus push.
 * Nunca impide cerrar: sin red o si tarda, sigue (al entrar otra cuenta, `register_push_token` se lo pasa).
 */
export async function forgetPushToken(): Promise<void> {
  const current = registered;
  if (!current) return;
  registered = null;
  try {
    await Promise.race([
      unregisterPushToken(current.token),
      new Promise((resolve) => setTimeout(resolve, UNREGISTER_TIMEOUT_MS)),
    ]);
  } catch {
    // Sin conexión o sin sesión: el siguiente registro de otra cuenta lo reasigna.
  }
}
