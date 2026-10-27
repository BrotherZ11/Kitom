import type { Pet } from '@/features/pets/types';

import type { PetPhotoRemote } from './api/pet-photos-remote.ts';
import type { PetPhotoJournal, PetPhotoJournalEntry, PetPhotoJournalReason } from './offline/pet-photo-journal.ts';
import { PET_PHOTO_EXTENSION } from './pet-photo.ts';

/**
 * Ciclo de vida de la foto de una mascota (fase 10). Módulo puro: Storage, base de datos, diario local,
 * reloj e ids se inyectan (se prueba con `npm test`). Reglas:
 *
 * - `photo_path` (la referencia) se cambia con precondición sobre su valor actual
 *   (`setPhotoPath(next, expected)`): una respuesta tardía o un reintento nunca vuelve a poner una foto
 *   que otro dispositivo ya cambió o quitó.
 * - Un objeto solo se borra cuando se sabe que nadie lo referencia: el cambio de `photo_path` se aplicó
 *   (la foto anterior) o el servidor respondió que no se aplicó (la foto nueva). Si no se sabe (sin
 *   respuesta, la app se cerró), el objeto se conserva y queda anotado en el diario
 *   (`offline/pet-photo-journal.ts`); `processPhotoJournal` lo resuelve más tarde leyendo `photo_path`.
 * - Antes de subir se anota el objeto: si la app se cierra entre subirlo y referenciarlo, el diario lo
 *   recuerda. Solo se tocan rutas exactas de esta operación y de esta mascota (nunca un barrido).
 *
 * Errores (`PhotoOpError.code`): `upload_failed`, `update_failed`, `remove_failed` (con la causa para
 * traducirla), `photo_changed` (otro dispositivo cambió la foto antes) y `unconfirmed` (no se sabe si el
 * cambio se aplicó: se comprobará).
 */

export type PhotoOpErrorCode = 'upload_failed' | 'update_failed' | 'remove_failed' | 'photo_changed' | 'not_allowed' | 'unconfirmed' | 'local_failed';

export class PhotoOpError extends Error {
  readonly code: PhotoOpErrorCode;

  constructor(code: PhotoOpErrorCode, cause?: unknown) {
    super(code, { cause });
    this.name = 'PhotoOpError';
    this.code = code;
  }
}

export type PhotoOpsDeps = {
  remote: PetPhotoRemote;
  journal: PetPhotoJournal;
  now: () => number;
  /** UUID v4 del objeto nuevo (`createOperationId`). */
  createId: () => string;
  /** Objetos con una operación en curso en este proceso: el diario no los toca mientras tanto. */
  active: Set<string>;
};

const entry = (deps: PhotoOpsDeps, petId: string, path: string, reason: PetPhotoJournalReason): PetPhotoJournalEntry => ({
  userId: deps.journal.userId,
  petId,
  path,
  reason,
  status: 'pending',
  createdAt: deps.now(),
  checkedAt: null,
  blockedReason: null,
});

/** Borra un objeto ya sin referencias y su entrada; si no se puede, la entrada queda para más tarde. */
async function dropObject(deps: PhotoOpsDeps, petId: string, path: string): Promise<void> {
  const removed = await deps.remote.remove(path);
  if (removed.ok && removed.data > 0) await deps.journal.remove(petId, path).catch(() => undefined);
}

/** Solo se borran objetos de la carpeta de la propia mascota. */
const isOwnPhoto = (petId: string, path: string | null): path is string => path !== null && path.startsWith(`${petId}/`);

/**
 * Sube una foto y la pone como la de la mascota en lugar de `previousPath` (la que se veía). Devuelve la
 * mascota con su `photo_path` nuevo. La foto anterior solo se borra después de que el servidor confirme
 * el cambio.
 */
