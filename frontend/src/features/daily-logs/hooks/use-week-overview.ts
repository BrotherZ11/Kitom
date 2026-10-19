import { useDailyLogHistory } from '@/features/daily-logs/hooks/use-daily-log';
import { useTodayLogDate } from '@/features/daily-logs/hooks/use-today-log-date';
import { computeWeekOverview, type WeekOverview } from '@/features/daily-logs/week-overview';

export type WeekOverviewState =
  | { state: 'loading' }
  | { state: 'error'; error: unknown; retry: () => void }
  | { state: 'ready'; overview: WeekOverview; today: string; offline: boolean };

/**
 * Semana de una mascota para Hoy y la barra de pestañas. Sale de la primera página del historial
 * combinado (servidor + pendientes del dispositivo, sin duplicados): los 7 últimos días siempre están
 * en ella, así que no hace falta otra consulta. Sin conexión usa lo guardado en el dispositivo.
 */
export function useWeekOverview(petId: string): WeekOverviewState {
  const history = useDailyLogHistory(petId);
  const today = useTodayLogDate();
  const { view } = history;

  if (view.state === 'loading' || today === null) return { state: 'loading' };
  if (view.state === 'error') return { state: 'error', error: view.error, retry: history.refetch };
  return {
    state: 'ready',
    today,
    offline: view.offline,
    overview: computeWeekOverview(view.items, today, { hasMore: history.hasNextPage }),
  };
}
