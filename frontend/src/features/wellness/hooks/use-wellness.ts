import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/features/auth/auth-context';
import { fetchDailyLogRange } from '@/features/daily-logs/api/daily-logs-api';
import { useTodayLogDate } from '@/features/daily-logs/hooks/use-today-log-date';
import { localQueryOptions, readRangeThroughRepository } from '@/features/daily-logs/offline/daily-log-cache';
import {
  addCoverage,
  coveringRange,
  DAILY_LOG_COVERAGE,
  type CoverageRange,
  type DailyLogCoverage,
} from '@/features/daily-logs/offline/daily-log-coverage';
import { resolveDailyLogRange, toLocalState, toRemoteState, type HistoryItemView } from '@/features/daily-logs/offline/daily-log-view';
import { dailyLogKeys } from '@/features/daily-logs/query-keys';
import type { DailyLog } from '@/features/daily-logs/types';
import { useDailyLogSync, useSyncingKey } from '@/features/daily-logs/sync/daily-log-sync-provider';
import { deviceStorage } from '@/lib/local-store/device-storage';
import { createLocalStore } from '@/lib/local-store/local-store';

import { fetchRange, type WellnessPeriod } from '@/features/wellness/wellness-stats';

/** Se leen siempre los 90 días más los 90 anteriores: una consulta sirve para los tres periodos. */
const LONGEST_PERIOD = 90;

/**
 * Lee el rango a través del almacén local y, si la sesión sigue siendo la del usuario, anota la
 * cobertura (de mejor esfuerzo: sin ella, sin conexión los datos se marcan como parciales).
 */
async function readRangeAndCoverage(input: {
  userId: string;
  petId: string;
  range: { start: string; end: string };
  repository: Parameters<typeof readRangeThroughRepository>[0];
  fetchRows: () => Promise<DailyLog[]>;
  isCurrentUser: (userId: string) => boolean;
  onCoverage: () => void;
}): Promise<DailyLog[]> {
  const { userId, petId, range } = input;
  const fetchedAt = Date.now();
  const rows = await readRangeThroughRepository(input.repository, petId, range, input.fetchRows);
  if (input.isCurrentUser(userId)) {
    const store = createLocalStore(deviceStorage, userId);
    try {
      const saved = await store.read(DAILY_LOG_COVERAGE, [petId]);
      const current = saved.status === 'found' ? saved.value : null;
      await store.write(DAILY_LOG_COVERAGE, [petId], addCoverage(current, { ...range, fetchedAt }));
      input.onCoverage();
    } catch {
      // Sin cobertura: sin conexión, las cifras se marcan como parciales.
    }
  }
  return rows;
}

export type WellnessData =
  | { state: 'loading' }
  | { state: 'error'; error: unknown; retry: () => void }
  | {
      state: 'ready';
      today: string;
      items: HistoryItemView[];
      offline: boolean;
      /**
       * Sin conexión: el rango leído completo que cubre un periodo y su comparación, o `null` si lo del
       * dispositivo es parcial (`docs/proposals/2026-11-10-wellness-reports.md` §5.2). Con conexión, `null`.
       */
      coverageFor: (period: WellnessPeriod) => CoverageRange | null;
      /** Instante (ms) de la última lectura correcta del servidor en esta sesión, si la hay. */
      updatedAt: number | null;
      retry: () => void;
    };

/**
 * Registros de una mascota para el resumen de bienestar: los 180 últimos días del servidor (una
 * consulta, `daily_logs` filtrado por `pet_id` y fechas; RLS decide el acceso) con lo pendiente del
 * dispositivo encima, como el historial. Cada lectura deja copias locales, quita las que el servidor ya
 * no devuelve en ese rango y anota la cobertura; sin conexión se usa lo del dispositivo y la cobertura
 * dice si está completo. `docs/proposals/2026-11-10-wellness-reports.md` §4 y §5.
 */
export function useWellnessData(petId: string): WellnessData {
  const queryClient = useQueryClient();
  const { userId, repository, snapshots } = useDailyLogSync();
  const { serverCall, isCurrentUser } = useAuth();
  const today = useTodayLogDate();
  const range = today ? fetchRange(today, LONGEST_PERIOD) : null;
  const coverageKey = dailyLogKeys.coverage(userId, petId);

  const remote = useQuery({
    queryKey: dailyLogKeys.range(userId, petId, range?.start ?? '', range?.end ?? ''),
    enabled: range !== null,
    queryFn: () =>
      range
        ? readRangeAndCoverage({
            userId,
            petId,
            range,
            repository: { ...snapshots, list: repository.list },
            fetchRows: () => serverCall(() => fetchDailyLogRange(petId, range.start, range.end)),
            isCurrentUser,
            onCoverage: () => void queryClient.invalidateQueries({ queryKey: coverageKey }),
          })
        : Promise.resolve([]),
  });

  // Misma lectura local que el historial (misma clave: se invalida con cada cambio del dispositivo).
  const local = useQuery({
    queryKey: dailyLogKeys.localList(userId, petId),
    queryFn: () => repository.list(petId),
    ...localQueryOptions,
  });

  const coverage = useQuery({
    queryKey: coverageKey,
    queryFn: async (): Promise<DailyLogCoverage | null> => {
      const saved = await createLocalStore(deviceStorage, userId).read(DAILY_LOG_COVERAGE, [petId]);
      return saved.status === 'found' ? saved.value : null;
    },
    ...localQueryOptions,
  });

  const syncingKey = useSyncingKey();
  const retry = () => {
    void remote.refetch();
    void local.refetch();
  };

  if (!range || !today) return { state: 'loading' };
  const view = resolveDailyLogRange({
    remote: toRemoteState(remote),
    local: toLocalState(local, []),
    syncingKey,
    range,
  });
  if (view.state === 'loading') return { state: 'loading' };
  if (view.state === 'error') return { state: 'error', error: view.error, retry };
  return {
    state: 'ready',
    today,
    items: view.items,
    offline: view.offline,
    coverageFor: (period) => {
      if (!view.offline) return null;
      const needed = fetchRange(today, period);
      return coveringRange(coverage.data ?? null, needed.start, needed.end);
    },
    updatedAt: remote.dataUpdatedAt > 0 ? remote.dataUpdatedAt : null,
    retry,
  };
}
