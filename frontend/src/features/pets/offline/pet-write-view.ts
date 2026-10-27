import type { Pet } from '@/features/pets/types';

import {
  deleteOperationFor,
  isLocalPetId,
  petDeleteDisplay,
  petSyncDisplay,
  petWithLocalContent,
  type LocalPetOperation,
  type PetDeleteDisplay,
  type PetSyncDisplay,
} from './pet-operation.ts';
import type { PetDetailView, PetListView } from './pet-view.ts';

/**
 * Lista y ficha con las altas y ediciones del dispositivo encima (fase 8). Módulo puro (`npm test`).
 *
 * - Una edición pendiente (o fallida, en conflicto o sin permiso) se ve con el contenido local: es lo
 *   que el usuario guardó. Su estado dice que aún no está en el servidor.
 * - Un alta sin confirmar es un borrador (`drafts`, con su id local): nunca se mezcla con las mascotas
 *   del servidor ni pasa a ser la mascota activa (las pestañas usan registros diarios, que necesitan el
 *   id del servidor).
 * - Un alta confirmada es solo un mapeo: su id local lleva a la mascota del servidor (`redirect`).
 * - Una mascota con una eliminación guardada (pendiente, en conflicto… o ya confirmada) no está en la
 *   lista ni puede ser la activa, aunque el servidor (o una respuesta antigua) la siga devolviendo: va
 *   aparte (`pendingDeletions`) hasta que se confirma o se deshace (fase 10).
 */

type OperationsQuery = {
  status: 'pending' | 'success' | 'error';
  data: LocalPetOperation[] | undefined;
  error: unknown;
  /** Se está volviendo a leer (p. ej. justo después de guardar un alta). */
  fetchStatus?: 'fetching' | 'paused' | 'idle';
};

export type PetWithSync = { pet: Pet; op: LocalPetOperation | null; display: PetSyncDisplay | null };

const pendingUpdate = (ops: readonly LocalPetOperation[] | undefined, petId: string) =>
  ops?.find((op) => op.kind === 'update' && op.localId === petId) ?? null;

/** Ids (del servidor o locales) de las mascotas con una eliminación guardada, de cualquier estado. */
export function deletedPetIds(ops: readonly LocalPetOperation[] | undefined): Set<string> {
  const ids = new Set<string>();
  for (const op of ops ?? []) {
    if (op.kind !== 'delete') continue;
    ids.add(op.localId);
    if (op.petId) ids.add(op.petId);
  }
  return ids;
}

/** Sin las mascotas que se están eliminando (o ya eliminadas) en este dispositivo. */
export function withoutDeleted(pets: readonly Pet[], ops: readonly LocalPetOperation[] | undefined): Pet[] {
  const deleted = deletedPetIds(ops);
  return pets.filter((pet) => !deleted.has(pet.id));
}

/** Mascotas del servidor (o de la copia) con su edición local encima (sin las que se eliminan). */
export function withLocalEdits(pets: readonly Pet[], ops: readonly LocalPetOperation[] | undefined, syncingKey: string | null): PetWithSync[] {
  return withoutDeleted(pets, ops).map((pet) => {
    const op = pendingUpdate(ops, pet.id);
    return { pet: op ? petWithLocalContent(op, pet) : pet, op, display: petSyncDisplay(op, syncingKey === pet.id) };
  });
}

/** Altas guardadas en el dispositivo y aún no confirmadas, de la más antigua a la más reciente. */
export function localDrafts(ops: readonly LocalPetOperation[] | undefined, syncingKey: string | null): PetWithSync[] {
  return (ops ?? [])
    .filter((op) => op.kind === 'create' && op.status !== 'synced')
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((op) => ({ pet: petWithLocalContent(op, null), op, display: petSyncDisplay(op, syncingKey === op.localId) }));
}

/**
 * Ediciones guardadas en el dispositivo de mascotas que ya no están en la lista (sin acceso, borradas o
 * aún sin la lista cargada): se muestran aparte para poder revisarlas, copiarlas o descartarlas. Nunca
 * se ocultan solo porque el servidor ya no devuelva la mascota.
 */
export function orphanedEdits(
  ops: readonly LocalPetOperation[] | undefined,
  visibleIds: ReadonlySet<string>,
  syncingKey: string | null
): PetWithSync[] {
  return (ops ?? [])
    .filter((op) => op.kind === 'update' && !visibleIds.has(op.localId))
    .sort((a, b) => a.editedAt - b.editedAt)
    .map((op) => ({ pet: petWithLocalContent(op, op.baseRow), op, display: petSyncDisplay(op, syncingKey === op.localId) }));
}

export type PetDeletion = { pet: Pet; op: LocalPetOperation; display: PetDeleteDisplay };

