import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { fetchDailyLog, fetchDailyLogHistory } from '@/features/daily-logs/api/daily-logs-api';
import {
  dailyLogDetailQueryOptions,
  isUnsynced,
  localQueryOptions,
  readDailyLogThroughRepository,
  readHistoryPageThroughRepository,
  saveDailyLogMutationOptions,
} from '@/features/daily-logs/offline/daily-log-cache';
import {
  syncKey,
  type ConflictResolutionInput,
} from '@/features/daily-logs/offline/daily-log-sync-engine';
import {
  resolveDailyLogDetail,
  resolveDailyLogHistory,
  resolveUnsyncedList,
  toLocalState,
  toRemoteState,
} from '@/features/daily-logs/offline/daily-log-view';
import type { LocalDailyLog } from '@/features/daily-logs/offline/local-daily-log';
import { dailyLogKeys } from '@/features/daily-logs/query-keys';
import { useDailyLogSync, useSyncingKey } from '@/features/daily-logs/sync/daily-log-sync-provider';
import { useIsOnline } from '@/hooks/use-is-online';

/** Cuánto espera el formulario a la versión del servidor antes de abrirse con la copia local. */
export const REMOTE_WAIT_MS = 3_000;

/**
 * Daily Logs: servidor (TanStack Query) + dispositivo (`LocalStore`). Las pantallas usan la vista
 * combinada (`daily-log-view.ts`): lo pendiente prevalece y, sin conexión, se muestra lo último
 * conocido. Guardar es siempre local; envía el motor de sincronización.
 */

/** Registro de un día guardado en el dispositivo (`null` si no hay). */
export function useLocalDailyLog(petId: string, logDate: string | null) {
  const { userId, repository } = useDailyLogSync();
  return useQuery({
    queryKey: dailyLogKeys.local(userId, petId, logDate ?? ''),
    queryFn: (): Promise<LocalDailyLog | null> =>
      logDate ? repository.read(petId, logDate) : Promise.resolve(null),
    enabled: logDate !== null,
    ...localQueryOptions,
  });
}

/** `true` cuando han pasado `ms` desde que `active` se hizo cierto (y ya no vuelve a `false`). */
function useTimeoutElapsed(active: boolean, ms: number): boolean {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!active || elapsed) return;
    const timer = setTimeout(() => setElapsed(true), ms);
    return () => clearTimeout(timer);
  }, [active, elapsed, ms]);
  return elapsed;
}

/**
 * Registro de una mascota en un día, combinado. Sin fecha, `loading`. La lectura del servidor pasa
 * por el almacén local (`readDailyLogThroughRepository`): actualiza la copia local sin tocar nunca
 * una operación pendiente y sin retroceder a una versión anterior.
 *
 * `waitForRemote` (formularios): con conexión y sin cambios pendientes, espera a la versión del
 * servidor hasta `REMOTE_WAIT_MS` antes de usar la copia local; sin conexión, no espera.
 */
export function useDailyLog(
  petId: string,
  logDate: string | null,
  { allowOfflineCreate = false, waitForRemote = false }: { allowOfflineCreate?: boolean; waitForRemote?: boolean } = {}
) {
  const { repository } = useDailyLogSync();
  const remote = useQuery({
    queryKey: dailyLogKeys.detail(petId, logDate ?? ''),
    queryFn: () =>
      logDate
        ? readDailyLogThroughRepository(repository, petId, logDate, () => fetchDailyLog(petId, logDate))
        : Promise.resolve(null),
    enabled: logDate !== null,
    ...dailyLogDetailQueryOptions,
  });
  const local = useLocalDailyLog(petId, logDate);
  const syncing = useSyncingKey() === (logDate ? syncKey(petId, logDate) : null);
  const online = useIsOnline();
  const remoteState = toRemoteState(remote);
  const waitElapsed = useTimeoutElapsed(waitForRemote && remoteState.status === 'loading', REMOTE_WAIT_MS);

  const view =
    logDate === null
      ? ({ state: 'loading' } as const)
      : resolveDailyLogDetail({
          remote: remoteState,
          local: toLocalState(local, null),
          syncing,
          allowOfflineCreate,
          waitForRemote: waitForRemote && online && !waitElapsed,
        });

  return {
    view,
    refetch: () => {
      void remote.refetch();
      void local.refetch();
    },
  };
}

