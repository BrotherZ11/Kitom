import { useQuery } from '@tanstack/react-query';

import { fetchAchievementCatalog, fetchPetAchievements } from '@/features/achievements/api/achievements-api';
import { useAuth } from '@/features/auth/auth-context';
import { isLocalPetId } from '@/features/pets/offline/pet-operation';
import { getLocale } from '@/i18n';

export const achievementKeys = {
  all: ['achievements'] as const,
  catalog: (locale: string) => [...achievementKeys.all, 'catalog', locale] as const,
  pet: (userId: string, petId: string) => [...achievementKeys.all, userId, 'pet', petId] as const,
};

/** Catálogo de logros (cambia muy poco: se pide una vez por sesión). */
export function useAchievementCatalog() {
  const { canUseServer, serverCall } = useAuth();
  const locale = getLocale();
  return useQuery({
    queryKey: achievementKeys.catalog(locale),
    enabled: canUseServer,
    staleTime: Infinity,
    queryFn: () => serverCall(() => fetchAchievementCatalog(locale)),
  });
}

/** Logros de una mascota; se vuelven a pedir al abrir la pantalla (los otorga el servidor). */
export function usePetAchievements(petId: string) {
  const { user, canUseServer, serverCall } = useAuth();
  return useQuery({
    queryKey: achievementKeys.pet(user?.id ?? '', petId),
    enabled: canUseServer && !isLocalPetId(petId),
    queryFn: () => serverCall(() => fetchPetAchievements(petId)),
  });
}
