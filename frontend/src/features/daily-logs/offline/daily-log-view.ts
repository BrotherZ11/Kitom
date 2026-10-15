import type { DailyLogHistoryPage } from '@/features/daily-logs/daily-log-history';
import type { DailyLog } from '@/features/daily-logs/types';

import { DailyLogError, toDailyLogError } from '../daily-log-errors.ts';
import { flattenHistory } from '../daily-log-history.ts';
import { contentFromRow, type DailyLogContent } from './daily-log-content.ts';
import { differingUnits, type MergeUnit } from './daily-log-merge.ts';
import type { LocalDailyLog } from './local-daily-log.ts';

/**
 * Lo que muestran las pantallas de Daily Logs combinando el servidor (TanStack Query) y el
 * dispositivo (`LocalStore`). Módulo puro (`npm test`).
 *
 * Reglas:
 * - Un cambio pendiente (pendiente, fallido o en conflicto) prevalece siempre sobre el servidor.
 * - Sin cambios pendientes, manda el servidor; la copia local es solo el último dato conocido y se
 *   usa mientras el servidor no está disponible (sin conexión) o todavía carga.
 * - Sin conexión y sin nada local: el registro de hoy se puede rellenar (se creará con
 *   `p_expect_absent`); el historial y los registros anteriores muestran el error, nunca una lista
 *   vacía que haga creer que no hay registros.
 * - Con conexión, el formulario espera brevemente al servidor antes de abrirse con la copia local
 *   (`waitForRemote`, lo limita en el tiempo quien llama); pasado ese tope se abre con la copia
 *   local y se indica que el servidor aún no se ha comprobado (`checking`).
 * - Un error al leer el almacén local es un error (`local_read_failed`), nunca "no hay datos": podría
 *   esconder cambios pendientes.
 */

export type DisplaySyncStatus = 'synced' | 'pending' | 'syncing' | 'conflict' | 'failed';

/** Estado de una query del servidor reducido a lo que importa aquí. */
export type RemoteState<T> =
  | { status: 'success'; data: T }
  | { status: 'loading' }
  /** Sin conexión: la petición falló por red o TanStack la tiene en pausa. */
  | { status: 'unavailable'; error: unknown }
  | { status: 'error'; error: unknown };

export type LocalState<T> = { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; error: unknown };

type QueryLike<T> = {
  data: T | undefined;
  error: unknown;
  status: 'pending' | 'error' | 'success';
  fetchStatus: 'fetching' | 'paused' | 'idle';
};

const isNetworkError = (error: unknown) => toDailyLogError(error).code === 'network';

export function toRemoteState<T>(query: QueryLike<T>): RemoteState<T> {
  if (query.data !== undefined) return { status: 'success', data: query.data };
  if (query.status === 'error') {
    return isNetworkError(query.error)
      ? { status: 'unavailable', error: query.error }
      : { status: 'error', error: query.error };
  }
  if (query.fetchStatus === 'paused') return { status: 'unavailable', error: new DailyLogError('network') };
  return { status: 'loading' };
}

/**
 * Estado de una lectura del almacén local. Un error sin datos es un error de lectura (nunca "vacío");
 * si ya había datos y falla una relectura, se siguen usando.
 */
export function toLocalState<T>(
  query: { data: T | undefined; error?: unknown; status: 'pending' | 'error' | 'success' },
  empty: T
): LocalState<T> {
  if (query.status === 'pending') return { status: 'loading' };
  if (query.status === 'error' && query.data === undefined) {
    return { status: 'error', error: new DailyLogError('local_read_failed', query.error) };
  }
  return { status: 'ready', data: query.data ?? empty };
}

export function displaySyncStatus(record: LocalDailyLog | null, syncing: boolean): DisplaySyncStatus | null {
  if (!record) return null;
  if (syncing) return 'syncing';
  if (record.status === 'pending') return 'pending';
  return record.status;
}

