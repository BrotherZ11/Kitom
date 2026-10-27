import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/features/auth/auth-context';
import { localQueryOptions } from '@/features/daily-logs/offline/daily-log-cache';
import { fetchBreed, fetchBreeds } from '@/features/pets/api/breeds-api';
import { fetchBreedCatalogThroughCache, shouldRetryBreedCatalog } from '@/features/pets/offline/breed-catalog-queries';
import { findBreed, needsLocalBreedCatalog, resolveBreedCatalogView } from '@/features/pets/offline/breed-catalog-view';
import { breedCatalogFor } from '@/features/pets/offline/device-breed-catalog';
import { isPetOfflineError } from '@/features/pets/pet-errors';
import { breedKeys } from '@/features/pets/query-keys';
import { useIsOnline } from '@/hooks/use-is-online';
import { getLocale } from '@/i18n';

/**
 * Catálogo de razas del idioma activo, con copia en el dispositivo para buscar y elegir razas sin
 * conexión (`docs/FRONTEND_ARCHITECTURE.md` §5 «Catálogo de razas sin conexión (fase 9)»).
 *
 * - Servidor: una query por idioma (`staleTime: Infinity`: el catálogo cambia muy poco), solo con la
 *   sesión utilizable y conexión según el sistema (sin red no se intenta; al volver se pide sola) y
 *   siempre a través de `serverCall`. Cada respuesta correcta pasa por la copia del dispositivo.
 * - Sin catálogo del servidor y sin poder usarlo (o con un error suyo), la copia. Lo que se pinta sale
 *   de `view` (`breed-catalog-view.ts`), nunca de `isError`.
 * `enabled: false` no pide nada (p. ej. una ficha sin raza del catálogo).
 */
export function useBreedCatalog({ enabled = true }: { enabled?: boolean } = {}) {
  const queryClient = useQueryClient();
  const locale = getLocale();
  const auth = useAuth();
  const online = useIsOnline();
  const userId = auth.user?.id ?? '';
  const serverUsable = auth.canUseServer && online;

  const remote = useQuery({
    queryKey: breedKeys.catalog(userId, locale),
    enabled: enabled && serverUsable && userId !== '',
    queryFn: () =>
      fetchBreedCatalogThroughCache(
        {
          repository: breedCatalogFor(userId),
          fetchCatalog: () => fetchBreeds(locale),
          serverCall: auth.serverCall,
          isOwnerSession: () => auth.isCurrentUser(userId),
          onStored: () => void queryClient.invalidateQueries({ queryKey: breedKeys.localCatalog(userId, locale) }),
        },
        locale
      ),
    staleTime: Infinity,
    retry: (failureCount, error) => shouldRetryBreedCatalog(failureCount, error, isPetOfflineError),
  });
  const local = useQuery({
    queryKey: breedKeys.localCatalog(userId, locale),
    enabled: enabled && userId !== '' && needsLocalBreedCatalog(remote, serverUsable),
    queryFn: () => breedCatalogFor(userId).read(locale),
    ...localQueryOptions,
  });

  return {
    view: resolveBreedCatalogView({ remote, local, serverUsable, isOfflineError: isPetOfflineError }),
    retry: () => {
      if (local.isError) void local.refetch();
      // Sesión sin comprobar: reintentar es volver a comprobarla (al recuperarla, se piden las queries).
      if (auth.status === 'offline') void auth.recoverSession();
      else if (serverUsable) void remote.refetch();
    },
  };
}

/**
 * Una raza por id (activa o no) para mostrar su nombre: del catálogo (servidor o dispositivo) y, si un
 * catálogo del servidor no la tiene (se añadió después de cargarlo), pedida por id. `data`: la raza,
 * `null` si no existe, `undefined` si no se conoce (p. ej. sin conexión y sin catálogo guardado).
 */
export function useBreed(breedId: string | null) {
  const locale = getLocale();
  const { serverCall } = useAuth();
  const hasId = breedId !== null && breedId !== '';
  const { view } = useBreedCatalog({ enabled: hasId });
  const fromCatalog = findBreed(view, breedId);
  const lookup = hasId && fromCatalog === undefined && view.state === 'ready' && view.source === 'server';
  const single = useQuery({
    queryKey: breedKeys.detail(breedId ?? '', locale),
    queryFn: () => serverCall(() => fetchBreed(breedId ?? '', locale)),
    enabled: lookup,
    staleTime: Infinity,
  });
  return {
    data: fromCatalog ?? (lookup ? single.data : undefined),
    isPending: hasId && (view.state === 'loading' || (lookup && single.isPending)),
  };
}
