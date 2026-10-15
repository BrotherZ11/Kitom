import type { InfiniteData, QueryClient } from '@tanstack/react-query';

import type { DailyLogHistoryPage } from '@/features/daily-logs/daily-log-history';
import type { DailyLog } from '@/features/daily-logs/types';

import { flattenHistory, replaceLogInHistory } from '../daily-log-history.ts';
import { dailyLogKeys } from '../query-keys.ts';
import type { DailyLogRepository, LocalDailyLogChange } from './daily-log-repository.ts';
import type { LocalSaveInput } from './daily-log-sync-engine.ts';
import { isNewerVersion, isOlderVersion } from './daily-log-version.ts';
import type { LocalDailyLog } from './local-daily-log.ts';

/**
 * Coherencia entre el almacén local y la caché de TanStack Query. Módulo puro: recibe el
 * QueryClient (se prueba con el de `@tanstack/query-core`). La caché solo refleja; lo persistente es
 * `LocalStore` y lo confirmado, el servidor.
 *
 * Nada hace retroceder una fila en caché: las lecturas del servidor pasan por el almacén local
 * (`readDailyLogThroughRepository`, `readHistoryPageThroughRepository`), que decide con la marca de
 * lectura cuál es la versión más reciente conocida; además, la query del día nunca acepta una fila
 * anterior a la que ya tiene (`keepNewestDailyLog`, aplicado por TanStack al guardar el dato). Así,
 * una lectura iniciada antes de una confirmación del motor no la pisa al terminar, sin necesidad de
 * cancelarla (cancelar y escribir después dejaría una ventana entre las dos operaciones).
 */

type CacheClient = Pick<QueryClient, 'setQueryData' | 'getQueryData' | 'invalidateQueries'>;

/** ¿El registro tiene cambios sin confirmar por el servidor (pendiente, fallido o en conflicto)? */
export function isUnsynced(record: LocalDailyLog | null | undefined): boolean {
  return record != null && record.status !== 'synced';
}

/**
 * `structuralSharing` de la query del día: entre la fila que hay y la nueva, se queda la más
 * reciente. Una fila anterior a la que ya está en caché (lectura tardía) se descarta; la misma fila
 * conserva la referencia. `null` (no existe) se acepta: las lecturas ya lo filtran con la marca de
 * lectura del almacén local.
 */
export function keepNewestDailyLog(previous: unknown, next: unknown): unknown {
  const old = previous as DailyLog | null | undefined;
  const row = next as DailyLog | null;
  if (old && row && isOlderVersion(row.updated_at, old.updated_at)) return old;
  if (old && row && old.id === row.id && old.updated_at === row.updated_at) return old;
  return row;
}

/** Opciones de la query del registro de un día (ver `keepNewestDailyLog`). */
export const dailyLogDetailQueryOptions = { structuralSharing: keepNewestDailyLog } as const;

/**
 * Lectura del registro de un día para la query del servidor: toma la marca, pide la fila y la pasa
 * por el almacén local, que devuelve la versión más reciente conocida. Si el almacén falla, la fila
 * tal cual (la query del día sigue sin aceptar una fila anterior).
 */
export async function readDailyLogThroughRepository(
  repository: Pick<DailyLogRepository, 'snapshotMark' | 'refreshSnapshot'>,
  petId: string,
  logDate: string,
  fetchRow: () => Promise<DailyLog | null>
): Promise<DailyLog | null> {
  const mark = repository.snapshotMark();
  const row = await fetchRow();
  try {
    return await repository.refreshSnapshot(petId, logDate, row, mark);
  } catch {
    return row;
  }
}

/**
 * Página del historial: cada fila pasa por el almacén local (copia para verla sin conexión) y se
 * sustituye por la versión más reciente conocida. Una fila que el dispositivo ya sabe borrada desde
 * que empezó la lectura no se muestra. El cursor de la página no cambia.
 */
export async function readHistoryPageThroughRepository(
  repository: Pick<DailyLogRepository, 'snapshotMark' | 'refreshSnapshot'>,
  petId: string,
  fetchPage: () => Promise<DailyLogHistoryPage>
): Promise<DailyLogHistoryPage> {
  const mark = repository.snapshotMark();
  const page = await fetchPage();
  const logs = await Promise.all(
    page.logs.map((row) =>
      repository.refreshSnapshot(petId, row.log_date, row, mark).catch((): DailyLog | null => row)
    )
  );
  return { ...page, logs: logs.filter((row): row is DailyLog => row !== null) };
}

/**
 * Tras cada escritura local: el registro local y las listas locales se actualizan; si el registro
 * quedó confirmado por el servidor, su fila pasa al registro del día y al historial (si el día no
 * estaba cargado en el historial, se revalida para que aparezca en su sitio). Nunca se sustituye una
 * fila en caché por otra anterior o igual.
 */
export function applyLocalChangeToCache(client: CacheClient, userId: string, change: LocalDailyLogChange): void {
  const { petId, logDate, record, previous } = change;
  client.setQueryData<LocalDailyLog | null>(dailyLogKeys.local(userId, petId, logDate), record);
  void client.invalidateQueries({ queryKey: dailyLogKeys.localList(userId, petId) });
  if (isUnsynced(record) || isUnsynced(previous)) {
    void client.invalidateQueries({ queryKey: dailyLogKeys.unsynced(userId) });
  }

  const row = record?.status === 'synced' ? record.serverRow : null;
  if (!row) return;

  const detailKey = dailyLogKeys.detail(petId, logDate);
  const cached = client.getQueryData<DailyLog | null>(detailKey);
  if (!cached || isNewerVersion(row.updated_at, cached.updated_at)) {
    client.setQueryData<DailyLog | null>(detailKey, row);
  }

  const historyKey = dailyLogKeys.history(petId);
  const history = client.getQueryData<InfiniteData<DailyLogHistoryPage, string | null>>(historyKey);
  if (!history) return;
  const shown = flattenHistory(history.pages).find((item) => item.log_date === logDate);
  if (shown && !isNewerVersion(row.updated_at, shown.updated_at)) return;
  const updated = replaceLogInHistory(history, row);
  if (updated === history) {
    void client.invalidateQueries({ queryKey: historyKey });
  } else {
    client.setQueryData(historyKey, updated);
  }
}

/** Lectura de un registro local para `useQuery`: nunca en pausa (es local) y sin reintentos. */
export const localQueryOptions = {
  networkMode: 'always',
  staleTime: Infinity,
  retry: false,
} as const;

/**
 * Mutación de guardado de Daily Logs: guarda **en el dispositivo** (`saveLocal`) y nada más. El envío
 * al servidor lo hace el motor de sincronización. `networkMode: 'always'` en todas las plataformas:
 * en web, con el modo por defecto, TanStack pondría el guardado en pausa sin conexión y lo
 * ejecutaría solo al reconectar. Solo esta mutación; el resto de la app conserva su configuración.
 */
export function saveDailyLogMutationOptions(saveLocal: (input: LocalSaveInput) => Promise<LocalDailyLog>) {
  return {
    mutationFn: saveLocal,
    networkMode: 'always',
    retry: 0,
  } as const;
}
