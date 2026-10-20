import { useQuery } from '@tanstack/react-query';

import { useAuth } from '@/features/auth/auth-context';
import { fetchProfileTimeZone } from '@/features/profile/api/profile-api';
import { profileKeys } from '@/features/profile/query-keys';

/** Zona horaria guardada en el perfil (`null` = sin configurar). Cambia muy poco: sin refetch automático. */
export function useProfileTimeZone() {
  const { user, canUseServer, serverCall } = useAuth();
  // Sin sesión utilizable (`offline`) no se pide: `useTodayLogDate` usa la zona del dispositivo.
  const userId = canUseServer ? (user?.id ?? null) : null;

  return useQuery({
    queryKey: profileKeys.timeZone(),
    // `serverCall` además de `enabled`: una revalidación (p. ej. al reconectar) con la `queryFn` del
    // render anterior tampoco sale sin sesión utilizable.
    queryFn: () => (userId ? serverCall(() => fetchProfileTimeZone(userId)) : null),
    enabled: userId !== null,
    staleTime: Infinity,
  });
}
