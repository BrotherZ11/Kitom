import { useQuery } from '@tanstack/react-query';

import { useAuth } from '@/features/auth/auth-context';
import { fetchSpecies } from '@/features/pets/api/species-api';
import { speciesKeys } from '@/features/pets/query-keys';
import { getLocale } from '@/i18n';

/** Catálogo de especies (cambia muy poco: se cachea durante la sesión). */
export function useSpecies() {
  const locale = getLocale();
  const { serverCall } = useAuth();
  return useQuery({
    queryKey: speciesKeys.list(locale),
    queryFn: () => serverCall(() => fetchSpecies(locale)),
    staleTime: Infinity,
  });
}
