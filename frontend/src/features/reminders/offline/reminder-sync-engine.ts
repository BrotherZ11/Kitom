import type { SyncNowOutcome } from '@/features/daily-logs/offline/daily-log-sync-engine';
import type { ReminderWritesRemote } from '@/features/reminders/api/reminder-writes-remote';
import type { Reminder } from '@/features/reminders/reminder-model';

import { classifySyncError, type SyncErrorInfo } from '../../daily-logs/offline/sync-errors.ts';
import type { ReminderCacheRepository } from './reminder-cache-repository.ts';
import type { ReminderOperationRepository } from './reminder-operation-repository.ts';
import {
  applyCreateConfirmed,
  applyDeleteConfirmed,
  applyReminderEdit,
  applyReminderSyncFailure,
  canDiscardReminderOperation,
  chooseReminderContent,
  createReminderOperation,
  isReminderOperationDue,
  markSent,
  parseReminderContent,
  reconcileDelete,
  reconcileEdit,
  requestReminderDelete,
  resolveCreatedForDelete,
  resolveDeleteConflict,
  resolveReminderConflict,
  retryReminderOperation,
  sameReminderContent,
  toForbidden,
  undoReminderDelete,
  type LocalReminderOperation,
  type ReminderContent,
  type ReminderDeleteRequest,
  type ReminderEditRejection,
  type ReminderOperationKind,
} from './reminder-operation.ts';

/**
 * Motor de sincronización de la agenda de un usuario (fase 14). Módulo puro: todo se inyecta. Mismas reglas
 * que el de Pets (`pet-sync-engine.ts`), más dos propias de la agenda:
 *
 * - Guardar es siempre local primero; enviar es cosa del motor. Una pasada a la vez y una operación tras otra.
 * - Antes de cada envío: conectividad y sesión del dueño; cada petición va con su token.
 * - Se anota `inFlightSince` antes de enviar: el reenvío es seguro (clave en altas, precondición en lo demás).
 * - Nada se da por sincronizado sin la fila del servidor. Un campo cambiado en el servidor no se sobrescribe sin
 *   que lo decida el usuario. Un 401 para el envío hasta tener una sesión nueva.
 * - **Antes de declarar un conflicto se pregunta `can_edit_pet`:** con otra versión no se distingue «cambió» de
 *   «ya no puede escribir», y no se pide resolver un conflicto a quien ya no puede.
 * - **La mascota manda (`petState`):** con una eliminación guardada, sus operaciones se retienen (no se envían y
 *   todo vuelve solo al deshacerla); con la eliminación confirmada, se cierran: el servidor ya borró esas filas.
 * - Nunca descarta nada por su cuenta salvo eso; descartar y deshacer los pide el usuario. Un `forbidden` se
 *   conserva: reenviar no lo arregla y decide quien usa la app.
 */

export type ReminderPetState = 'normal' | 'held' | 'deleted';

/** Mapeos y lápidas ya confirmados que se pueden olvidar (ya no llega ninguna respuesta tardía tan vieja). */
export const SYNCED_RETENTION_MS = 7 * 24 * 60 * 60_000;

