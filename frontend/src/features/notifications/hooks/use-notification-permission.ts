import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import {
  canScheduleExactAlarms,
  getNotificationPermission,
  requestNotificationPermission,
  type PermissionState,
} from '@/features/notifications/device-notifications';

const permissionKey = ['notifications', 'permission'] as const;
const exactAlarmsKey = ['notifications', 'exact-alarms'] as const;

/**
 * Permiso de avisos del sistema y, en Android, el de alarmas exactas (`null` si no aplica). Se vuelven a
 * leer al volver a la app (el usuario puede cambiarlos en los ajustes del sistema). En web:
 * `unavailable`.
 */
export function useNotificationPermission() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: permissionKey,
    queryFn: getNotificationPermission,
    staleTime: Infinity,
  });

  const exact = useQuery({
    queryKey: exactAlarmsKey,
    queryFn: () => canScheduleExactAlarms(),
    staleTime: Infinity,
  });

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void queryClient.invalidateQueries({ queryKey: permissionKey });
      void queryClient.invalidateQueries({ queryKey: exactAlarmsKey });
    });
    return () => subscription.remove();
  }, [queryClient]);

  const request = useMutation({
    mutationFn: requestNotificationPermission,
    onSuccess: (state: PermissionState) => queryClient.setQueryData(permissionKey, state),
  });

  return { permission: query.data, exactAlarms: exact.data ?? null, request };
}