export type DailyLogDetailView =
  | { state: 'loading' }
  | { state: 'error'; error: unknown }
  | {
      state: 'ready';
      /** Contenido a mostrar; `null` = no hay registro de ese día. */
      content: DailyLogContent | null;
      /** Fila del servidor sobre la que se editaría (la que se muestra o la base de lo pendiente). */
      baseRow: DailyLog | null;
      /** Registro local (pendiente o copia), si existe. */
      record: LocalDailyLog | null;
      /** De dónde sale `content`. */
      source: 'remote' | 'local';
      /** El servidor no está disponible ahora: se muestra lo del dispositivo. */
      offline: boolean;
      /** El servidor todavía no ha respondido: se muestra lo del dispositivo sin haberlo comprobado. */
      checking: boolean;
      /** `null` = no hay registro. */
      syncStatus: DisplaySyncStatus | null;
    };

export function resolveDailyLogDetail(input: {
  remote: RemoteState<DailyLog | null>;
  local: LocalState<LocalDailyLog | null>;
  syncing: boolean;
  /** Registro de hoy: sin conexión y sin datos se puede empezar uno nuevo. */
  allowOfflineCreate: boolean;
  /**
   * Hay conexión y todavía no se ha agotado la espera: mientras el servidor carga, no se abre con la
   * copia local (salvo cambios pendientes, que siempre prevalecen).
   */
  waitForRemote?: boolean;
}): DailyLogDetailView {
  const { remote, local, syncing } = input;
  if (local.status === 'loading') return { state: 'loading' };
  if (local.status === 'error') return { state: 'error', error: local.error };
  const record = local.data;
  const offline = remote.status === 'unavailable';
  const checking = remote.status === 'loading';

  if (record?.pending) {
    return {
      state: 'ready',
      content: record.pending.content,
      baseRow: record.serverRow,
      record,
      source: 'local',
      offline,
      checking: false,
      syncStatus: displaySyncStatus(record, syncing),
    };
  }

  if (remote.status === 'success') {
    const row = remote.data;
    return {
      state: 'ready',
      content: row ? contentFromRow(row) : null,
      baseRow: row,
      record,
      source: 'remote',
      offline: false,
      checking: false,
      syncStatus: row ? 'synced' : null,
    };
  }

  if (remote.status === 'error') return { state: 'error', error: remote.error };
  // Con conexión, primero el servidor (con un tope de espera que controla quien llama).
  if (checking && input.waitForRemote) return { state: 'loading' };

  if (record?.serverRow) {
    return {
      state: 'ready',
      content: contentFromRow(record.serverRow),
      baseRow: record.serverRow,
      record,
      source: 'local',
      offline,
      checking,
      syncStatus: 'synced',
    };
  }

  if (input.allowOfflineCreate) {
    return {
      state: 'ready',
      content: null,
      baseRow: null,
      record: null,
      source: 'local',
      offline,
      checking,
      syncStatus: null,
    };
  }
  if (remote.status === 'loading') return { state: 'loading' };
  return { state: 'error', error: remote.error };
}

/** Fila para mostrar un registro local en listas (el contenido pendiente sobre la fila confirmada). */
export function toDisplayRow(record: LocalDailyLog): DailyLog {
  const content = record.pending?.content;
  if (record.serverRow) return content ? { ...record.serverRow, ...content } : record.serverRow;
  return {
    id: `local:${record.petId}:${record.logDate}`,
    pet_id: record.petId,
    log_date: record.logDate,
    logged_by: null,
    last_edited_by: null,
    created_at: '',
    updated_at: '',
    // Sin fila del servidor siempre hay operación pendiente (`parseLocalDailyLog` lo garantiza).
    ...(content as DailyLogContent),
  };
}

export type HistoryItemView = { log: DailyLog; syncStatus: DisplaySyncStatus };

export type DailyLogHistoryView =
  | { state: 'loading' }
  | { state: 'error'; error: unknown }
  | { state: 'ready'; items: HistoryItemView[]; offline: boolean };

const byDateDesc = (a: HistoryItemView, b: HistoryItemView) =>
  a.log.log_date < b.log.log_date ? 1 : a.log.log_date > b.log.log_date ? -1 : 0;

/**
 * Historial: páginas del servidor con los cambios pendientes encima (sin duplicar días). Un registro
 * creado sin conexión aparece en su sitio si cae dentro de lo ya cargado; los más antiguos aparecen
 * al cargar su página.
 */
