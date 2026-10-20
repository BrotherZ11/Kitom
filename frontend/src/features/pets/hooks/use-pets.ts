import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { useAuth } from '@/features/auth/auth-context';
import { createOwnerAccessToken } from '@/features/auth/owner-session';
import { localQueryOptions } from '@/features/daily-logs/offline/daily-log-cache';
import { createPet, deletePet, fetchCanEditPet, updatePet } from '@/features/pets/api/pets-api';
import { createPetReads } from '@/features/pets/api/pets-remote';
import { fetchPetStreak } from '@/features/pets/api/pet-streak-api';
import { petCacheFor } from '@/features/pets/offline/device-pet-cache';
import {
  fetchPetListThroughCache,
  fetchPetThroughCache,
  storePetWrite,
  type PetQueryDeps,
} from '@/features/pets/offline/pet-queries';
import { petDetailAsQuery, resolvePetDetailView, resolvePetListView } from '@/features/pets/offline/pet-view';
import { isPetOfflineError, PetError, toPetError } from '@/features/pets/pet-errors';
import { petKeys } from '@/features/pets/query-keys';
import type { Pet, PetFields } from '@/features/pets/types';
import { useIsOnline } from '@/hooks/use-is-online';
import { supabase } from '@/lib/supabase';

/**
 * Mascotas visibles para el usuario (propias y compartidas, según RLS), con copia en el dispositivo
 * para verlas sin conexión (`docs/FRONTEND_ARCHITECTURE.md` §5 «Pets sin conexión (fase 7)»).
 *
 * - Lista y ficha: solo se piden con la sesión utilizable (`enabled: canUseServer`; en `offline` no se
 *   ejecuta nada) y siempre a través de `serverCall`, con el token del usuario en la cabecera. Cada
 *   respuesta correcta pasa por la copia local (`pet-queries.ts`), que devuelve la versión más
 *   reciente conocida.
 * - Sin servidor, las pantallas usan la vista combinada (`pet-view.ts`) con la copia local. La copia
 *   solo se lee cuando hace falta.
 * - Permiso de edición y racha: solo del servidor (nunca se guardan). Las escrituras de mascotas
 *   necesitan conexión; su fila devuelta actualiza la copia.
 */

/** Error de «sin conexión» de la ficha sin copia (para `petDetailAsQuery`). */
const OFFLINE_ERROR = new PetError('network');

function queryDeps(
  userId: string,
  { serverCall, isCurrentUser }: Pick<ReturnType<typeof useAuth>, 'serverCall' | 'isCurrentUser'>,
  queryClient: QueryClient
): PetQueryDeps {
  return {
    repository: petCacheFor(userId),
    reads: createPetReads(supabase, { accessToken: createOwnerAccessToken(supabase.auth, userId) }),
    serverCall,
    isOwnerSession: () => isCurrentUser(userId),
    onStored: () => void queryClient.invalidateQueries({ queryKey: petKeys.local(userId) }),
  };
}

/** Errores de servidor como `PetError` (la UI los clasifica sin volver a traducirlos). */
async function asPetError<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw toPetError(error);
  }
}

/** Usuario de la zona autenticada (siempre lo hay dentro de `(app)`) y si se puede usar el servidor. */
function usePetSession() {
  const auth = useAuth();
  const online = useIsOnline();
  const userId = auth.user?.id ?? '';
  const retry = (refetchRemote: () => void) => {
    // Sesión sin comprobar: «Reintentar» es volver a comprobarla (al recuperarla, se piden las queries).
    if (auth.status === 'offline') void auth.recoverSession();
    else if (auth.canUseServer) refetchRemote();
  };
  return { auth, userId, serverUsable: auth.canUseServer && online, retry };
}

export function usePets() {
  const queryClient = useQueryClient();
  const { auth, userId, serverUsable, retry } = usePetSession();
  const remote = useQuery({
    queryKey: petKeys.lists(userId),
    enabled: auth.canUseServer && userId !== '',
    queryFn: () => asPetError(() => fetchPetListThroughCache(queryDeps(userId, auth, queryClient))),
  });
  const needsLocal = remote.data === undefined && (remote.isError || !serverUsable);
  const local = useQuery({
    queryKey: petKeys.localList(userId),
    enabled: userId !== '' && needsLocal,
    queryFn: () => petCacheFor(userId).readList(),
    ...localQueryOptions,
  });
  const view = resolvePetListView({ remote, local, serverUsable, isOfflineError: isPetOfflineError });

  return {
    view,
    /** Mascotas que se muestran (del servidor o de la copia), o `undefined` sin datos. */
    data: view.state === 'ready' ? view.pets : undefined,
    refetch: () => {
      if (local.isError) void local.refetch();
      retry(() => void remote.refetch());
    },
  };
}

