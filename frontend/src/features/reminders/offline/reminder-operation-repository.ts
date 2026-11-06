import type { LocalStore } from '@/lib/local-store/local-store';

import { REMINDER_OPERATIONS, type LocalReminderOperation } from './reminder-operation.ts';

/**
 * Operaciones de recordatorios guardadas en el dispositivo de un usuario (colección `reminder-ops`). Módulo
 * puro: el almacén se inyecta. Única puerta de escritura: `update` (de una en una, sin que otra se cuele).
 * Lo ilegible no se pierde ni se envía: no se lista, no se sobrescribe, se conserva y cuenta como no
 * sincronizado. Mismo contrato que `pet-operation-repository.ts`.
 */

export type ReminderOperationChange = { localId: string; op: LocalReminderOperation | null; previous: LocalReminderOperation | null };

export class ReminderOperationRepositoryError extends Error {
  readonly code: 'local_read_failed' | 'unreadable';

  constructor(code: 'local_read_failed' | 'unreadable', cause?: unknown) {
    super(code, { cause });
    this.name = 'ReminderOperationRepositoryError';
    this.code = code;
  }
}

export type ReminderOperationRepository = {
  readonly userId: string;
  read(localId: string): Promise<LocalReminderOperation | null>;
  list(): Promise<LocalReminderOperation[]>;
  unreadableCount(): Promise<number>;
  update(
    localId: string,
    change: (current: LocalReminderOperation | null) => LocalReminderOperation | null
  ): Promise<LocalReminderOperation | null>;
  subscribe(listener: (change: ReminderOperationChange) => void): () => void;
};

export function createReminderOperationRepository(store: LocalStore): ReminderOperationRepository {
  const listeners = new Set<(change: ReminderOperationChange) => void>();
  let queue: Promise<unknown> = Promise.resolve();

  const exclusive = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  };

  const readEntry = async (localId: string) => {
    let result;
    try {
      result = await store.read(REMINDER_OPERATIONS, [localId]);
    } catch (error) {
      throw new ReminderOperationRepositoryError('local_read_failed', error);
    }
    if (result.status === 'found') return { op: result.value, protected: false };
    return { op: null, protected: result.status !== 'missing' };
  };

  const ids = async () => {
    try {
      return await store.list(REMINDER_OPERATIONS);
    } catch (error) {
      throw new ReminderOperationRepositoryError('local_read_failed', error);
    }
  };

  return {
    userId: store.userId,

    read: async (localId) => (await readEntry(localId)).op,

    async list() {
      const ops: LocalReminderOperation[] = [];
      for (const [localId] of await ids()) {
        if (localId === undefined) continue;
        const { op } = await readEntry(localId);
        if (op && op.userId === store.userId) ops.push(op);
      }
      return ops;
    },

    async unreadableCount() {
      let count = 0;
      for (const [localId] of await ids()) {
        if (localId !== undefined && (await readEntry(localId)).protected) count += 1;
      }
      return count;
    },

    update(localId, change) {
      return exclusive(async () => {
        const { op: current, protected: isProtected } = await readEntry(localId);
        const next = change(current);
        if (next === current) return current;
        if (isProtected) throw new ReminderOperationRepositoryError('unreadable');
        if (next === null) await store.remove(REMINDER_OPERATIONS, [localId]);
        else await store.write(REMINDER_OPERATIONS, [localId], next);
        for (const listener of listeners) listener({ localId, op: next, previous: current });
        return next;
      });
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
