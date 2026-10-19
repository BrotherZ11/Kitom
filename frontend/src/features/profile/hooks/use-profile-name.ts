import { useQuery } from '@tanstack/react-query';

import { useAuth } from '@/features/auth/auth-context';
import { fetchProfileName } from '@/features/profile/api/profile-api';
import { profileKeys } from '@/features/profile/query-keys';

/** Nombre del perfil para saludar («Hola, David»). Sin sesión utilizable no se pide (`null`). */
export function useProfileName() {
  const { user, canUseServer, serverCall } = useAuth();
  const userId = canUseServer ? (user?.id ?? null) : null;

  return useQuery({
    queryKey: profileKeys.name(),
    queryFn: () => (userId ? serverCall(() => fetchProfileName(userId)) : null),
    enabled: userId !== null,
    staleTime: Infinity,
  });
}
