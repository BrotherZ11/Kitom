import { useMutation, useQuery } from '@tanstack/react-query';

import { useAuth } from '@/features/auth/auth-context';
import { localQueryOptions } from '@/features/daily-logs/offline/daily-log-cache';
import { isLocalPetId, type DeleteRejection, type LocalPetOperation } from '@/features/pets/offline/pet-operation';
import { petKeys } from '@/features/pets/query-keys';
import { usePetSync, usePetSyncingKey } from '@/features/pets/sync/pet-sync-provider';
import type { Pet, PetFields } from '@/features/pets/types';
import { useIsOnline } from '@/hooks/use-is-online';

/**
 * Altas, ediciones y eliminaciones de mascotas: siempre se guardan primero en el dispositivo y las envía
 * el motor (`offline/pet-sync-engine.ts`). Con conexión, la pantalla espera brevemente al servidor
 * (`SUBMIT_WAIT_MS`) para decir si ya quedó hecho allí; sin ella, queda pendiente.
 */

/** Cuánto espera el formulario a que el servidor confirme antes de decir «guardado en el dispositivo». */
export const SUBMIT_WAIT_MS = 5_000;

/** Operaciones del dispositivo del usuario (lectura local). */
export function usePetOperations() {
  const { userId, operations } = usePetSync();
  const query = useQuery({
    queryKey: petKeys.operations(userId),
    queryFn: () => operations.list(),
    ...localQueryOptions,
  });
  return { ...query, syncingKey: usePetSyncingKey() };
}

export type SaveOutcome = { op: LocalPetOperation | null; synced: boolean; petId: string | null };

/** Guarda un alta en el dispositivo; con conexión espera a la confirmación del servidor. */
export function useSaveNewPet() {
  const { engine, operations } = usePetSync();
  return async (content: PetFields, { waitForServer }: { waitForServer: boolean }): Promise<SaveOutcome> => {
    const saved = await engine.saveCreate(content);
    if (waitForServer) await engine.syncFor(SUBMIT_WAIT_MS);
    const op = await operations.read(saved.localId);
    return { op, synced: op?.status === 'synced', petId: op?.status === 'synced' ? op.petId : null };
  };
}

/**
 * Guarda una edición sobre `baseRow` (la versión del servidor que mostraba el formulario; en un alta sin
 * confirmar, `null`). `synced`: el servidor ya la tiene (o no había nada que cambiar).
 */
export function useSavePetEdit(localId: string) {
  const { engine, operations } = usePetSync();
  return async (content: PetFields, baseRow: Pet | null, { waitForServer }: { waitForServer: boolean }): Promise<SaveOutcome> => {
    const saved = await engine.saveEdit(localId, content, baseRow);
    if (!saved) return { op: null, synced: true, petId: baseRow?.id ?? null };
    if (waitForServer) await engine.syncFor(SUBMIT_WAIT_MS);
    const op = await operations.read(localId);
    const synced = op === null || op.status === 'synced';
    return { op, synced, petId: op?.petId ?? baseRow?.id ?? null };
  };
}

export function usePetSyncActions() {
  const { engine } = usePetSync();
  return {
    retry: (localId: string) => engine.retry(localId),
    discard: (localId: string) => engine.discard(localId),
    resolveConflict: (localId: string, input: { content: PetFields; shownRemote: Pet }) => engine.resolveConflict(localId, input),
    undoDelete: (localId: string) => engine.undoDelete(localId),
    resolveDeleteConflict: (localId: string, input: { decision: 'keep' | 'delete'; shownRemote: Pet }) =>
      engine.resolveDeleteConflict(localId, input),
  };
}

/**
 * Resultado de eliminar: `cancelled` (un alta que nunca llegó al servidor, quitada del dispositivo),
 * `deleted` (el servidor la borró, o ya no estaba), `pending` (guardada en el dispositivo: sin conexión,
 * sin confirmar, en conflicto, sin permiso o fallida; su estado lo dice) o `rejected`.
 */
export type DeletePetOutcome =
  | { status: 'cancelled' | 'deleted' | 'undone' }
  | { status: 'pending'; op: LocalPetOperation }
  | { status: 'rejected'; reason: DeleteRejection };

/**
 * Eliminar una mascota (fase 10): se guarda en el dispositivo y la envía el motor con la precondición de
 * la versión que ve el usuario (`baseRow`: servidor o copia; `null` en un alta de este dispositivo). Con
 * conexión espera brevemente a la confirmación. Hasta entonces se puede deshacer. Nunca borra fotos ni
 * registros diarios del dispositivo.
 */
export function useDeletePet(localId: string) {
  const { engine, operations } = usePetSync();
  const { canUseServer } = useAuth();
  const online = useIsOnline();
  return useMutation({
    mutationFn: async (baseRow: Pet | null): Promise<DeletePetOutcome> => {
      const outcome = await engine.requestDelete(localId, baseRow);
      if (outcome.result === 'cancelled') return { status: 'cancelled' };
      if (outcome.result === 'rejected') return { status: 'rejected', reason: outcome.reason };
      if (canUseServer && online) await engine.syncFor(SUBMIT_WAIT_MS);
      const op = await operations.read(outcome.op.localId);
      // Sin operación: un alta que resultó no existir (cancelada) o una mascota que ya no estaba.
      if (!op) return { status: isLocalPetId(localId) ? 'cancelled' : 'deleted' };
      // Se deshizo mientras se esperaba.
      if (op.kind !== 'delete') return { status: 'undone' };
      return op.status === 'synced' ? { status: 'deleted' } : { status: 'pending', op };
    },
  });
}
