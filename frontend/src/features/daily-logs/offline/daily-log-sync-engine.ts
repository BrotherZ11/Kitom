import type { DailyLog } from '@/features/daily-logs/types';

import { contentFromRow, contentToSaveArgs, sameDailyLogContent, type DailyLogContent } from './daily-log-content.ts';
import type { DailyLogRemote } from './daily-log-remote.ts';
import type { DailyLogRepository } from './daily-log-repository.ts';
import {
  allowImmediateSync,
  applyLocalEdit,
  discardLocalChanges as discardTransition,
  resolveConflict as rebaseConflict,
  applySyncFailure,
  applySyncSuccess,
  isSyncDue,
  refetchConflictRemote,
  retryFailedSync,
  setConflictRemote,
  toSentOperation,
  toSyncPrecondition,
  type LocalDailyLog,
} from './local-daily-log.ts';
import { classifySyncError } from './sync-errors.ts';

/**
 * Motor de sincronización de registros diarios de un usuario. Módulo puro: almacén, servidor,
 * sesión, conectividad, reloj y temporizadores se inyectan (se prueba en Node con un servidor falso
 * y contra el Supabase local).
 *
 * - Guardar es siempre local primero (`saveLocal`); enviar es cosa del motor, nunca de TanStack.
 * - Una sola pasada a la vez (`requestSync`): las peticiones que llegan durante una pasada se
 *   juntan en una pasada más. Dentro de una pasada, una operación detrás de otra.
 * - Antes de cada envío: conectividad (señal del sistema) y sesión activa del mismo usuario.
 * - Cada envío lleva precondición (`toSyncPrecondition`); nunca la llamada sin ella.
 * - Conflicto: se lee la fila remota; si ya tiene lo enviado (respuesta perdida o guardado
 *   idéntico) queda sincronizado; si no, queda en conflicto con los datos locales intactos.
 * - Red o sesión: la pasada se detiene. Con red, el siguiente intento lo programa el backoff.
 * - 401 (sesión no válida): no se envía nada más hasta que haya una sesión nueva o renovada
 *   (`setSessionUserId`); volver a primer plano o recuperar la red no basta.
 * - Descartar cambios locales (`discardLocalChanges`) es solo local: nunca llama al servidor.
 */

