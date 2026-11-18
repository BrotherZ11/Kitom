import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useAuth } from '@/features/auth/auth-context';
import { setProfileTimeZoneIfMissing } from '@/features/profile/api/profile-api';
import { profileKeys } from '@/features/profile/query-keys';
import { getDeviceTimeZone, syncProfileTimeZone } from '@/features/profile/timezone';

/** Usuarios ya inicializados en esta ejecución de la app (evita repetir la llamada al remontar). */
const attemptedUserIds = new Set<string>();

/** Esperas entre reintentos si falla (red o servidor); después, al volver a montar la zona con sesión. */
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000];

/**
 * Inicializa `profiles.timezone` con la zona del dispositivo una vez por usuario y arranque, si el
 * perfil no tiene. No sobrescribe un valor existente y nunca bloquea ni rompe la app. Montar una
 * sola vez, en el layout de la zona autenticada.
 */
export function useProfileTimeZoneSync() {
  const queryClient = useQueryClient();
  const { user, canUseServer } = useAuth();
  // Solo con una sesión utilizable: sin ella (`offline`) no se escribe nada en el servidor.
  const userId = canUseServer ? (user?.id ?? null) : null;

  useEffect(() => {
    if (!userId || attemptedUserIds.has(userId)) return;
    attemptedUserIds.add(userId);
    let cancelled = false;
    let done = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const attempt = (retry: number) => {
      void syncProfileTimeZone(userId, {
        detectTimeZone: getDeviceTimeZone,
        saveIfMissing: setProfileTimeZoneIfMissing,
      }).then((result) => {
        if (cancelled) return;
        if (result !== 'failed') done = true;
        if (result === 'saved') {
          void queryClient.invalidateQueries({ queryKey: profileKeys.timeZone() });
        }
        if (result === 'failed') {
          if (__DEV__) console.warn('[profile] no se pudo guardar la zona horaria');
          // Red o servidor (p. ej. un 401 justo tras el registro): se reintenta con espera creciente.
          const delay = RETRY_DELAYS_MS[retry];
          if (delay === undefined) {
            // Agotados: se reintentará la próxima vez que se monte la zona autenticada.
            attemptedUserIds.delete(userId);
            return;
          }
          timer = setTimeout(() => attempt(retry + 1), delay);
        }
      });
    };
    attempt(0);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      // Sin terminar: que el próximo montaje lo intente de nuevo.
      if (!done) attemptedUserIds.delete(userId);
    };
  }, [queryClient, userId]);
}