/**
 * Ficha de una mascota. `view` distingue «no existe» (lo dice el servidor) de «no disponible sin
 * conexión»; `data`/`isError`/`error` dan la forma de una query para las pantallas que solo necesitan
 * el nombre (`petDetailAsQuery`).
 */
export function usePet(petId: string) {
  const queryClient = useQueryClient();
  const { auth, userId, serverUsable, retry } = usePetSession();
  const remote = useQuery({
    queryKey: petKeys.detail(userId, petId),
    enabled: auth.canUseServer && userId !== '',
    queryFn: () => asPetError(() => fetchPetThroughCache(queryDeps(userId, auth, queryClient), petId)),
  });
  const needsLocal = remote.data === undefined && (remote.isError || !serverUsable);
  const local = useQuery({
    queryKey: petKeys.localDetail(userId, petId),
    enabled: userId !== '' && needsLocal,
    queryFn: () => petCacheFor(userId).readPet(petId),
    ...localQueryOptions,
  });
  const view = resolvePetDetailView({ remote, local, serverUsable, isOfflineError: isPetOfflineError });

  return {
    view,
    ...petDetailAsQuery(view, OFFLINE_ERROR),
    refetch: () => {
      if (local.isError) void local.refetch();
      retry(() => void remote.refetch());
    },
  };
}

/**
 * Solo para decidir qué acciones mostrar; RLS decide de verdad al escribir. Nunca se guarda en el
 * dispositivo: sin conexión el permiso es desconocido.
 */
export function useCanEditPet(petId: string) {
  const { user, serverCall } = useAuth();
  return useQuery({
    queryKey: petKeys.canEdit(user?.id ?? '', petId),
    queryFn: () => serverCall(() => fetchCanEditPet(petId)),
  });
}

/** Racha calculada por el servidor (`pet_streaks`); se vuelve a pedir al abrir el perfil. */
export function usePetStreak(petId: string) {
  const { user, serverCall } = useAuth();
  return useQuery({
    queryKey: petKeys.streak(user?.id ?? '', petId),
    queryFn: () => serverCall(() => fetchPetStreak(petId)),
  });
}

/**
 * Escritura online de una mascota: `begin` toma la marca antes de enviarla y devuelve con qué guardar
 * la fila resultante en la copia local (solo si la sesión sigue siendo de este usuario).
 */
function usePetWriteCache() {
  const queryClient = useQueryClient();
  const auth = useAuth();
  return (userId: string) => {
    const deps = queryDeps(userId, auth, queryClient);
    const mark = deps.repository.beginRead();
    return (petId: string, row: Pet | null) => storePetWrite(deps, mark, petId, row);
  };
}

export function useCreatePet() {
  const queryClient = useQueryClient();
  const { user, serverCall } = useAuth();
  const begin = usePetWriteCache();

  return useMutation({
    mutationFn: async (fields: PetFields) => {
      // El propietario siempre es el usuario de la sesión, nunca un valor del formulario.
      if (!user) throw new PetError('not_allowed');
      const userId = user.id;
      const store = begin(userId);
      const pet = await serverCall(() => createPet(userId, fields));
      await store(pet.id, pet);
      return pet;
    },
    onSuccess: (pet) => {
      const userId = user?.id ?? '';
      queryClient.setQueryData(petKeys.detail(userId, pet.id), pet);
      return queryClient.invalidateQueries({ queryKey: petKeys.lists(userId) });
    },
  });
}

export function useUpdatePet(petId: string) {
  const queryClient = useQueryClient();
  const { user, serverCall } = useAuth();
  const begin = usePetWriteCache();

  return useMutation({
    mutationFn: async (fields: PetFields) => {
      if (!user) throw new PetError('not_allowed');
      const store = begin(user.id);
      const pet = await serverCall(() => updatePet(petId, fields));
      await store(pet.id, pet);
      return pet;
    },
    onSuccess: (pet) => {
      const userId = user?.id ?? '';
      queryClient.setQueryData(petKeys.detail(userId, pet.id), pet);
      return queryClient.invalidateQueries({ queryKey: petKeys.lists(userId) });
    },
  });
}

export function useDeletePet(petId: string) {
  const queryClient = useQueryClient();
  const { user, serverCall } = useAuth();
  const begin = usePetWriteCache();

  return useMutation({
    mutationFn: async () => {
      if (!user) throw new PetError('not_allowed');
      const store = begin(user.id);
      await serverCall(() => deletePet(petId));
      // Borrada en el servidor: la copia queda como «no disponible» (no se borra del dispositivo).
      await store(petId, null);
    },
    onSuccess: () => {
      const userId = user?.id ?? '';
      queryClient.removeQueries({ queryKey: petKeys.detail(userId, petId) });
      return queryClient.invalidateQueries({ queryKey: petKeys.lists(userId) });
    },
  });
}
