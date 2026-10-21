import { useQuery } from '@tanstack/react-query';

import { useAuth } from '@/features/auth/auth-context';
import { fetchSpecies } from '@/features/pets/api/species-api';
import { SPECIES_SNAPSHOT } from '@/features/pets/offline/species-snapshot';
import { isPetOfflineError } from '@/features/pets/pet-errors';
import { speciesKeys } from '@/features/pets/query-keys';
import { getLocale } from '@/i18n';
import { deviceStorage } from '@/lib/local-store/device-storage';
import { createLocalStore } from '@/lib/local-store/local-store';

/**
 * Catálogo de especies (cambia muy poco: se cachea durante la sesión). Con conexión se guarda también
 * en el dispositivo; sin ella (o sin sesión utilizable) se usa esa copia, para poder crear y editar
 * mascotas sin conexión (`offline/species-snapshot.ts`). Sin copia, el error de conexión.
 */
export function useSpecies() {
  const locale = getLocale();
  const { user, serverCall, isCurrentUser } = useAuth();
  const userId = user?.id ?? '';
  return useQuery({
    queryKey: speciesKeys.list(locale),
    queryFn: async () => {
      const store = userId ? createLocalStore(deviceStorage, userId) : null;
      try {
        const species = await serverCall(() => fetchSpecies(locale));
        // Copia de mejor esfuerzo, solo si la sesión sigue siendo la de este usuario.
        if (store && isCurrentUser(userId)) {
          void store.write(SPECIES_SNAPSHOT, [locale], { savedAt: new Date().toISOString(), species }).catch(() => undefined);
        }
        return species;
      } catch (error) {
        if (!store || !isPetOfflineError(error)) throw error;
        const saved = await store.read(SPECIES_SNAPSHOT, [locale]).catch(() => null);
        if (saved?.status === 'found') return saved.value.species;
        throw error;
      }
    },
    staleTime: Infinity,
  });
}
