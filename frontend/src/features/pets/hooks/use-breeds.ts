import { useQuery } from '@tanstack/react-query';

import { fetchBreed, fetchBreeds } from '@/features/pets/api/breeds-api';
import { breedKeys } from '@/features/pets/query-keys';
import { getLocale } from '@/i18n';

/** Razas activas de la especie (catálogo estable: se cachea durante la sesión). */
export function useBreeds(speciesId: string) {
  const locale = getLocale();
  return useQuery({
    queryKey: breedKeys.list(speciesId, locale),
    queryFn: () => fetchBreeds(speciesId, locale),
    enabled: speciesId !== '',
    staleTime: Infinity,
  });
}

/** Una raza por id (activa o no); desactivada si no hay id. */
export function useBreed(breedId: string | null) {
  const locale = getLocale();
  return useQuery({
    queryKey: breedKeys.detail(breedId ?? '', locale),
    queryFn: () => fetchBreed(breedId ?? '', locale),
    enabled: breedId !== null && breedId !== '',
    staleTime: Infinity,
  });
}