export async function replacePetPhoto(
  deps: PhotoOpsDeps,
  input: { petId: string; previousPath: string | null; bytes: ArrayBuffer; contentType: string }
): Promise<Pet> {
  const { petId, previousPath } = input;
  const path = `${petId}/${deps.createId()}.${PET_PHOTO_EXTENSION}`;
  deps.active.add(path);
  try {
    try {
      await deps.journal.put(entry(deps, petId, path, 'uploaded'));
    } catch (error) {
      // Sin poder anotarlo, no se sube nada (un objeto así podría quedar sin rastro).
      throw new PhotoOpError('local_failed', error);
    }

    const uploaded = await deps.remote.upload(path, input.bytes, input.contentType);
    if (!uploaded.ok) {
      // Con respuesta, no se creó nada; sin ella, puede existir: el diario lo comprobará.
      if (uploaded.status !== null) await deps.journal.remove(petId, path).catch(() => undefined);
      throw new PhotoOpError('upload_failed', uploaded.error);
    }

    // La anterior se anota antes de cambiar la referencia: si no llega la respuesta, el diario la borra
    // solo si `photo_path` ya no es ella (y la cierra sin tocarla si el cambio no se aplicó).
    const retiring = isOwnPhoto(petId, previousPath) && previousPath !== path ? previousPath : null;
    if (retiring) await deps.journal.put(entry(deps, petId, retiring, 'replaced')).catch(() => undefined);
    const keepPrevious = () => (retiring ? deps.journal.remove(petId, retiring).catch(() => undefined) : undefined);

    const referenced = await deps.remote.setPhotoPath(petId, path, previousPath);
    if (!referenced.ok) {
      // Sin respuesta no se sabe si `photo_path` ya es la nueva: no se borra nada (el diario decide).
      if (referenced.status === null) throw new PhotoOpError('unconfirmed', referenced.error);
      await keepPrevious();
      await dropObject(deps, petId, path);
      throw new PhotoOpError('update_failed', referenced.error);
    }
    if (referenced.data === null) {
      // 0 filas: no se aplicó. La foto nueva no la referencia nadie; la anterior no la retira este
      // dispositivo (si otro la cambió, es cosa suya). Se dice por qué.
      const current = await deps.remote.fetchPhotoPath(petId);
      if (!current.ok) throw new PhotoOpError('unconfirmed', current.error);
      await keepPrevious();
      await dropObject(deps, petId, path);
      if (current.data === null || current.data.photo_path === previousPath) throw new PhotoOpError('not_allowed');
      throw new PhotoOpError('photo_changed');
    }

    // Referenciada: la nueva ya no es pendiente; la anterior ya no la usa nadie y se borra.
    await deps.journal.remove(petId, path).catch(() => undefined);
    if (retiring) await dropObject(deps, petId, retiring);
    return referenced.data;
  } finally {
    deps.active.delete(path);
  }
}

/**
 * Quita la foto (`photoPath`, la que se veía): primero la referencia, con precondición, y después el
 * objeto. Si el servidor no confirma que la quitó, el objeto se conserva.
 */
export async function removePetPhotoSafely(deps: PhotoOpsDeps, input: { petId: string; photoPath: string }): Promise<Pet> {
  const { petId, photoPath } = input;
  const own = isOwnPhoto(petId, photoPath);
  if (own) {
    deps.active.add(photoPath);
    try {
      await deps.journal.put(entry(deps, petId, photoPath, 'removed'));
    } catch (error) {
      deps.active.delete(photoPath);
      throw new PhotoOpError('local_failed', error);
    }
  }
  try {
    const cleared = await deps.remote.setPhotoPath(petId, null, photoPath);
    if (!cleared.ok) {
      if (cleared.status === null) throw new PhotoOpError('unconfirmed', cleared.error);
      // No se aplicó: la foto sigue referenciada y no se toca.
      if (own) await deps.journal.remove(petId, photoPath).catch(() => undefined);
      throw new PhotoOpError('remove_failed', cleared.error);
    }
    if (cleared.data === null) {
      const current = await deps.remote.fetchPhotoPath(petId);
      if (!current.ok) throw new PhotoOpError('unconfirmed', current.error);
      if (current.data !== null && current.data.photo_path === photoPath) {
        // Sigue siendo la foto: lo filtró RLS. No se borra.
        if (own) await deps.journal.remove(petId, photoPath).catch(() => undefined);
        throw new PhotoOpError('not_allowed');
      }
      // Otro dispositivo la cambió o la quitó: este objeto ya no lo referencia nadie.
      if (own && current.data !== null) await dropObject(deps, petId, photoPath);
      throw new PhotoOpError(current.data === null ? 'not_allowed' : 'photo_changed');
    }
    if (own) await dropObject(deps, petId, photoPath);
    return cleared.data;
  } finally {
    if (own) deps.active.delete(photoPath);
  }
}