/** Historial de una mascota (páginas del servidor + cambios pendientes del dispositivo). */
export function useDailyLogHistory(petId: string) {
  const { userId, repository } = useDailyLogSync();
  const remote = useInfiniteQuery({
    queryKey: dailyLogKeys.history(petId),
    // Cada fila deja copia local (para verla sin conexión) y se sustituye por la versión más
    // reciente conocida: una página que llega tarde no hace retroceder un registro ya confirmado.
    queryFn: ({ pageParam }) =>
      readHistoryPageThroughRepository(repository, petId, () => fetchDailyLogHistory(petId, pageParam)),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
  const local = useQuery({
    queryKey: dailyLogKeys.localList(userId, petId),
    queryFn: () => repository.list(petId),
    ...localQueryOptions,
  });
  const syncingKey = useSyncingKey();

  const view = resolveDailyLogHistory({
    remote: toRemoteState({
      data: remote.data ? { pages: remote.data.pages, hasNextPage: remote.hasNextPage } : undefined,
      error: remote.error,
      status: remote.status,
      fetchStatus: remote.fetchStatus,
    }),
    local: toLocalState(local, []),
    syncingKey,
  });

  return {
    view,
    hasNextPage: view.state === 'ready' && !view.offline && remote.hasNextPage,
    isFetchingNextPage: remote.isFetchingNextPage,
    isFetchNextPageError: remote.isFetchNextPageError,
    error: remote.error,
    fetchNextPage: () => remote.fetchNextPage(),
    refetch: () => {
      void remote.refetch();
      void local.refetch();
    },
  };
}

/** Guarda (crea o edita) el registro de un día en el dispositivo y pide sincronizar. */
export function useSaveDailyLog() {
  const { engine } = useDailyLogSync();
  return useMutation(saveDailyLogMutationOptions(engine.saveLocal));
}

/**
 * Registros del dispositivo del usuario con cambios sin confirmar (pendientes, fallidos o en
 * conflicto), de todas sus mascotas. Sale solo del almacén local: sigue funcionando aunque la mascota
 * ya no sea visible en el servidor. `pets` (opcional) solo pone nombres.
 */
export function useUnsyncedDailyLogs(pets?: readonly { id: string; name: string }[]) {
  const { userId, repository } = useDailyLogSync();
  const local = useQuery({
    queryKey: dailyLogKeys.unsynced(userId),
    queryFn: async () => (await repository.list()).filter(isUnsynced),
    ...localQueryOptions,
  });
  const syncingKey = useSyncingKey();
  return {
    view: resolveUnsyncedList({ local: toLocalState(local, []), pets, syncingKey }),
    refetch: () => void local.refetch(),
  };
}

/** Descarta los cambios locales de un registro fallido o en conflicto (solo en el dispositivo). */
export function useDiscardLocalDailyLogChanges() {
  const { engine } = useDailyLogSync();
  return (petId: string, logDate: string) => engine.discardLocalChanges(petId, logDate);
}

/** Reintento manual de la sincronización de un registro. */
export function useRetryDailyLogSync() {
  const { engine } = useDailyLogSync();
  return (petId: string, logDate: string) => engine.retry(petId, logDate);
}

/** Guarda la decisión de la pantalla de conflictos (ver `engine.resolveConflict`). */
export function useResolveDailyLogConflict() {
  const { engine } = useDailyLogSync();
  return (petId: string, logDate: string, input: ConflictResolutionInput) =>
    engine.resolveConflict(petId, logDate, input);
}

/**
 * Pide una pasada de sincronización (p. ej. para volver a leer la fila remota de un conflicto). La
 * función es la del motor: estable entre renders (se puede usar en dependencias de efectos).
 */
export function useRequestDailyLogSync() {
  return useDailyLogSync().engine.requestSync;
}