export type ReminderSyncEngineDeps = {
  operations: ReminderOperationRepository;
  cache: Pick<ReminderCacheRepository, 'beginRead' | 'applyReminder'>;
  remote: ReminderWritesRemote;
  isOnline: () => boolean;
  now: () => number;
  createOperationId: () => string;
  /** Estado de la mascota en este dispositivo (Pets offline). Por defecto, `normal`. */
  petState?: (petId: string) => Promise<ReminderPetState>;
  random?: () => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

export class ReminderEditRejectedError extends Error {
  readonly code: ReminderEditRejection | 'invalid_content';

  constructor(code: ReminderEditRejection | 'invalid_content') {
    super(code);
    this.name = 'ReminderEditRejectedError';
    this.code = code;
  }
}

export type ReminderConflictOutcome = 'synced' | 'pending' | 'conflict' | 'failed' | 'forbidden' | 'unavailable' | 'not_in_conflict';
export type ReminderUndoDeleteOutcome = 'restored' | 'not_found' | 'confirmed' | 'in_flight';
export type ReminderDeleteConflictOutcome = ReminderConflictOutcome | 'kept' | 'gone';

export type ReminderSyncEngine = {
  saveCreate(petId: string, content: ReminderContent): Promise<LocalReminderOperation>;
  /** `baseRow`: la versión del servidor que se ve (si ya hay operación, manda su base). `null` si no cambia nada. */
  saveEdit(localId: string, patch: Partial<ReminderContent>, baseRow: Reminder | null): Promise<LocalReminderOperation | null>;
  requestDelete(localId: string, baseRow: Reminder | null): Promise<ReminderDeleteRequest>;
  undoDelete(localId: string): Promise<ReminderUndoDeleteOutcome>;
  retry(localId: string): Promise<void>;
  discard(localId: string): Promise<'discarded' | 'not_discardable'>;
  resolveConflict(localId: string, input: { choice: 'local' | 'remote'; shownRemote: Reminder }): Promise<ReminderConflictOutcome>;
  resolveDeleteConflict(localId: string, input: { decision: 'keep' | 'delete'; shownRemote: Reminder }): Promise<ReminderDeleteConflictOutcome>;
  setSessionUserId(userId: string | null): void;
  requestSync(): Promise<void>;
  idle(): Promise<void>;
  syncFor(timeoutMs: number): Promise<void>;
  syncNow(options: { timeoutMs: number }): Promise<SyncNowOutcome>;
  getSyncingKey(): string | null;
  subscribe(listener: () => void): () => void;
  start(): void;
  stop(): void;
};

type Outcome = 'continue' | 'stop' | 'again';

const KIND_ORDER: Record<ReminderOperationKind, number> = { create: 0, update: 1, delete: 2 };

export function createReminderSyncEngine(deps: ReminderSyncEngineDeps): ReminderSyncEngine {
  const { operations, cache, remote } = deps;
  const setTimer = deps.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
  const clearTimer = deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const petState = deps.petState ?? (async () => 'normal' as const);
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
  const canSend = () => active && deps.isOnline() && sessionUserId === operations.userId && authBlockedEpoch !== sessionEpoch;
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
  const schedule = (ops: LocalReminderOperation[], now: number) => {
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

  const failure = (result: { error: unknown; status: number | null }) => classifySyncError(result.error, result.status);

  const fail = async (localId: string, info: SyncErrorInfo, epoch: number, responded: boolean, kind: ReminderOperationKind): Promise<Outcome> => {
    if (info.policy === 'wait_for_auth') authBlockedEpoch = epoch;
    await operations.update(localId, (current) => {
      if (!current || current.status === 'synced' || current.kind !== kind) return current;
      const next = applyReminderSyncFailure(current, info, { ...clock(), backoff: { random: deps.random } });
      return responded ? { ...next, inFlightSince: null } : next;
    });
    return info.kind === 'network' || info.policy === 'wait_for_auth' ? 'stop' : 'continue';
  };

  /** Alta confirmada: mapeo y copia. Si se editó durante el envío, lo nuevo pasa a ser una edición. */
  const confirmCreate = async (sent: LocalReminderOperation, row: Reminder, mark: number) => {
    let followUp: ReminderContent | null = null;
    let deleting = false;
    await operations.update(sent.localId, (current) => {
      if (!current) return current;
      if (current.kind === 'delete') {
        deleting = true;
        if (current.reminderId !== null) return current;
        const decision = resolveCreatedForDelete(current, row);
        return decision.result === 'cancelled' ? current : decision.op;
      }
      if (current.kind !== 'create') return current;
      // Por el contenido, no por la hora: dos cambios en el mismo milisegundo no se confunden.
      if (!sameReminderContent(current.content, sent.content)) followUp = current.content;
      return applyCreateConfirmed(current, row, clock());
    });
    if (deleting) return;
    await cache.applyReminder(mark, row.id, row);
    if (followUp) {
      const patch: ReminderContent = followUp;
      await operations.update(row.id, (current) => {
        const next = applyReminderEdit(
          current,
          { userId: operations.userId, localId: row.id, patch, baseRow: row, operationId: deps.createOperationId() },
          clock()
        );
        return next && 'rejected' in next ? current : next;
      });
    }
  };

  const sendCreate = async (op: LocalReminderOperation): Promise<Outcome> => {
    const mark = cache.beginRead();
    const sent = await operations.update(op.localId, (current) =>
      current?.status === 'pending' && current.kind === 'create' ? markSent(current, clock()) : current
    );
    if (!sent || sent.kind !== 'create') return 'continue';
    if (sent.status !== 'pending' || !canSend()) return 'stop';
    const epoch = sessionEpoch;
    const result = await remote.create(sent.petId, sent.content, sent.operationId);
    if (!result.ok) return fail(sent.localId, failure(result), epoch, result.status !== null, 'create');
    if (!result.duplicate) {
      await confirmCreate(sent, result.data, mark);
      return 'continue';
    }
    // Ya existía (respuesta perdida antes): se lee por su clave; nunca se crea otra.
    const found = await remote.findByRequestId(sent.operationId);
    if (!found.ok) return fail(sent.localId, failure(found), epoch, false, 'create');
    if (found.data && found.data.pet_id === sent.petId) {
      await confirmCreate(sent, found.data, mark);
      return 'continue';
    }
    // Existe con esa clave pero no se ve aquí (sin acceso) o es de otra mascota: no se reenvía.
    await operations.update(sent.localId, (current) =>
      current && current.kind === 'create' && current.status !== 'synced' ? toForbidden(current, 'created_not_visible', clock()) : current
    );
    return 'continue';
  };

  /** Antes de enseñar un conflicto: ¿sigue pudiendo escribir? `null` = no se pudo saber (se reintenta). */
  const stillEditable = async (petId: string): Promise<{ ok: true; canEdit: boolean } | { ok: false; result: { error: unknown; status: number | null } }> => {
    const answer = await remote.canEdit(petId);
    return answer.ok ? { ok: true, canEdit: answer.data } : { ok: false, result: answer };
  };

  const reconcile = async (localId: string, petId: string, mark: number, epoch: number): Promise<Outcome> => {
    const latest = await remote.fetch(localId);
    if (!latest.ok) return fail(localId, failure(latest), epoch, true, 'update');
    const row = latest.data;
    const current = await operations.read(localId);
    if (!current || current.kind !== 'update' || current.status === 'synced') return 'continue';
    const preview = reconcileEdit({ ...current, inFlightSince: null }, row, clock());
    let writable = true;
    if (preview.result === 'conflict') {
      const answer = await stillEditable(petId);
      if (!answer.ok) return fail(localId, failure(answer.result), epoch, true, 'update');
      writable = answer.canEdit;
    }
    let outcome: Outcome = 'continue';
    let syncedRow: Reminder | null = null;
    await operations.update(localId, (op) => {
      if (!op || op.kind !== 'update' || op.status === 'synced') return op;
      const decision = reconcileEdit({ ...op, inFlightSince: null }, row, clock());
      if (decision.result === 'synced') {
        syncedRow = decision.row;
        return null;
      }
      if (decision.result === 'conflict' && !writable) return toForbidden(op, 'not_editable', clock());
      if (decision.result === 'rebase') outcome = 'again';
      return decision.op;
    });
    await cache.applyReminder(mark, localId, syncedRow ?? row);
    return outcome;
  };

  const sendUpdate = async (op: LocalReminderOperation): Promise<Outcome> => {
    const mark = cache.beginRead();
    const sent = await operations.update(op.localId, (current) =>
      current?.status === 'pending' && current.kind === 'update' ? markSent(current, clock()) : current
    );
    if (!sent || sent.kind !== 'update') return 'continue';
    if (sent.status !== 'pending' || !sent.baseRow || !canSend()) return 'stop';
    const epoch = sessionEpoch;
    const result = await remote.update(sent.localId, sent.content, sent.baseRow.updated_at);
    if (!result.ok) return fail(sent.localId, failure(result), epoch, result.status !== null, 'update');
    const row = result.data;
    if (!row) return reconcile(sent.localId, sent.petId, mark, epoch);

    await operations.update(sent.localId, (current) => {
      if (!current) return current;
      if (current.kind === 'delete') {
        const sameBase = current.baseRow?.updated_at === sent.baseRow?.updated_at;
        return current.restore === 'update' && current.inFlightSince === null && sameBase ? { ...current, baseRow: row } : current;
      }
      if (current.kind !== 'update') return current;
      if (!sameReminderContent(current.content, sent.content)) {
        return { ...current, baseRow: row, status: 'pending', inFlightSince: null, attempts: 0, nextAttemptAt: null, lastError: null };
      }
      return null;
    });
    await cache.applyReminder(mark, sent.localId, row);
    return 'continue';
  };

  const closeGoneDelete = async (localId: string, reminderId: string) => {
    await operations.update(localId, (current) => (current?.kind === 'delete' && current.status !== 'synced' ? null : current));
    await cache.applyReminder(cache.beginRead(), reminderId, null);
  };

  const refetchConflict = async (op: LocalReminderOperation): Promise<Outcome> => {
    const mark = cache.beginRead();
    const epoch = sessionEpoch;
    if (op.kind !== 'delete') return reconcile(op.localId, op.petId, mark, epoch);
    if (op.reminderId === null) return 'continue';
    const latest = await remote.fetch(op.reminderId);
    if (!latest.ok) return fail(op.localId, failure(latest), epoch, true, 'delete');
    if (!latest.data) {
      await closeGoneDelete(op.localId, op.reminderId);
      return 'continue';
    }
    const row = latest.data;
    await operations.update(op.localId, (current) =>
      current?.kind === 'delete' && current.status === 'conflict' ? { ...current, conflictRemote: row } : current
    );
    await cache.applyReminder(mark, op.reminderId, row);
    return 'continue';
  };

  const sendDelete = async (op: LocalReminderOperation): Promise<Outcome> => {
    const epoch = sessionEpoch;
    let target = op;
    if (target.reminderId === null) {
      const found = await remote.findByRequestId(target.operationId);
      if (!found.ok) return fail(target.localId, failure(found), epoch, false, 'delete');
      const resolved = await operations.update(target.localId, (current) => {
        if (!current || current.kind !== 'delete' || current.reminderId !== null) return current;
        const decision = resolveCreatedForDelete(current, found.data);
        return decision.result === 'cancelled' ? null : decision.op;
      });
      if (!resolved || resolved.kind !== 'delete' || resolved.status !== 'pending' || resolved.reminderId === null) return 'continue';
      target = resolved;
    }

    const mark = cache.beginRead();
    const sent = await operations.update(target.localId, (current) =>
      current?.kind === 'delete' && current.status === 'pending' && current.baseRow ? markSent(current, clock()) : current
    );
    if (!sent || sent.kind !== 'delete' || !sent.baseRow || sent.reminderId === null) return 'continue';
    if (sent.status !== 'pending' || !canSend()) return 'stop';
    const reminderId = sent.reminderId;
    const result = await remote.delete(reminderId, sent.baseRow.updated_at);
    if (!result.ok) return fail(sent.localId, failure(result), epoch, result.status !== null, 'delete');
    if (result.data) {
      await operations.update(sent.localId, (current) => (current?.kind === 'delete' ? applyDeleteConfirmed(current, clock()) : current));
      await cache.applyReminder(cache.beginRead(), reminderId, null);
      return 'continue';
    }

    const latest = await remote.fetch(reminderId);
    if (!latest.ok) return fail(sent.localId, failure(latest), epoch, true, 'delete');
    const row = latest.data;
    const preview = await operations.read(sent.localId);
    let writable = true;
    if (preview?.kind === 'delete' && reconcileDelete({ ...preview, inFlightSince: null }, row, clock()).result === 'conflict') {
      const answer = await stillEditable(sent.petId);
      if (!answer.ok) return fail(sent.localId, failure(answer.result), epoch, true, 'delete');
      writable = answer.canEdit;
    }
    let outcome: Outcome = 'continue';
    let gone = false;
    await operations.update(sent.localId, (current) => {
      if (!current || current.kind !== 'delete' || current.status === 'synced') return current;
      const decision = reconcileDelete({ ...current, inFlightSince: null }, row, clock());
      if (decision.result === 'gone') {
        gone = true;
        return null;
      }
      if (decision.result === 'conflict' && !writable) return toForbidden(current, 'not_editable', clock());
      if (decision.result === 'rebase') outcome = 'again';
      return decision.op;
    });
    if (gone) await cache.applyReminder(cache.beginRead(), reminderId, null);
    else await cache.applyReminder(mark, reminderId, row);
    return outcome;
  };

  /** Mascota con la eliminación confirmada: el servidor ya borró sus filas; sus operaciones se cierran. */
  const closeDeletedPet = async (op: LocalReminderOperation) => {
    await operations.update(op.localId, (current) => (current && current.status !== 'synced' ? null : current));
    if (op.reminderId) await cache.applyReminder(cache.beginRead(), op.reminderId, null);
  };

  /** Mapeos y lápidas antiguos: solo ocupan sitio. */
  const pruneSynced = async (ops: readonly LocalReminderOperation[], now: number) => {
    for (const op of ops) {
      if (op.status === 'synced' && op.syncedAt !== null && now - op.syncedAt > SYNCED_RETENTION_MS) {
        await operations.update(op.localId, (current) => (current?.status === 'synced' ? null : current));
      }
    }
  };

  const drainOnce = async () => {
    cancelTimer();
    const handled = new Set<string>();
    await pruneSynced(await operations.list(), deps.now());
    while (canSend()) {
      const ops = await operations.list();
      const now = deps.now();
      const candidates = ops
        .filter((op) => op.userId === operations.userId && !handled.has(op.localId))
        .filter((op) => isReminderOperationDue(op, now) || (op.status === 'conflict' && op.conflictRemote === null))
        .sort((a, b) => (a.kind === b.kind ? a.editedAt - b.editedAt : KIND_ORDER[a.kind] - KIND_ORDER[b.kind]));
      const next = candidates[0];
      if (!next) {
        schedule(ops, now);
        return;
      }
      handled.add(next.localId);
      const pet = await petState(next.petId);
      if (pet === 'held') continue;
      if (pet === 'deleted') {
        await closeDeletedPet(next);
        continue;
      }
      setSyncing(next.localId);
      let outcome: Outcome;
      try {
        if (next.status === 'conflict') outcome = await refetchConflict(next);
        else if (next.kind === 'create') outcome = await sendCreate(next);
        else if (next.kind === 'update') outcome = await sendUpdate(next);
        else outcome = await sendDelete(next);
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
        // Fallo del almacenamiento local: se abandona sin perder nada; la siguiente pasada lo reintenta.
      } finally {
        draining = null;
      }
    })();
    return draining;
  };

  const validContent = (input: ReminderContent): ReminderContent => {
    const content = parseReminderContent(input);
    if (!content) throw new ReminderEditRejectedError('invalid_content');
    return content;
  };

  return {
    async saveCreate(petId, input) {
      const content = validContent(input);
      const op = createReminderOperation({ userId: operations.userId, petId, content, operationId: deps.createOperationId() }, clock());
      const saved = await operations.update(op.localId, () => op);
      void requestSync();
      return saved as LocalReminderOperation;
    },

    async saveEdit(localId, patch, baseRow) {
      let rejection: ReminderEditRejection | 'invalid_content' | null = null;
      const saved = await operations.update(localId, (current) => {
        const next = applyReminderEdit(
          current,
          { userId: operations.userId, localId, patch, baseRow, operationId: deps.createOperationId() },
          clock()
        );
        if (next && 'rejected' in next) {
          rejection = next.rejected;
          return current;
        }
        if (next === null) {
          // Vuelve a ser lo de la base: nada que enviar. Si lo anterior ya salió, la vuelta atrás se envía.
          if (!current || current.inFlightSince === null) return null;
          const content = { ...current.content, ...patch };
          return { ...current, content, status: 'pending', attempts: 0, nextAttemptAt: null, lastError: null, editedAt: deps.now() };
        }
        if (!parseReminderContent(next.content)) {
          rejection = 'invalid_content';
          return current;
        }
        return next;
      });
      if (rejection) throw new ReminderEditRejectedError(rejection);
      void requestSync();
      return saved && saved.status === 'pending' ? saved : null;
    },

    async requestDelete(localId, baseRow) {
      let outcome: ReminderDeleteRequest = { result: 'rejected', reason: 'no_base' };
      await operations.update(localId, (current) => {
        const request = requestReminderDelete(current, { userId: operations.userId, localId, baseRow, operationId: deps.createOperationId() }, clock());
        outcome = request;
        if (request.result === 'rejected') return current;
        if (request.result === 'cancelled') return null;
        return request.op;
      });
      if ((outcome as ReminderDeleteRequest).result === 'saved') void requestSync();
      return outcome;
    },

    async undoDelete(localId) {
      let outcome: ReminderUndoDeleteOutcome = 'not_found';
      await operations.update(localId, (current) => {
        if (!current || current.kind !== 'delete') return current;
        const next = undoReminderDelete(current, clock());
        if (next && 'rejected' in next) {
          outcome = next.rejected === 'in_flight' ? 'in_flight' : 'confirmed';
          return current;
        }
        outcome = 'restored';
        return next;
      });
      if ((outcome as ReminderUndoDeleteOutcome) === 'restored') void requestSync();
      return outcome;
    },

    async retry(localId) {
      await operations.update(localId, (current) => (current ? retryReminderOperation(current) : current));
      await requestSync();
    },

    async discard(localId) {
      if (draining) await draining;
      let outcome: 'discarded' | 'not_discardable' = 'not_discardable';
      await operations.update(localId, (current) => {
        if (!current || !canDiscardReminderOperation(current)) return current;
        outcome = 'discarded';
        return null;
      });
      return outcome;
    },

    async resolveConflict(localId, { choice, shownRemote }) {
      if (draining) await draining;
      const current = await operations.read(localId);
      if (current?.status !== 'conflict' || current.kind !== 'update') return 'not_in_conflict';
      if (!canSend()) return 'unavailable';
      const epoch = sessionEpoch;
      const mark = cache.beginRead();
      const latest = await remote.fetch(localId);
      if (!latest.ok) {
        if (failure(latest).policy === 'wait_for_auth') authBlockedEpoch = epoch;
        return 'unavailable';
      }
      const row = latest.data;
      await cache.applyReminder(mark, localId, row);
      if (!row) {
        await operations.update(localId, (op) => (op?.status === 'conflict' && op.kind === 'update' ? toForbidden(op, 'not_visible', clock()) : op));
        return 'forbidden';
      }
      if (row.updated_at !== shownRemote.updated_at) {
        await operations.update(localId, (op) => (op?.status === 'conflict' && op.kind === 'update' ? { ...op, conflictRemote: row } : op));
        return 'conflict';
      }
      const resolved = await operations.update(localId, (op) =>
        op?.status === 'conflict' && op.kind === 'update' ? resolveReminderConflict(op, row, chooseReminderContent(op, row, choice)) : op
      );
      if (!resolved) return 'synced';
      await requestSync();
      if (draining) await draining;
      const after = await operations.read(localId);
      if (!after) return 'synced';
      return after.status === 'synced' ? 'synced' : after.status;
    },

    async resolveDeleteConflict(localId, { decision, shownRemote }) {
      const current = await operations.read(localId);
      if (current?.kind !== 'delete' || current.status !== 'conflict') return 'not_in_conflict';
      if (decision === 'keep') {
        const undone = await this.undoDelete(localId);
        return undone === 'restored' ? 'kept' : 'not_in_conflict';
      }
      if (draining) await draining;
      if (!canSend()) return 'unavailable';
      const epoch = sessionEpoch;
      const mark = cache.beginRead();
      const latest = await remote.fetch(shownRemote.id);
      if (!latest.ok) {
        if (failure(latest).policy === 'wait_for_auth') authBlockedEpoch = epoch;
        return 'unavailable';
      }
      const row = latest.data;
      if (!row) {
        await closeGoneDelete(localId, shownRemote.id);
        return 'gone';
      }
      await cache.applyReminder(mark, row.id, row);
      if (row.updated_at !== shownRemote.updated_at) {
        await operations.update(localId, (op) => (op?.kind === 'delete' && op.status === 'conflict' ? { ...op, conflictRemote: row } : op));
        return 'conflict';
      }
      await operations.update(localId, (op) => (op?.kind === 'delete' && op.status === 'conflict' ? resolveDeleteConflict(op, row) : op));
      await requestSync();
      if (draining) await draining;
      const after = await operations.read(localId);
      if (!after) return 'gone';
      if (after.kind !== 'delete') return 'not_in_conflict';
      return after.status === 'synced' ? 'synced' : after.status;
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
        await operations.update(op.localId, (current) => (current ? retryReminderOperation(current) : current));
      }
      let handle: unknown = null;
      const timedOut = new Promise<'timed_out'>((resolve) => {
        handle = setTimer(() => resolve('timed_out'), timeoutMs);
      });
      const finished = await Promise.race([requestSync().then(() => 'completed' as const), timedOut]);
      clearTimer(handle);
      return { status: finished };
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