/** Entradas que se dejan reposar antes de comprobarlas (un envío de otro proceso podría estar terminando). */
export const PHOTO_JOURNAL_MIN_AGE_MS = 60_000;

export type PhotoJournalPass = { resolved: number; blocked: number; kept: number; stopped: boolean };

/**
 * Resuelve el diario: por cada objeto pendiente (fuera de una operación en curso y con un mínimo de
 * antigüedad), lee `photo_path` de su mascota:
 * - es él → está en uso: la entrada se cierra sin borrar nada;
 * - no es él → se borra el objeto (o ya no estaba); si Storage no borra nada y no hay permiso, `blocked`;
 * - la mascota no se ve (eliminada o sin acceso) → `blocked`: la app ya no puede borrarlo.
 * Sin conexión (o con la sesión de otra cuenta, `canRun`) se para sin cambiar nada.
 */
export async function processPhotoJournal(
  deps: PhotoOpsDeps & { canRun: () => boolean; minAgeMs?: number }
): Promise<PhotoJournalPass> {
  const pass: PhotoJournalPass = { resolved: 0, blocked: 0, kept: 0, stopped: false };
  const minAge = deps.minAgeMs ?? PHOTO_JOURNAL_MIN_AGE_MS;
  const block = (item: PetPhotoJournalEntry, reason: string) =>
    deps.journal.put({ ...item, status: 'blocked', blockedReason: reason, checkedAt: deps.now() });

  for (const item of await deps.journal.list()) {
    if (item.status !== 'pending' || deps.active.has(item.path) || deps.now() - item.createdAt < minAge) {
      pass.kept += 1;
      continue;
    }
    if (!deps.canRun()) {
      pass.stopped = true;
      return pass;
    }
    const current = await deps.remote.fetchPhotoPath(item.petId);
    if (!current.ok) {
      pass.stopped = current.status === null;
      if (pass.stopped) return pass;
      pass.kept += 1;
      continue;
    }
    if (current.data === null) {
      await block(item, 'pet_unavailable');
      pass.blocked += 1;
      continue;
    }
    if (current.data.photo_path === item.path) {
      await deps.journal.remove(item.petId, item.path);
      pass.resolved += 1;
      continue;
    }
    const removed = await deps.remote.remove(item.path);
    if (!removed.ok) {
      pass.stopped = removed.status === null;
      if (pass.stopped) return pass;
      pass.kept += 1;
      continue;
    }
    if (removed.data > 0) {
      await deps.journal.remove(item.petId, item.path);
      pass.resolved += 1;
      continue;
    }
    // 0 borrados: o ya no existía, o las políticas lo filtraron. Se pregunta el permiso.
    const editable = await deps.remote.canEdit(item.petId);
    if (!editable.ok) {
      pass.kept += 1;
      continue;
    }
    if (editable.data) {
      await deps.journal.remove(item.petId, item.path);
      pass.resolved += 1;
    } else {
      await block(item, 'not_allowed');
      pass.blocked += 1;
    }
  }
  return pass;
}
