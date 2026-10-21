import { useQuery } from '@tanstack/react-query';

import { localQueryOptions } from '@/features/daily-logs/offline/daily-log-cache';
import type { LocalPetOperation } from '@/features/pets/offline/pet-operation';
import { petKeys } from '@/features/pets/query-keys';
import { usePetSync, usePetSyncingKey } from '@/features/pets/sync/pet-sync-provider';
import type { Pet, PetFields } from '@/features/pets/types';

/**
 * Altas y ediciones de mascotas: siempre se guardan primero en el dispositivo y las envía el motor
 * (`offline/pet-sync-engine.ts`). Con conexión, el formulario espera brevemente al servidor
 * (`SUBMIT_WAIT_MS`) para decir si ya quedó guardado allí; sin ella, queda pendiente.
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
  };
}
