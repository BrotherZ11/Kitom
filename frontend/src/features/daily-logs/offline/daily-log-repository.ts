import type { DailyLog } from '@/features/daily-logs/types';
import type { LocalStore } from '@/lib/local-store/local-store';

import {
  createSyncedLocalDailyLog,
  localDailyLogId,
  localDailyLogs,
  type LocalDailyLog,
} from './local-daily-log.ts';
import { compareVersions, isNewerVersion, isOlderVersion } from './daily-log-version.ts';

/**
 * Registros diarios guardados en el dispositivo de un usuario (`LocalStore`, colección
 * `daily-logs`). Módulo puro: el almacén se inyecta. Única puerta de escritura local: todas las
 * escrituras pasan por `update`, que las ejecuta de una en una (lectura → cambio → escritura sin que
 * otra se cuele en medio) y avisa a los suscriptores.
 *
 * Datos ilegibles: un registro corrupto cuenta como ausente (se puede sobrescribir guardando de
 * nuevo); uno de una versión desconocida (lo escribió otra versión de la app) no se sobrescribe. Uno
 * cuyo dueño no coincide con la clave (`key_mismatch`: no se puede verificar de quién es) tampoco:
 * no se lista (nunca se envía), no se sobrescribe y se conserva tal cual para recuperarlo.
 *
 * Lecturas tardías del servidor: quien lee anota una marca (`snapshotMark`) antes de pedir la fila
 * y la pasa a `refreshSnapshot`. Si el registro se escribió en el dispositivo después de la marca
 * (p. ej. el motor confirmó un guardado), la respuesta puede ser anterior a lo que ya hay: solo se
 * acepta si su versión es estrictamente posterior. Así una respuesta que llega fuera de orden nunca
 * hace retroceder la copia local, ni la borra.
 */

export type LocalDailyLogChange = {
  petId: string;
  logDate: string;
  record: LocalDailyLog | null;
  /** Registro antes del cambio. */
  previous: LocalDailyLog | null;
};

/** Momento (en escrituras locales) en que empezó una lectura del servidor. */
export type SnapshotMark = number;

export type DailyLogRepositoryErrorCode = 'unknown_version' | 'ownership_unverified';

export class DailyLogRepositoryError extends Error {
  readonly code: DailyLogRepositoryErrorCode;

  constructor(code: DailyLogRepositoryErrorCode) {
    super(code);
    this.name = 'DailyLogRepositoryError';
    this.code = code;
  }
}

export type DailyLogRepository = {
  readonly userId: string;
  read(petId: string, logDate: string): Promise<LocalDailyLog | null>;
  /** Registros del usuario (opcionalmente de una mascota). Omite los ilegibles. */
  list(petId?: string): Promise<LocalDailyLog[]>;
  /**
   * Cambia un registro de forma atómica respecto a las demás escrituras de esta instalación.
   * `change` recibe el registro actual y devuelve el nuevo (`null` = borrar; el mismo = no escribir).
   */
  update(
    petId: string,
    logDate: string,
    change: (current: LocalDailyLog | null) => LocalDailyLog | null
  ): Promise<LocalDailyLog | null>;
  /** Marca para `refreshSnapshot`: se toma justo antes de pedir datos al servidor. */
  snapshotMark(): SnapshotMark;
  /**
   * Actualiza la copia local con la fila leída del servidor (`null` = no existe). Nunca toca una
   * operación pendiente (ni su versión base) y nunca retrocede:
   * - Una versión anterior a la copia local se ignora.
   * - Si el registro cambió en el dispositivo después de `since` (lectura tardía), solo se acepta
   *   una versión estrictamente posterior; una ausencia, una versión igual o una que no se puede
   *   comparar se ignoran. Sin `since`, la lectura se considera recién hecha.
   * Devuelve la fila más reciente que se conoce (la que deben mostrar las queries del servidor).
   */
  refreshSnapshot(
    petId: string,
    logDate: string,
    row: DailyLog | null,
    since?: SnapshotMark
  ): Promise<DailyLog | null>;
  subscribe(listener: (change: LocalDailyLogChange) => void): () => void;
};

export function createDailyLogRepository(store: LocalStore): DailyLogRepository {
  const listeners = new Set<(change: LocalDailyLogChange) => void>();
  let queue: Promise<unknown> = Promise.resolve();
  // Escrituras locales de esta instalación (en memoria: una lectura en vuelo no sobrevive a un reinicio).
  let writes = 0;
  const lastWrite = new Map<string, number>();
  const writeKey = (petId: string, logDate: string) => `${petId}/${logDate}`;

  const exclusive = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  };

  const readEntry = async (petId: string, logDate: string) => {
    const result = await store.read(localDailyLogs, localDailyLogId(petId, logDate));
    if (result.status === 'found') return { record: result.value, protection: null };
    if (result.status === 'unknown_version') return { record: null, protection: 'unknown_version' as const };
    if (result.status === 'corrupt' && result.reason === 'key_mismatch') {
      return { record: null, protection: 'ownership_unverified' as const };
    }
    return { record: null, protection: null };
  };

  const repository: DailyLogRepository = {
    userId: store.userId,

    async read(petId, logDate) {
      return (await readEntry(petId, logDate)).record;
    },

    async list(petId) {
      const ids = await store.list(localDailyLogs, petId ? [petId] : []);
      const records: LocalDailyLog[] = [];
      for (const [itemPetId, logDate] of ids) {
        if (itemPetId === undefined || logDate === undefined) continue;
        const record = await repository.read(itemPetId, logDate);
        if (record) records.push(record);
      }
      return records;
    },

    update(petId, logDate, change) {
      return exclusive(async () => {
        const { record: current, protection } = await readEntry(petId, logDate);
        const next = change(current);
        if (next === current) return current;
        if (protection) throw new DailyLogRepositoryError(protection);

        const id = localDailyLogId(petId, logDate);
        if (next === null) {
          await store.remove(localDailyLogs, id);
        } else {
          await store.write(localDailyLogs, id, next);
        }
        writes += 1;
        lastWrite.set(writeKey(petId, logDate), writes);
        for (const listener of listeners) listener({ petId, logDate, record: next, previous: current });
        return next;
      });
    },

    snapshotMark: () => writes,

    async refreshSnapshot(petId, logDate, row, since) {
      let latest: DailyLog | null = row;
      await repository.update(petId, logDate, (current) => {
        const known = current?.serverRow ?? null;
        // Nunca hacia atrás: ya hay una versión posterior.
        if (row && known && isOlderVersion(row.updated_at, known.updated_at)) {
          latest = known;
          return current;
        }
        const late = since !== undefined && (lastWrite.get(writeKey(petId, logDate)) ?? 0) > since;
        if (late && !(row && known && isNewerVersion(row.updated_at, known.updated_at))) {
          // Lectura tardía sin una versión claramente posterior: manda lo que hay en el dispositivo.
          latest = current ? (known ?? row) : null;
          return current;
        }
        if (current?.pending) return current;
        if (row === null) return null;
        // Misma fila y mismo instante (aunque se escriba distinto): nada que actualizar.
        if (known?.id === row.id && compareVersions(known.updated_at, row.updated_at) === 0) return current;
        return createSyncedLocalDailyLog({ userId: store.userId, petId, logDate }, row);
      });
      return latest;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  return repository;
}
