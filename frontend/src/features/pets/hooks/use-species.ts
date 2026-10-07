import { useQuery } from '@tanstack/react-query';

import { fetchSpecies } from '@/features/pets/api/species-api';
import { speciesKeys } from '@/features/pets/query-keys';
import { getLocale } from '@/i18n';

/** Catálogo de especies (cambia muy poco: se cachea durante la sesión). */
export function useSpecies() {
  const locale = getLocale();
  return useQuery({
    queryKey: speciesKeys.list(locale),
    queryFn: () => fetchSpecies(locale),
    staleTime: Infinity,
  });
}
