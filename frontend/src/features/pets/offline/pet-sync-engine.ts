import type { SyncNowOutcome } from '@/features/daily-logs/offline/daily-log-sync-engine';
import type { PetWritesRemote } from '@/features/pets/api/pet-writes-remote';
import type { Pet, PetFields } from '@/features/pets/types';

import { classifySyncError, type SyncErrorInfo } from '../../daily-logs/offline/sync-errors.ts';
import type { PetCacheRepository } from './pet-cache-repository.ts';
import type { PetOperationRepository } from './pet-operation-repository.ts';
import {
  applyCreateConfirmed,
  applyPetEdit,
  applyPetSyncFailure,
  canDiscardPetOperation,
  createPetOperation,
  isPetOperationDue,
  markSent,
  parsePetFields,
  reconcileEdit,
  resolvePetConflict,
  retryPetOperation,
  samePetContent,
  type EditRejection,
  type LocalPetOperation,
} from './pet-operation.ts';

/**
 * Motor de sincronización de altas y ediciones de mascotas de un usuario (Pets offline, fase 8).
 * Módulo puro: almacenes, servidor, sesión, conectividad, reloj y temporizadores se inyectan (se prueba
 * en Node con un servidor falso y contra el Supabase local). Mismas reglas que el motor de Daily Logs:
 *
 * - Guardar es siempre local primero (`saveCreate`/`saveEdit`); enviar es cosa del motor.
 * - Una sola pasada a la vez; dentro de ella, una operación detrás de otra.
 * - Antes de cada envío: conectividad y sesión activa del dueño del almacén. Además, el remoto autoriza
 *   cada petición con el token de la sesión del dueño (`pet-writes-remote.ts`).
 * - Antes de enviar se anota `inFlightSince`: si la app se cierra o se pierde la respuesta, la operación
 *   queda con «resultado incierto» y se reenvía, lo que es seguro: el alta lleva su `client_request_id`
 *   (un reenvío da 23505 y se lee la fila por la clave) y la edición su precondición `updated_at`.
 * - Nada se da por sincronizado sin la fila del servidor: la respuesta, la leída por la clave del alta
 *   o una lectura con exactamente el contenido local.
 * - Una edición que no se aplica (0 filas) se decide leyendo la fila: ya está (sincronizada), sin
 *   permiso o no visible (`forbidden`, datos intactos), otros cambios (se reaplica sobre la versión
 *   nueva) o los mismos campos cambiados (`conflict`, decide el usuario). Nunca se sobrescribe un campo
 *   que cambió en el servidor sin que el usuario lo decida.
 * - 401 (sesión no válida): no se envía nada más hasta una sesión nueva o renovada.
 * - Nunca borra mascotas ni toca fotos. Descartar es solo local.
 * - Lo confirmado pasa a la copia de mascotas (`cache.applyPet`), con la marca tomada antes de enviar.
 */

