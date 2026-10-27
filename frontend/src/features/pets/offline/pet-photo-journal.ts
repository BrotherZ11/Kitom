import type { LocalCollection, LocalStore } from '@/lib/local-store/local-store';

import { isPetId } from './pet-snapshot.ts';

/**
 * Diario de fotos de mascota pendientes de comprobar (fase 10). Módulo puro (`npm test`).
 *
 * Una entrada por objeto de Storage que una operación de foto de este dispositivo creó o dejó de usar
 * y cuyo destino no se pudo cerrar en el momento (sin respuesta, la app se cerró, falló el borrado):
 * - `uploaded`: se subió (o se intentó) para la mascota y aún no se sabe si `photo_path` lo referencia.
 * - `replaced` / `removed`: era la foto de la mascota y se cambió o se quitó; falta borrar el objeto.
 *
 * Solo rutas exactas (`<petId>/<uuid>.jpg`) que generó o retiró una operación concreta: nunca se
 * barre la carpeta de la mascota (en el mismo bucket están las fotos de las consultas, con la misma forma
 * de ruta). Un objeto solo se borra cuando una lectura dice que `photo_path` no es él; si la mascota ya
 * no se ve (eliminada o sin acceso), la app no puede hacer nada y la entrada queda `blocked` (limpieza en
 * el servidor, pendiente). Clave: `kitom:v1:<userId>:pet-photo-journal:<uuid del objeto>`. Sin URLs.
 */

export type PetPhotoJournalReason = 'uploaded' | 'replaced' | 'removed';

export type PetPhotoJournalEntry = {
  userId: string;
  petId: string;
  path: string;
  reason: PetPhotoJournalReason;
  /** `blocked`: la app no puede resolverla (mascota no visible o sin permiso); no se reintenta sola. */
  status: 'pending' | 'blocked';
  createdAt: number;
  checkedAt: number | null;
  /** Motivo de `blocked` (`pet_unavailable`, `not_allowed`). */
  blockedReason: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REASONS: PetPhotoJournalReason[] = ['uploaded', 'replaced', 'removed'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isTime = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Id del objeto (`<uuid>` de `<petId>/<uuid>.jpg`) si la ruta es de esa mascota; si no, `null`. */
export function photoObjectId(petId: string, path: string): string | null {
  const [folder, file, ...rest] = path.split('/');
  if (rest.length > 0 || folder !== petId || !file?.endsWith('.jpg')) return null;
  const id = file.slice(0, -'.jpg'.length);
  return UUID.test(id) ? id : null;
}

export function parsePetPhotoJournalEntry(data: unknown): PetPhotoJournalEntry | null {
  if (!isRecord(data)) return null;
  const { userId, petId, path, reason, status } = data;
  if (!isPetId(userId) || !isPetId(petId) || typeof path !== 'string' || photoObjectId(petId, path) === null) return null;
  if (!REASONS.includes(reason as PetPhotoJournalReason) || (status !== 'pending' && status !== 'blocked')) return null;
  if (!isTime(data.createdAt) || (data.checkedAt !== null && !isTime(data.checkedAt))) return null;
  if (data.blockedReason !== null && typeof data.blockedReason !== 'string') return null;
  return {
    userId,
    petId,
    path,
    reason: reason as PetPhotoJournalReason,
    status,
    createdAt: data.createdAt as number,
    checkedAt: data.checkedAt as number | null,
    blockedReason: data.blockedReason as string | null,
  };
}

export const PET_PHOTO_JOURNAL: LocalCollection<PetPhotoJournalEntry> = {
  name: 'pet-photo-journal',
  version: 1,
  parse: parsePetPhotoJournalEntry,
  matchesKey: (value, key) =>
    key.id.length === 1 && value.userId === key.userId && photoObjectId(value.petId, value.path) === key.id[0],
};

export type PetPhotoJournal = {
  readonly userId: string;
  /** Guarda (o sustituye) la entrada de un objeto. Lanza si el almacenamiento falla. */
  put(entry: PetPhotoJournalEntry): Promise<void>;
  /** Quita la entrada de un objeto (ya resuelto). */
  remove(petId: string, path: string): Promise<void>;
  /** Entradas legibles del usuario (las ilegibles se conservan y no se usan). */
  list(): Promise<PetPhotoJournalEntry[]>;
};

export function createPetPhotoJournal(store: LocalStore): PetPhotoJournal {
  const keyOf = (petId: string, path: string) => {
    const id = photoObjectId(petId, path);
    if (!id) throw new Error('invalid_photo_path');
    return [id];
  };
  return {
    userId: store.userId,
    put: (entry) => store.write(PET_PHOTO_JOURNAL, keyOf(entry.petId, entry.path), entry),
    remove: (petId, path) => store.remove(PET_PHOTO_JOURNAL, keyOf(petId, path)),
    async list() {
      const entries: PetPhotoJournalEntry[] = [];
      for (const id of await store.list(PET_PHOTO_JOURNAL)) {
        const result = await store.read(PET_PHOTO_JOURNAL, id);
        if (result.status === 'found' && result.value.userId === store.userId) entries.push(result.value);
      }
      return entries;
    },
  };
}
