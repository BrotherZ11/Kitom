import type { LocalStore } from '@/lib/local-store/local-store';

import { PET_OPERATIONS, type LocalPetOperation } from './pet-operation.ts';

/**
 * Operaciones de mascotas guardadas en el dispositivo de un usuario (`LocalStore`, colección
 * `pet-ops`). Módulo puro: el almacén se inyecta. Única puerta de escritura: `update`, que ejecuta las
 * escrituras de una en una (lectura → cambio → escritura sin que otra se cuele) y avisa a los
 * suscriptores, como el almacén de Daily Logs.
 *
 * Lo ilegible no se pierde ni se envía: una operación corrupta, de otra versión del formato o de otra
 * clave no se lista (nunca se envía), no se sobrescribe y se conserva tal cual. A diferencia de la copia
 * de mascotas, aquí hay cambios que solo existen en el dispositivo: no se sustituyen por nada.
 */

export type PetOperationChange = { localId: string; op: LocalPetOperation | null; previous: LocalPetOperation | null };

export class PetOperationRepositoryError extends Error {
  readonly code: 'local_read_failed' | 'unreadable';

  constructor(code: 'local_read_failed' | 'unreadable', cause?: unknown) {
    super(code, { cause });
    this.name = 'PetOperationRepositoryError';
    this.code = code;
  }
}

export type PetOperationRepository = {
  readonly userId: string;
  /** `null` si no hay (o es ilegible). Lanza `local_read_failed` si el almacenamiento falla. */
  read(localId: string): Promise<LocalPetOperation | null>;
  /** Operaciones legibles del usuario. Lanza `local_read_failed` si el almacenamiento falla. */
  list(): Promise<LocalPetOperation[]>;
  /** Operaciones guardadas que no se pueden leer (se conservan; no se envían). Lanza si el almacenamiento falla. */
  unreadableCount(): Promise<number>;
  /**
   * Cambia una operación de forma atómica respecto a las demás escrituras de esta instalación.
   * `change` recibe la actual y devuelve la nueva (`null` = borrar; la misma = no escribir).
   */
  update(
    localId: string,
    change: (current: LocalPetOperation | null) => LocalPetOperation | null
  ): Promise<LocalPetOperation | null>;
  subscribe(listener: (change: PetOperationChange) => void): () => void;
};

export function createPetOperationRepository(store: LocalStore): PetOperationRepository {
  const listeners = new Set<(change: PetOperationChange) => void>();
  let queue: Promise<unknown> = Promise.resolve();

  const exclusive = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  };

  const readEntry = async (localId: string) => {
    let result;
    try {
      result = await store.read(PET_OPERATIONS, [localId]);
    } catch (error) {
      throw new PetOperationRepositoryError('local_read_failed', error);
    }
    if (result.status === 'found') return { op: result.value, protected: false };
    return { op: null, protected: result.status !== 'missing' };
  };

  const ids = async () => {
    try {
      return await store.list(PET_OPERATIONS);
    } catch (error) {
      throw new PetOperationRepositoryError('local_read_failed', error);
    }
  };

  return {
    userId: store.userId,

    read: async (localId) => (await readEntry(localId)).op,

    async list() {
      const ops: LocalPetOperation[] = [];
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
        if (isProtected) throw new PetOperationRepositoryError('unreadable');
        if (next === null) {
          await store.remove(PET_OPERATIONS, [localId]);
        } else {
          await store.write(PET_OPERATIONS, [localId], next);
        }
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