export type PetSyncEngineDeps = {
  operations: PetOperationRepository;
  cache: Pick<PetCacheRepository, 'beginRead' | 'applyPet'>;
  remote: PetWritesRemote;
  isOnline: () => boolean;
  now: () => number;
  createOperationId: () => string;
  random?: () => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

export class PetEditRejectedError extends Error {
  readonly code: EditRejection | 'invalid_content';

  constructor(code: EditRejection | 'invalid_content') {
    super(code);
    this.name = 'PetEditRejectedError';
    this.code = code;
  }
}

/** Resultado de guardar la decisión de un conflicto. Solo `synced` significa que el servidor la tiene. */
export type PetConflictOutcome = 'synced' | 'pending' | 'conflict' | 'failed' | 'forbidden' | 'unavailable' | 'not_in_conflict';

export type PetSyncEngine = {
  /** Guarda un alta en el dispositivo (mascota con id local) y pide sincronizar. */
  saveCreate(content: PetFields): Promise<LocalPetOperation>;
  /**
   * Guarda una edición sobre `baseRow` (la versión del servidor que se editó); se consolida con la
   * pendiente. `null` si no cambia nada. Lanza `PetEditRejectedError` si la operación está en conflicto o
   * sin permiso (primero se decide qué hacer con ella).
   */
  saveEdit(localId: string, content: PetFields, baseRow: Pet | null): Promise<LocalPetOperation | null>;
  setSessionUserId(userId: string | null): void;
  requestSync(): Promise<void>;
  idle(): Promise<void>;
  /** Pide una pasada y espera como mucho `timeoutMs` (la pasada sigue después). */
  syncFor(timeoutMs: number): Promise<void>;
  /**
   * Pasada pedida por el usuario sobre **todas** sus operaciones sin confirmar (p. ej. antes de cerrar
   * sesión), con límite de tiempo, como `syncNow` de Daily Logs: reintenta las pendientes, fallidas e
   * inciertas y vuelve a leer los conflictos; las «sin permiso» no (no lo arregla reenviar). Sin
   * conexión, sin la sesión del dueño o parado, `unavailable` sin cambiar nada. Nunca descarta ni da
   * por sincronizado nada que no confirme el servidor.
   */
  syncNow(options: { timeoutMs: number }): Promise<SyncNowOutcome>;
  retry(localId: string): Promise<void>;
  /** Descarta la operación (solo en el dispositivo). No se puede con un envío de resultado incierto. */
  discard(localId: string): Promise<'discarded' | 'not_discardable'>;
  resolveConflict(localId: string, input: { content: PetFields; shownRemote: Pet }): Promise<PetConflictOutcome>;
  /** Operación que se está enviando ahora (`localId`), o `null`. */
  getSyncingKey(): string | null;
  subscribe(listener: () => void): () => void;
  start(): void;
  stop(): void;
};

type Outcome = 'continue' | 'stop' | 'again';

export function createPetSyncEngine(deps: PetSyncEngineDeps): PetSyncEngine {
  const { operations, cache, remote } = deps;
  const setTimer = deps.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
  const clearTimer = deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const listeners = new Set<() => void>();
  let syncingKey: string | null = null;
  let draining: Promise<void> | null = null;
  let again = false;
  let timer: unknown = null;
  let active = false;
  let sessionUserId: string | null = null;
  let sessionEpoch = 0;
  let authBlockedEpoch: number | null = null;

  const clock = () => ({ now: deps.now() });
  const setSyncing = (key: string | null) => {
    syncingKey = key;
    for (const listener of listeners) listener();
  };
  const canSend = () =>
    active && deps.isOnline() && sessionUserId === operations.userId && authBlockedEpoch !== sessionEpoch;
  const unavailableReason = (): 'offline' | 'session' | 'stopped' | null => {
    if (!active) return 'stopped';
    if (sessionUserId !== operations.userId || authBlockedEpoch === sessionEpoch) return 'session';
    if (!deps.isOnline()) return 'offline';
    return null;
  };
  const cancelTimer = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  const schedule = (ops: LocalPetOperation[], now: number) => {
    cancelTimer();
    if (!active) return;
    const waits = ops
      .filter((op) => op.status === 'pending' && op.nextAttemptAt !== null)
      .map((op) => (op.nextAttemptAt as number) - now)
      .filter((wait) => wait > 0);
    if (waits.length === 0) return;
    timer = setTimer(() => {
      timer = null;
      void requestSync();
    }, Math.min(...waits));
  };

  /** Fallo de una petición: lo anota y dice si la pasada sigue. */
  const fail = async (localId: string, failure: SyncErrorInfo, epoch: number, responded: boolean): Promise<Outcome> => {
    if (failure.policy === 'wait_for_auth') authBlockedEpoch = epoch;
    await operations.update(localId, (current) => {
      if (!current || current.status === 'synced') return current;
      const next = applyPetSyncFailure(current, failure, { ...clock(), backoff: { random: deps.random } });
      // Hubo respuesta: lo enviado no se aplicó (ya no es incierto).
      return responded ? { ...next, inFlightSince: null } : next;
    });
    return failure.kind === 'network' || failure.policy === 'wait_for_auth' ? 'stop' : 'continue';
  };

  const failure = (result: { error: unknown; status: number | null }) => classifySyncError(result.error, result.status);

  /** Alta confirmada: mapeo y copia. Si se editó durante el envío, lo nuevo pasa a ser una edición. */
  const confirmCreate = async (sent: LocalPetOperation, row: Pet, mark: number) => {
    let followUp: PetFields | null = null;
    await operations.update(sent.localId, (current) => {
      if (!current) return current;
      if (current.editedAt !== sent.editedAt && !samePetContent(current.content, sent.content)) followUp = current.content;
      return applyCreateConfirmed(current, row, clock());
    });
    await cache.applyPet(mark, row.id, row);
    if (followUp) {
      const content: PetFields = followUp;
      await operations.update(row.id, (current) => {
        const next = applyPetEdit(
          current,
          { userId: operations.userId, petId: row.id, content, baseRow: row, operationId: deps.createOperationId() },
          clock()
        );
        return next && 'rejected' in next ? current : next;
      });
    }
  };

  const sendCreate = async (op: LocalPetOperation): Promise<Outcome> => {
    const mark = cache.beginRead();
    const sent = await operations.update(op.localId, (current) => (current?.status === 'pending' ? markSent(current, clock()) : current));
    if (!sent || sent.status !== 'pending' || !canSend()) return 'stop';
    const epoch = sessionEpoch;
    const result = await remote.create(sent.content, sent.operationId);
    if (!result.ok) return fail(sent.localId, failure(result), epoch, result.status !== null);
    if (!result.duplicate) {
      await confirmCreate(sent, result.data, mark);
      return 'continue';
    }
    // Ya existía (respuesta perdida antes): se lee por su clave; nunca se crea otra.
    const found = await remote.findByRequestId(sent.operationId);
    if (!found.ok) return fail(sent.localId, failure(found), epoch, false);
    if (found.data) {
      await confirmCreate(sent, found.data, mark);
      return 'continue';
    }
    // Existe con esa clave pero el propietario no la ve (p. ej. se transfirió): no se reenvía.
    await operations.update(sent.localId, (current) =>
      current && current.status !== 'synced'
        ? { ...current, status: 'forbidden', inFlightSince: null, lastError: { kind: 'permission', reason: 'created_not_visible', at: deps.now() } }
        : current
    );
    return 'continue';
  };

  /** Fila leída para decidir una edición que no se aplicó. */
  const reconcile = async (localId: string, mark: number, epoch: number): Promise<Outcome> => {
    const latest = await remote.fetch(localId);
    if (!latest.ok) return fail(localId, failure(latest), epoch, true);
    const row = latest.data;
    let outcome: Outcome = 'continue';
    let syncedRow: Pet | null = null;
    await operations.update(localId, (current) => {
      if (!current || current.kind !== 'update' || current.status === 'synced') return current;
      const decision = reconcileEdit({ ...current, inFlightSince: null }, row, clock());
      if (decision.result === 'synced') {
        syncedRow = decision.row;
        return null;
      }
      if (decision.result === 'rebase') outcome = 'again';
      return decision.op;
    });
    // Lo leído es la versión actual del servidor (o su ausencia): pasa a la copia.
    await cache.applyPet(mark, localId, syncedRow ?? row);
    return outcome;
  };

  const sendUpdate = async (op: LocalPetOperation): Promise<Outcome> => {
    const mark = cache.beginRead();
    const sent = await operations.update(op.localId, (current) => (current?.status === 'pending' ? markSent(current, clock()) : current));
    if (!sent || sent.status !== 'pending' || !sent.baseRow || !canSend()) return 'stop';
    const epoch = sessionEpoch;
    const result = await remote.update(sent.localId, sent.content, sent.baseRow.updated_at);
    if (!result.ok) return fail(sent.localId, failure(result), epoch, result.status !== null);
    const row = result.data;
    if (!row) return reconcile(sent.localId, mark, epoch);

    await operations.update(sent.localId, (current) => {
      if (!current) return current;
      // Editada otra vez durante el envío: lo nuevo sigue pendiente sobre la versión confirmada.
      if (current.editedAt !== sent.editedAt && !samePetContent(current.content, sent.content)) {
        return { ...current, baseRow: row, status: 'pending', inFlightSince: null, attempts: 0, nextAttemptAt: null, lastError: null };
      }
      return null;
    });
    await cache.applyPet(mark, sent.localId, row);
    return 'continue';
  };

  const refetchConflict = async (op: LocalPetOperation): Promise<Outcome> => {
    const mark = cache.beginRead();
    return reconcile(op.localId, mark, sessionEpoch);
  };

  const drainOnce = async () => {
    cancelTimer();
    const handled = new Set<string>();
    while (canSend()) {
      const ops = await operations.list();
      const now = deps.now();
      const next = ops
        .filter((op) => op.userId === operations.userId && !handled.has(op.localId))
        .filter((op) => isPetOperationDue(op, now) || (op.status === 'conflict' && op.conflictRemote === null))
        // Altas primero (una edición puede depender de que exista la mascota), luego lo más antiguo.
        .sort((a, b) => (a.kind === b.kind ? a.editedAt - b.editedAt : a.kind === 'create' ? -1 : 1))[0];
      if (!next) {
        schedule(ops, now);
        return;
      }
      handled.add(next.localId);
      setSyncing(next.localId);
      let outcome: Outcome;
      try {
        if (next.status === 'conflict') outcome = await refetchConflict(next);
        else outcome = next.kind === 'create' ? await sendCreate(next) : await sendUpdate(next);
      } finally {
        setSyncing(null);
      }
      if (outcome === 'again') again = true;
      if (outcome === 'stop') {
        schedule(await operations.list(), deps.now());
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
        // Fallo del almacenamiento local: la pasada se abandona sin perder nada; la siguiente lo reintenta.
      } finally {
        draining = null;
      }
    })();
    return draining;
  };

  /** Solo columnas editables y válidas: nada más se guarda ni se envía (ni `owner_id` ni fotos). */
  const validContent = (input: PetFields): PetFields => {
    const content = parsePetFields(input);
    if (!content) throw new PetEditRejectedError('invalid_content');
    return content;
  };

  return {
    async saveCreate(input) {
      const content = validContent(input);
      const op = createPetOperation({ userId: operations.userId, content, operationId: deps.createOperationId() }, clock());
      const saved = await operations.update(op.localId, () => op);
      void requestSync();
      return saved as LocalPetOperation;
    },

    async saveEdit(localId, input, baseRow) {
      const content = validContent(input);
      let rejection: EditRejection | null = null;
      const saved = await operations.update(localId, (current) => {
        if (!current && !baseRow) {
          rejection = 'not_editable';
          return current;
        }
        const next = applyPetEdit(
          current,
          { userId: operations.userId, petId: localId, content, baseRow: (current?.baseRow ?? baseRow) as Pet, operationId: deps.createOperationId() },
          clock()
        );
        if (next && 'rejected' in next) {
          rejection = next.rejected;
          return current;
        }
        if (next === null) {
          // Vuelve a ser lo de la base: no queda nada que enviar. Si lo anterior ya salió (resultado
          // incierto), la vuelta atrás se envía como una edición más.
          if (!current || current.inFlightSince === null) return null;
          return { ...current, content, status: 'pending', attempts: 0, nextAttemptAt: null, lastError: null, editedAt: deps.now() };
        }
        return next;
      });
      if (rejection) throw new PetEditRejectedError(rejection);
      void requestSync();
      return saved && saved.status === 'pending' ? saved : null;
    },

    setSessionUserId(userId) {
      sessionUserId = userId;
      sessionEpoch += 1;
    },

    requestSync,
    idle: () => draining ?? Promise.resolve(),

    async syncFor(timeoutMs) {
      let handle: unknown = null;
      const timeout = new Promise<void>((resolve) => {
        handle = setTimer(resolve, timeoutMs);
      });
      await Promise.race([requestSync(), timeout]);
      clearTimer(handle);
    },

    async syncNow({ timeoutMs }) {
      const unavailable = unavailableReason();
      if (unavailable) return { status: 'unavailable', reason: unavailable };
      for (const op of await operations.list()) {
        if (op.status === 'synced' || op.status === 'forbidden' || op.userId !== operations.userId) continue;
        await operations.update(op.localId, (current) => (current ? retryPetOperation(current) : current));
      }
      let handle: unknown = null;
      const timedOut = new Promise<'timed_out'>((resolve) => {
        handle = setTimer(() => resolve('timed_out'), timeoutMs);
      });
      const finished = await Promise.race([requestSync().then(() => 'completed' as const), timedOut]);
      clearTimer(handle);
      return { status: finished };
    },

    async retry(localId) {
      await operations.update(localId, (current) => (current ? retryPetOperation(current) : current));
      await requestSync();
    },

    async discard(localId) {
      if (draining) await draining;
      let outcome: 'discarded' | 'not_discardable' = 'not_discardable';
      await operations.update(localId, (current) => {
        if (!current || !canDiscardPetOperation(current)) return current;
        outcome = 'discarded';
        return null;
      });
      return outcome;
    },

    async resolveConflict(localId, { content, shownRemote }) {
      if (draining) await draining;
      const current = await operations.read(localId);
      if (current?.status !== 'conflict') return 'not_in_conflict';
      if (!canSend()) return 'unavailable';
      const epoch = sessionEpoch;
      const mark = cache.beginRead();
      const latest = await remote.fetch(localId);
      if (!latest.ok) {
        if (failure(latest).policy === 'wait_for_auth') authBlockedEpoch = epoch;
        return 'unavailable';
      }
      const row = latest.data;
      await cache.applyPet(mark, localId, row);
      if (!row) {
        await operations.update(localId, (op) =>
          op?.status === 'conflict'
            ? { ...op, status: 'forbidden', lastError: { kind: 'permission', reason: 'not_visible', at: deps.now() } }
            : op
        );
        return 'forbidden';
      }
      // El servidor cambió desde que el usuario comparó: se enseña la versión nueva.
      if (row.updated_at !== shownRemote.updated_at) {
        await operations.update(localId, (op) => (op?.status === 'conflict' ? { ...op, conflictRemote: row } : op));
        return 'conflict';
      }
      const resolved = await operations.update(localId, (op) =>
        op?.status === 'conflict' ? resolvePetConflict(op, row, content) : op
      );
      if (!resolved) return 'synced';
      await requestSync();
      if (draining) await draining;
      const after = await operations.read(localId);
      if (!after) return 'synced';
      return after.status === 'synced' ? 'synced' : after.status;
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
