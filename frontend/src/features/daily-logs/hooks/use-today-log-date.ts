import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { todayLogDate } from '@/features/daily-logs/log-date';
import { useProfileTimeZone } from '@/features/profile/hooks/use-profile-timezone';
import { getDeviceTimeZone, normalizeTimeZone } from '@/features/profile/timezone';

type Options = {
  /**
   * Recalcular al volver la app a primer plano (p. ej. pasada la medianoche). Las pantallas con un
   * formulario abierto lo desactivan: el registro que se está rellenando no cambia de día.
   */
  refreshOnForeground?: boolean;
};

/**
 * "Hoy" (`YYYY-MM-DD`) para Daily Logs, en la zona del perfil → dispositivo → UTC (`log-date.ts`).
 * `null` mientras se carga la zona del perfil; si esa consulta falla, se usa el dispositivo.
 */
export function useTodayLogDate({ refreshOnForeground = true }: Options = {}): string | null {
  const profileTimeZone = useProfileTimeZone();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!refreshOnForeground) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNow(new Date());
    });
    return () => subscription.remove();
  }, [refreshOnForeground]);

  if (profileTimeZone.isPending) return null;
  return todayLogDate(now, { profile: profileTimeZone.data, device: getDeviceTimeZone() }, normalizeTimeZone);
}