export type DailyLogSyncEngineDeps = {
  repository: DailyLogRepository;
  remote: DailyLogRemote;
  /** Señal de conectividad del sistema (no garantiza que el servidor responda). */
  isOnline: () => boolean;
  now: () => number;
  createOperationId: () => string;
  /** Azar del backoff (por defecto `Math.random`). */
  random?: () => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

export type LocalSaveInput = {
  petId: string;
  logDate: string;
  content: DailyLogContent;
  /** Fila del servidor sobre la que se editó (la que mostraba el formulario); `null` si no existía. */
  baseRow: DailyLog | null;
};

/**
 * Decisión tomada en la pantalla de conflictos: guardar `content`, construido comparando con
 * `shownRemote` (la fila del servidor que vio el usuario; `null` = estaba borrada y se vuelve a
 * crear). Descartar es otra operación (`discardLocalChanges`).
 */
export type ConflictResolutionInput = { action: 'save'; content: DailyLogContent; shownRemote: DailyLog | null };

/**
 * Resultado de guardar una resolución. Solo `synced` significa que el servidor la tiene.
 * - `pending`: guardada en el dispositivo; se enviará (sin red, sin sesión o reintentando).
 * - `conflict`: el servidor volvió a cambiar; hay que revisar otra vez (los datos se conservan).
 * - `failed`: el servidor la rechazó (permisos, fecha…); sigue solo en el dispositivo.
 * - `unavailable`: no se pudo leer la versión del servidor (sin conexión o sin sesión): no cambió nada.
 * - `not_in_conflict`: el registro ya no estaba en conflicto (se resolvió o descartó por otra vía, o
 *   desapareció del dispositivo): no se afirma que esté sincronizado.
 */
export type ConflictResolutionOutcome = 'synced' | 'pending' | 'conflict' | 'failed' | 'unavailable' | 'not_in_conflict';

/** Resultado de descartar los cambios locales (ver `discardLocalChanges` en `local-daily-log.ts`). */
export type DiscardOutcome = 'discarded' | 'not_discardable' | 'remote_unknown';

export type DailyLogSyncEngine = {
  /** Guarda la edición en el dispositivo (una operación por registro) y pide sincronizar. */
  saveLocal(input: LocalSaveInput): Promise<LocalDailyLog>;
  /**
   * Usuario de la sesión activa (`null` = sin sesión). El motor nace sin sesión y solo envía
   * operaciones si coincide con el dueño del almacén; se comprueba antes de cada envío. Cada llamada
   * cuenta como una sesión nueva o renovada: es lo único que desbloquea el envío tras un 401.
   */
  setSessionUserId(userId: string | null): void;
  /** Pide una pasada de sincronización. Devuelve la pasada en curso si ya había una. */
  requestSync(): Promise<void>;
  /** Espera a que termine la pasada en curso, sin pedir otra. */
  idle(): Promise<void>;
  /**
   * Guarda la decisión del usuario sobre un conflicto. Nunca da por guardado lo que no confirmó el
   * servidor: lee la versión remota más reciente; si no es la que vio el usuario, vuelve a pedir
   * resolución; si coincide, envía el contenido elegido con la precondición de esa versión.
   */
  resolveConflict(petId: string, logDate: string, input: ConflictResolutionInput): Promise<ConflictResolutionOutcome>;
  /**
   * Descarta los cambios locales de un registro fallido o en conflicto, a petición del usuario.
   * Espera a que no haya una pasada en curso. Solo local: nunca llama al servidor.
   */
  discardLocalChanges(petId: string, logDate: string): Promise<DiscardOutcome>;
  /** Reintento pedido por el usuario: fallida → pendiente, espera anulada, conflicto → volver a leer. */
  retry(petId: string, logDate: string): Promise<void>;
  /** Registro que se está enviando ahora (`petId/logDate`), o `null`. */
  getSyncingKey(): string | null;
  /** Avisa cuando cambia `getSyncingKey()`. */
  subscribe(listener: () => void): () => void;
  /** Empieza a sincronizar (el motor nace parado). */
  start(): void;
  /**
   * Deja de sincronizar (cambio de usuario, fin de sesión, desmontaje). Lo que esté en vuelo termina
   * de aplicarse; no se empieza nada nuevo hasta `start()`.
   */
  stop(): void;
};

export function syncKey(petId: string, logDate: string): string {
  return `${petId}/${logDate}`;
}

type Outcome = 'continue' | 'stop';

function needsReconcile(log: LocalDailyLog): boolean {
  return log.status === 'conflict' && log.conflict?.remote.status === 'not_fetched';
}

export function createDailyLogSyncEngine(deps: DailyLogSyncEngineDeps): DailyLogSyncEngine {
  const { repository, remote } = deps;
  const setTimer = deps.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
  const clearTimer = deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const listeners = new Set<() => void>();
  let syncingKey: string | null = null;
  let draining: Promise<void> | null = null;
  let again = false;
  let timer: unknown = null;
  let active = false;
  let sessionUserId: string | null = null;
  // Cada sesión (o renovación) es una época; un 401 bloquea los envíos de la época en que ocurrió.
  let sessionEpoch = 0;
  let authBlockedEpoch: number | null = null;

  const setSyncing = (key: string | null) => {
    syncingKey = key;
    for (const listener of listeners) listener();
  };

  const canSend = () =>
    active && deps.isOnline() && sessionUserId === repository.userId && authBlockedEpoch !== sessionEpoch;

  /** Tras un fallo: si fue un 401, no se vuelve a enviar con esa sesión. */
  const noteFailure = (policy: string, epoch: number) => {
    if (policy === 'wait_for_auth') authBlockedEpoch = epoch;
  };

  const cancelTimer = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };

  /** Programa la siguiente pasada para el primer reintento con espera pendiente. */
  const schedule = (records: LocalDailyLog[], now: number) => {
    cancelTimer();
    if (!active) return;
    const waits = records
      .filter((log) => log.status === 'pending' && log.pending?.nextAttemptAt != null)
      .map((log) => (log.pending?.nextAttemptAt ?? now) - now)
      .filter((wait) => wait > 0);
    if (waits.length === 0) return;
    timer = setTimer(() => {
      timer = null;
      void requestSync();
    }, Math.min(...waits));
  };

  const reconcile = async (log: LocalDailyLog): Promise<Outcome> => {
    const epoch = sessionEpoch;
    const result = await remote.fetch(log.petId, log.logDate);
    if (!result.ok) {
      const failure = classifySyncError(result.error, result.status);
      noteFailure(failure.policy, epoch);
      return failure.kind === 'network' || failure.policy === 'wait_for_auth' ? 'stop' : 'continue';
    }
    const row = result.data;
    await repository.update(log.petId, log.logDate, (current) => {
      if (!current || current.status !== 'conflict' || !current.pending) return current;
      // El servidor ya tiene exactamente lo que hay en local: no hay nada que resolver.
      if (row && sameDailyLogContent(contentFromRow(row), current.pending.content)) {
        return rebaseConflict(current, { remoteRow: row, content: current.pending.content }, { now: deps.now() });
      }
      return setConflictRemote(current, row);
    });
    return 'continue';
  };

  const send = async (log: LocalDailyLog): Promise<Outcome> => {
    if (!log.pending) return 'continue';
    const sent = toSentOperation(log);
    const args = { ...contentToSaveArgs(log.petId, log.logDate, log.pending.content), ...toSyncPrecondition(log) };
    // Última comprobación: la sesión puede haber cambiado durante la pasada.
    if (!canSend()) return 'stop';

    const epoch = sessionEpoch;
    const result = await remote.save(args);
    if (result.ok) {
      await repository.update(log.petId, log.logDate, (current) =>
        current ? applySyncSuccess(current, sent, result.data) : current
      );
      return 'continue';
    }

    const failure = classifySyncError(result.error, result.status);
    noteFailure(failure.policy, epoch);
    const updated = await repository.update(log.petId, log.logDate, (current) =>
      current
        ? applySyncFailure(current, sent, failure, { now: deps.now(), backoff: { random: deps.random } })
        : current
    );
    if (failure.policy === 'resolve_conflict' && updated && needsReconcile(updated)) return reconcile(updated);
    return failure.kind === 'network' || failure.policy === 'wait_for_auth' ? 'stop' : 'continue';
  };

  const drainOnce = async () => {
    cancelTimer();
    const handled = new Set<string>();
    while (canSend()) {
      const records = await repository.list();
      const now = deps.now();
      // Primero lo que menos ha fallado y, a igualdad, lo más antiguo: un registro que falla una y
      // otra vez no se queda delante del resto de la cola.
      const next = records
        .filter((log) => !handled.has(syncKey(log.petId, log.logDate)))
        .filter((log) => isSyncDue(log, now) || needsReconcile(log))
        .sort(
          (a, b) =>
            (a.pending?.attempts ?? 0) - (b.pending?.attempts ?? 0) ||
            (a.pending?.editedAt ?? 0) - (b.pending?.editedAt ?? 0)
        )[0];
      if (!next) {
        schedule(records, now);
        return;
      }

      const key = syncKey(next.petId, next.logDate);
      handled.add(key);
      setSyncing(key);
      let outcome: Outcome;
      try {
        outcome = next.status === 'conflict' ? await reconcile(next) : await send(next);
      } finally {
        setSyncing(null);
      }
      if (outcome === 'stop') {
        schedule(await repository.list(), deps.now());
        return;
      }
    }
  };

  const requestSync = (): Promise<void> => {
    if (!active) return Promise.resolve();
    if (draining) {
      again = true;
      return draining;
    }
    draining = (async () => {
      try {
        do {
          again = false;
          await drainOnce();
        } while (again && active);
      } catch {
        // Fallo del almacenamiento local o dato inválido: la pasada se abandona sin perder nada; la
        // siguiente (conectividad, primer plano, nuevo guardado) lo vuelve a intentar.
      } finally {
        draining = null;
      }
    })();
    return draining;
  };

  return {
    async saveLocal({ petId, logDate, content, baseRow }) {
      const saved = await repository.update(petId, logDate, (current) => {
        const next = applyLocalEdit(
          current,
          { userId: repository.userId, petId, logDate, content, baseRow },
          { now: deps.now(), createOperationId: deps.createOperationId }
        );
        // Sin nada que enviar: no se sustituye la copia local por una base posiblemente anterior.
        return next.status === 'synced' && current?.status === 'synced' ? current : next;
      });
      void requestSync();
      // `update` solo devuelve null si `change` lo hace, y aquí nunca.
      return saved as LocalDailyLog;
    },

    setSessionUserId(userId) {
      sessionUserId = userId;
      sessionEpoch += 1;
    },

    requestSync,

    idle: () => draining ?? Promise.resolve(),

    async resolveConflict(petId, logDate, input) {
      // Sin pasadas en curso: la resolución no compite con un envío del mismo registro.
      if (draining) await draining;
      const current = await repository.read(petId, logDate);
      if (current?.status !== 'conflict' || !current.pending) return 'not_in_conflict';

      if (!canSend()) return 'unavailable';
      const epoch = sessionEpoch;
      const latest = await remote.fetch(petId, logDate);
      if (!latest.ok) {
        noteFailure(classifySyncError(latest.error, latest.status).policy, epoch);
        return 'unavailable';
      }
      const row = latest.data;

      // El servidor cambió desde que el usuario comparó: se guarda la versión nueva y se vuelve a pedir.
      if ((row?.updated_at ?? null) !== (input.shownRemote?.updated_at ?? null)) {
        await repository.update(petId, logDate, (log) =>
          log?.status === 'conflict' ? setConflictRemote(log, row) : log
        );
        return 'conflict';
      }

      // Contenido elegido sobre la versión que vio: si coincide con el servidor, queda sincronizado
      // sin enviar; si no, queda pendiente con la precondición de esa versión.
      const resolved = await repository.update(petId, logDate, (log) =>
        log?.status === 'conflict' && log.pending
          ? rebaseConflict(log, { remoteRow: row, content: input.content }, { now: deps.now() })
          : log
      );
      if (resolved?.status === 'pending') {
        await requestSync();
        if (draining) await draining;
      }

      // Solo `synced` si el registro sigue ahí y sin cambios: lo confirmó el servidor (envío) o ya
      // tenía exactamente ese contenido (comprobado con la lectura de arriba). Si desapareció del
      // dispositivo mientras tanto, no se afirma nada.
      const after = await repository.read(petId, logDate);
      if (!after) return 'not_in_conflict';
      return after.status;
    },

    async discardLocalChanges(petId, logDate) {
      // Sin pasadas en curso; la decisión se toma dentro de `update`, sobre el registro actual.
      if (draining) await draining;
      let outcome: DiscardOutcome = 'not_discardable';
      await repository.update(petId, logDate, (current) => {
        const result = discardTransition(current);
        outcome = result.status;
        return result.status === 'discarded' ? result.record : current;
      });
      return outcome;
    },

    async retry(petId, logDate) {
      await repository.update(petId, logDate, (current) => {
        if (!current) return current;
        if (current.status === 'failed') return retryFailedSync(current);
        if (current.status === 'conflict') return refetchConflictRemote(current);
        return allowImmediateSync(current);
      });
      await requestSync();
    },

    getSyncingKey: () => syncingKey,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    start() {
      active = true;
    },

    stop() {
      active = false;
      cancelTimer();
    },
  };
}
