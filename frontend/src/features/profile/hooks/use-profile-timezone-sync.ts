import { useEffect } from 'react';

import { useAuth } from '@/features/auth/auth-context';
import { setProfileTimeZoneIfMissing } from '@/features/profile/api/profile-api';
import { getDeviceTimeZone, syncProfileTimeZone } from '@/features/profile/timezone';

/** Usuarios ya inicializados en esta ejecución de la app (evita repetir la llamada al remontar). */
const attemptedUserIds = new Set<string>();

/**
 * Inicializa `profiles.timezone` con la zona del dispositivo una vez por usuario y arranque, si el
 * perfil no tiene. No sobrescribe un valor existente y nunca bloquea ni rompe la app. Montar una
 * sola vez, en el layout de la zona autenticada.
 */
export function useProfileTimeZoneSync() {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId || attemptedUserIds.has(userId)) return;
    attemptedUserIds.add(userId);

    void syncProfileTimeZone(userId, {
      detectTimeZone: getDeviceTimeZone,
      saveIfMissing: setProfileTimeZoneIfMissing,
    }).then((result) => {
      if (result === 'failed') {
        // Red o servidor: se reintentará la próxima vez que se monte la zona autenticada.
        attemptedUserIds.delete(userId);
        if (__DEV__) console.warn('[profile] no se pudo guardar la zona horaria');
      }
    });
  }, [userId]);
}