export function resolveDailyLogHistory(input: {
  remote: RemoteState<{ pages: DailyLogHistoryPage[]; hasNextPage: boolean }>;
  local: LocalState<LocalDailyLog[]>;
  syncingKey: string | null;
}): DailyLogHistoryView {
  const { remote, local, syncingKey } = input;
  if (local.status === 'error') return { state: 'error', error: local.error };
  if (local.status === 'loading' || remote.status === 'loading') return { state: 'loading' };
  if (remote.status === 'error') return { state: 'error', error: remote.error };

  const itemFor = (record: LocalDailyLog): HistoryItemView => ({
    log: toDisplayRow(record),
    syncStatus:
      displaySyncStatus(record, syncingKey === `${record.petId}/${record.logDate}`) ?? 'synced',
  });

  if (remote.status === 'unavailable') {
    if (local.data.length === 0) return { state: 'error', error: remote.error };
    return { state: 'ready', items: local.data.map(itemFor).sort(byDateDesc), offline: true };
  }

  const rows = flattenHistory(remote.data.pages);
  const oldestLoaded = rows.at(-1)?.log_date;
  const byDate = new Map<string, HistoryItemView>(rows.map((log) => [log.log_date, { log, syncStatus: 'synced' }]));
  for (const record of local.data) {
    if (!record.pending) continue;
    const inRange =
      byDate.has(record.logDate) ||
      !remote.data.hasNextPage ||
      oldestLoaded === undefined ||
      record.logDate >= oldestLoaded;
    if (inRange) byDate.set(record.logDate, itemFor(record));
  }
  return { state: 'ready', items: [...byDate.values()].sort(byDateDesc), offline: false };
}

export type UnsyncedItemView = {
  record: LocalDailyLog;
  /** Nombre de la mascota si se conoce (puede que ya no se tenga acceso a ella); `null` si no. */
  petName: string | null;
  syncStatus: DisplaySyncStatus;
};

export type UnsyncedListView =
  | { state: 'loading' }
  | { state: 'error'; error: unknown }
  | { state: 'ready'; items: UnsyncedItemView[] };

/**
 * Registros del dispositivo con cambios sin confirmar (pendientes, fallidos o en conflicto), del día
 * más reciente al más antiguo. Sale solo del almacén local del usuario: no depende de poder ver la
 * mascota en el servidor (RLS la oculta si ya no se es miembro). `pets` solo pone nombres.
 */
export function resolveUnsyncedList(input: {
  local: LocalState<LocalDailyLog[]>;
  pets: readonly { id: string; name: string }[] | undefined;
  syncingKey: string | null;
}): UnsyncedListView {
  const { local, pets, syncingKey } = input;
  if (local.status === 'loading') return { state: 'loading' };
  if (local.status === 'error') return { state: 'error', error: local.error };
  const names = new Map((pets ?? []).map((pet) => [pet.id, pet.name]));
  const items = local.data
    .filter((record) => record.status !== 'synced')
    .map((record) => ({
      record,
      petName: names.get(record.petId) ?? null,
      syncStatus:
        displaySyncStatus(record, syncingKey === `${record.petId}/${record.logDate}`) ?? record.status,
    }))
    .sort(
      (a, b) =>
        (a.record.logDate < b.record.logDate ? 1 : a.record.logDate > b.record.logDate ? -1 : 0) ||
        (a.record.petId < b.record.petId ? -1 : a.record.petId > b.record.petId ? 1 : 0)
    );
  return { state: 'ready', items };
}

export type ConflictSummary = {
  /** Fila del servidor: sin leer todavía, borrada o presente. */
  remote: 'not_fetched' | 'absent' | 'present';
  /** Datos en los que tu versión y la del servidor no coinciden (solo con `remote: 'present'`). */
  fields: (MergeUnit | 'tags')[];
};

export function describeConflict(record: LocalDailyLog | null): ConflictSummary | null {
  if (!record?.conflict || !record.pending) return null;
  const { remote } = record.conflict;
  if (remote.status !== 'present') return { remote: remote.status, fields: [] };
  return { remote: 'present', fields: differingUnits(record.pending.content, contentFromRow(remote.row)) };
}