/**
 * Eliminaciones guardadas en el dispositivo aún sin confirmar (pendientes, inciertas, en conflicto,
 * fallidas o sin permiso), de la más antigua a la más reciente. Se ven con lo que se deshace al
 * cancelarlas. Las confirmadas (lápidas) no.
 */
export function pendingDeletions(ops: readonly LocalPetOperation[] | undefined, syncingKey: string | null): PetDeletion[] {
  return (ops ?? [])
    .filter((op) => op.kind === 'delete' && op.status !== 'synced')
    .sort((a, b) => a.editedAt - b.editedAt)
    .map((op) => ({ pet: petWithLocalContent(op, op.baseRow), op, display: petDeleteDisplay(op, syncingKey === op.localId)! }));
}

/** Un cambio de mascota guardado solo en el dispositivo, para la pantalla global de cambios sin sincronizar. */
export type UnsyncedPetItem = {
  key: string;
  /** Ruta de la mascota (id local o del servidor) donde se ve y se decide. */
  routeId: string;
  name: string;
  kind: LocalPetOperation['kind'];
  sync: PetSyncDisplay | null;
  deletion: PetDeleteDisplay | null;
};

/** Altas, ediciones y eliminaciones sin confirmar (nunca las confirmadas), de la más antigua a la más reciente. */
export function unsyncedPetItems(ops: readonly LocalPetOperation[] | undefined, syncingKey: string | null): UnsyncedPetItem[] {
  return (ops ?? [])
    .filter((op) => op.status !== 'synced')
    .sort((a, b) => a.editedAt - b.editedAt)
    .map((op) => ({
      key: op.localId,
      routeId: op.localId,
      name: op.content.name,
      kind: op.kind,
      sync: petSyncDisplay(op, syncingKey === op.localId),
      deletion: petDeleteDisplay(op, syncingKey === op.localId),
    }));
}

/** La lista con las ediciones locales encima (los borradores van aparte). */
export function listWithLocalEdits(view: PetListView, ops: readonly LocalPetOperation[] | undefined): PetListView {
  if (view.state !== 'ready') return view;
  return { ...view, pets: withLocalEdits(view.pets, ops, null).map((item) => item.pet) };
}

export type LocalPetDetailView =
  | { state: 'loading' }
  /** `op`: el alta o, si se pidió borrarla mientras estaba en vuelo, su eliminación. */
  | { state: 'ready'; pet: Pet; op: LocalPetOperation }
  /** Alta ya confirmada: ir a la mascota del servidor. */
  | { state: 'redirect'; petId: string }
  /** El borrador se descartó (o nunca existió en este dispositivo). */
  | { state: 'not_found' }
  | { state: 'local_error'; error: unknown };

/** Ficha de una mascota con id local (un alta de este dispositivo). */
export function resolveLocalPetDetail(localId: string, operations: OperationsQuery): LocalPetDetailView {
  if (operations.status === 'error') return { state: 'local_error', error: operations.error };
  if (operations.data === undefined) return { state: 'loading' };
  const op = operations.data.find((item) => item.localId === localId && (item.kind === 'create' || item.kind === 'delete'));
  // Recién guardada, la lectura anterior aún no la tiene: no se dice «no existe» mientras se relee.
  if (!op) return operations.fetchStatus === 'fetching' ? { state: 'loading' } : { state: 'not_found' };
  if (op.kind === 'delete') return { state: 'ready', pet: petWithLocalContent(op, op.baseRow), op };
  if (op.status === 'synced' && op.petId) return { state: 'redirect', petId: op.petId };
  return { state: 'ready', pet: petWithLocalContent(op, null), op };
}

/** La ficha del servidor (o de la copia) con su edición local encima. */
export function detailWithLocalEdit(view: PetDetailView, op: LocalPetOperation | null): PetDetailView {
  if (view.state !== 'ready' || !op || op.kind !== 'update') return view;
  return { ...view, pet: petWithLocalContent(op, view.pet) };
}

/**
 * ¿Se pueden llevar registros diarios de esta mascota? Solo con id del servidor: un alta sin confirmar
 * no tiene registros (no se envían con un id temporal; el motor de Daily Logs no cambia).
 */
export function canHaveDailyLogs(petId: string): boolean {
  return !isLocalPetId(petId);
}

/**
 * ¿Se pueden abrir sus registros diarios (nuevos o el historial)? No con un id local ni con una
 * eliminación guardada (fase 10). Los registros ya guardados de esa mascota no se tocan: siguen en
 * «Cambios sin sincronizar».
 */
export function dailyLogsAccess(petId: string, ops: readonly LocalPetOperation[] | undefined): 'allowed' | 'local_pet' | 'deleting' {
  if (!canHaveDailyLogs(petId)) return 'local_pet';
  return deleteOperationFor(ops, petId) ? 'deleting' : 'allowed';
}
