import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { useAuth } from '@/features/auth/auth-context';
import { createOwnerAccessToken } from '@/features/auth/owner-session';
import { localQueryOptions } from '@/features/daily-logs/offline/daily-log-cache';
import { deletePet, fetchCanEditPet } from '@/features/pets/api/pets-api';
import { createPetReads } from '@/features/pets/api/pets-remote';
import { fetchPetStreak } from '@/features/pets/api/pet-streak-api';
import { usePetOperations } from '@/features/pets/hooks/use-pet-writes';
import { petCacheFor } from '@/features/pets/offline/device-pet-cache';
import { isLocalPetId, petSyncDisplay } from '@/features/pets/offline/pet-operation';
import {
  fetchPetListThroughCache,
  fetchPetThroughCache,
  storePetWrite,
  type PetQueryDeps,
} from '@/features/pets/offline/pet-queries';
import { petDetailAsQuery, resolvePetDetailView, resolvePetListView, type PetDetailView } from '@/features/pets/offline/pet-view';
import {
  detailWithLocalEdit,
  listWithLocalEdits,
  localDrafts,
  orphanedEdits,
  resolveLocalPetDetail,
  withLocalEdits,
} from '@/features/pets/offline/pet-write-view';
import { isPetOfflineError, PetError, toPetError } from '@/features/pets/pet-errors';
import { petKeys } from '@/features/pets/query-keys';
import { usePetSync } from '@/features/pets/sync/pet-sync-provider';
import { useIsOnline } from '@/hooks/use-is-online';
import { supabase } from '@/lib/supabase';

/**
 * Mascotas visibles para el usuario (propias y compartidas, según RLS), con copia en el dispositivo
 * para verlas sin conexión (`docs/FRONTEND_ARCHITECTURE.md` §5 «Pets sin conexión (fase 7)») y, encima,
 * las altas y ediciones guardadas en el dispositivo (§5 «Pets: altas y ediciones sin conexión (fase 8)»).
 *
 * - Lista y ficha: solo se piden con la sesión utilizable (`enabled: canUseServer`; en `offline` no se
 *   ejecuta nada) y siempre a través de `serverCall`, con el token del usuario en la cabecera. Cada
 *   respuesta correcta pasa por la copia local (`pet-queries.ts`), que devuelve la versión más
 *   reciente conocida. Un id local (alta sin confirmar) nunca se pide al servidor.
 * - Sin servidor, las pantallas usan la vista combinada (`pet-view.ts`) con la copia local. La copia
 *   solo se lee cuando hace falta.
 * - Permiso de edición y racha: solo del servidor (nunca se guardan). Crear y editar: siempre en el
 *   dispositivo primero (`use-pet-writes.ts`). Borrar: solo con conexión.
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
  const operations = usePetOperations();
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
  const view = listWithLocalEdits(
    resolvePetListView({ remote, local, serverUsable, isOfflineError: isPetOfflineError }),
    operations.data
  );
  const shown = view.state === 'ready' ? view.pets : undefined;
  const serverPets = shown ? (remote.data ?? (local.data?.status === 'loaded' ? local.data.pets : shown)) : undefined;

  return {
    view,
    /** Mascotas del servidor (o de la copia) con sus ediciones locales; sin borradores. */
    data: shown,
    /** Las mismas (versión del servidor) con su operación pendiente encima y su estado. */
    items: serverPets ? withLocalEdits(serverPets, operations.data, operations.syncingKey) : undefined,
    /** Altas guardadas en el dispositivo aún sin confirmar (con id local). */
    drafts: localDrafts(operations.data, operations.syncingKey),
    /** Ediciones del dispositivo de mascotas que no están en la lista (p. ej. sin acceso ya). */
    orphans: orphanedEdits(operations.data, new Set((serverPets ?? []).map((pet) => pet.id)), operations.syncingKey),
    /** Las operaciones del dispositivo no se pudieron leer: no se afirma que no haya ninguna. */
    operationsError: operations.isError,
    refetch: () => {
      if (local.isError) void local.refetch();
      if (operations.isError) void operations.refetch();
      retry(() => void remote.refetch());
    },
  };
}

