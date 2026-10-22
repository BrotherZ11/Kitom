import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import {
  getNotificationPermission,
  requestNotificationPermission,
  type PermissionState,
} from '@/features/notifications/device-notifications';

const permissionKey = ['notifications', 'permission'] as const;

/**
 * Permiso de avisos del sistema. Se vuelve a leer al volver a la app (el usuario puede cambiarlo en
 * los ajustes del sistema). En web: `unavailable`.
 */
export function useNotificationPermission() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: permissionKey,
    queryFn: getNotificationPermission,
    staleTime: Infinity,
  });

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void queryClient.invalidateQueries({ queryKey: permissionKey });
    });
    return () => subscription.remove();
  }, [queryClient]);

  const request = useMutation({
    mutationFn: requestNotificationPermission,
    onSuccess: (state: PermissionState) => queryClient.setQueryData(permissionKey, state),
  });

  return { permission: query.data, request };
}
