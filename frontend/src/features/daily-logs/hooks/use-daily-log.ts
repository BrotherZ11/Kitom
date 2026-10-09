import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { fetchDailyLog, saveDailyLog } from '@/features/daily-logs/api/daily-logs-api';
import { dailyLogKeys } from '@/features/daily-logs/query-keys';
import type { SaveDailyLogArgs } from '@/features/daily-logs/types';

/** Registro de una mascota en un día. `data === null` si todavía no existe. Sin fecha, no consulta. */
export function useDailyLog(petId: string, logDate: string | null) {
  return useQuery({
    queryKey: dailyLogKeys.detail(petId, logDate ?? ''),
    queryFn: () => (logDate ? fetchDailyLog(petId, logDate) : null),
    enabled: logDate !== null,
  });
}

/** Guarda (crea o edita) el registro de un día con `save_daily_log`. */
export function useSaveDailyLog() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: SaveDailyLogArgs) => saveDailyLog(args),
    onSuccess: (log) => {
      const key = dailyLogKeys.detail(log.pet_id, log.log_date);
      // La fila devuelta ya es la guardada: se pone en caché y se marca para revalidar solo esa query.
      queryClient.setQueryData(key, log);
      return queryClient.invalidateQueries({ queryKey: key });
    },
  });
}
