import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';

import {
  fetchDailyLog,
  fetchDailyLogHistory,
  saveDailyLog,
} from '@/features/daily-logs/api/daily-logs-api';
import { replaceLogInHistory, type DailyLogHistoryPage } from '@/features/daily-logs/daily-log-history';
import { dailyLogKeys, dailyLogKeysAfterSave } from '@/features/daily-logs/query-keys';
import type { SaveDailyLogArgs } from '@/features/daily-logs/types';

/** Registro de una mascota en un día. `data === null` si todavía no existe. Sin fecha, no consulta. */
export function useDailyLog(petId: string, logDate: string | null) {
  return useQuery({
    queryKey: dailyLogKeys.detail(petId, logDate ?? ''),
    queryFn: () => (logDate ? fetchDailyLog(petId, logDate) : null),
    enabled: logDate !== null,
  });
}

/** Historial de una mascota por páginas (`HISTORY_PAGE_SIZE`), del más reciente al más antiguo. */
export function useDailyLogHistory(petId: string) {
  return useInfiniteQuery({
    queryKey: dailyLogKeys.history(petId),
    queryFn: ({ pageParam }) => fetchDailyLogHistory(petId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

/** Guarda (crea o edita) el registro de un día con `save_daily_log`. */
export function useSaveDailyLog() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: SaveDailyLogArgs) => saveDailyLog(args),
    onSuccess: (log) => {
      const keys = dailyLogKeysAfterSave(log);
      // La fila devuelta ya es la guardada: se pone en caché (registro del día y, si está cargado,
      // en el historial) y se revalidan solo las queries de esa mascota.
      queryClient.setQueryData(keys.detail, log);
      queryClient.setQueryData<InfiniteData<DailyLogHistoryPage, string | null>>(keys.history, (data) =>
        data ? replaceLogInHistory(data, log) : data
      );
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.detail }),
        queryClient.invalidateQueries({ queryKey: keys.history }),
      ]);
    },
  });
}