/**
 * Ficha de una mascota. `view` distingue «no existe» (lo dice el servidor) de «no disponible sin
 * conexión»; `data`/`isError`/`error` dan la forma de una query para las pantallas que solo necesitan
 * el nombre (`petDetailAsQuery`). Con una edición local, `view` la muestra encima y `serverPet` es la
 * versión del servidor (o de la copia) sobre la que se editó. Con un id local (alta de este
 * dispositivo), el borrador; si ya se confirmó, `redirectTo` es el id del servidor.
 */
export function usePet(petId: string) {
  const queryClient = useQueryClient();
  const { auth, userId, serverUsable, retry } = usePetSession();
  const operations = usePetOperations();
  const isLocal = isLocalPetId(petId);
  const remote = useQuery({
    queryKey: petKeys.detail(userId, petId),
    enabled: auth.canUseServer && userId !== '' && !isLocal,
    queryFn: () => asPetError(() => fetchPetThroughCache(queryDeps(userId, auth, queryClient), petId)),
  });
  const needsLocal = !isLocal && remote.data === undefined && (remote.isError || !serverUsable);
  const local = useQuery({
    queryKey: petKeys.localDetail(userId, petId),
    enabled: userId !== '' && needsLocal,
    queryFn: () => petCacheFor(userId).readPet(petId),
    ...localQueryOptions,
  });

  const draft = isLocal ? resolveLocalPetDetail(petId, operations) : null;
  const op =
    draft?.state === 'ready'
      ? draft.op
      : (operations.data?.find((item) => item.kind === 'update' && item.localId === petId) ?? null);
  const serverView: PetDetailView = !draft
    ? resolvePetDetailView({ remote, local, serverUsable, isOfflineError: isPetOfflineError })
    : draft.state === 'ready'
      ? { state: 'ready', pet: draft.pet, source: 'device', stale: false, savedAt: null }
      : draft.state === 'local_error'
        ? { state: 'local_error', error: draft.error }
        : draft.state === 'loading' || draft.state === 'redirect'
          ? { state: 'loading' }
          : { state: 'not_found' };
  const view = detailWithLocalEdit(serverView, op);

  return {
    view,
    ...petDetailAsQuery(view, OFFLINE_ERROR),
    /** La versión del servidor (o de la copia) sin la edición local: la base de una edición nueva. */
    serverPet: !isLocal && serverView.state === 'ready' ? serverView.pet : null,
    op,
    display: petSyncDisplay(op, operations.syncingKey === petId),
    /** Alta confirmada: la mascota está en el servidor con este id. */
    redirectTo: draft?.state === 'redirect' ? draft.petId : null,
    refetch: () => {
      if (local.isError) void local.refetch();
      if (operations.isError) void operations.refetch();
      if (!isLocal) retry(() => void remote.refetch());
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
    // Un alta sin confirmar no existe en el servidor: no hay nada que preguntar.
    enabled: !isLocalPetId(petId),
    queryFn: () => serverCall(() => fetchCanEditPet(petId)),
  });
}

/** Racha calculada por el servidor (`pet_streaks`); se vuelve a pedir al abrir el perfil. */
export function usePetStreak(petId: string) {
  const { user, serverCall } = useAuth();
  return useQuery({
    queryKey: petKeys.streak(user?.id ?? '', petId),
    enabled: !isLocalPetId(petId),
    queryFn: () => serverCall(() => fetchPetStreak(petId)),
  });
}

/**
 * Borrar una mascota (solo con conexión: no hay borrados sin conexión). La copia queda «no disponible»
 * y una edición pendiente de esa mascota se descarta en el dispositivo (el usuario la ha borrado).
 */
export function useDeletePet(petId: string) {
  const queryClient = useQueryClient();
  const auth = useAuth();
  const { engine } = usePetSync();

  return useMutation({
    mutationFn: async () => {
      if (!auth.user) throw new PetError('not_allowed');
      const deps = queryDeps(auth.user.id, auth, queryClient);
      const mark = deps.repository.beginRead();
      await auth.serverCall(() => deletePet(petId));
      await storePetWrite(deps, mark, petId, null);
      await engine.discard(petId);
    },
    onSuccess: () => {
      const userId = auth.user?.id ?? '';
      queryClient.removeQueries({ queryKey: petKeys.detail(userId, petId) });
      return queryClient.invalidateQueries({ queryKey: petKeys.lists(userId) });
    },
  });
}
