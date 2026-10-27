import type { SupabaseClient } from '@supabase/supabase-js';

import type { Pet } from '@/features/pets/types';
import type { Database } from '@/types/database.types';

import { toCachedPet } from '../offline/pet-snapshot.ts';
import { PET_PHOTOS_BUCKET } from '../pet-photo.ts';
import { PET_COLUMNS } from './pets-remote.ts';

/**
 * Acceso remoto de las fotos de mascota (fase 10). Módulo puro: el cliente se inyecta (las partes de
 * base de datos se prueban contra el Supabase local; el bucket no existe en local). Las políticas de
 * Storage y RLS son la autoridad (`can_edit_pet` para subir, cambiar `photo_path` y borrar).
 *
 * - `setPhotoPath` cambia `photo_path` con precondición sobre su valor actual (`expected`): una sola
 *   sentencia, así que una respuesta tardía nunca vuelve a poner una foto que otro ya cambió o quitó.
 *   0 filas (`data: null`) = no se aplicó (cambió, sin permiso o no existe): lo decide quien llama.
 * - Nunca lanza: devuelve el error y el `status` HTTP; sin respuesta (red), `status: null`. Con
 *   `status`, el servidor respondió y la operación no se aplicó; sin él, no se sabe.
 */

export type PhotoRemoteResult<T> = { ok: true; data: T } | { ok: false; error: unknown; status: number | null };

export type PetPhotoRemote = {
  upload(path: string, bytes: ArrayBuffer, contentType: string): Promise<PhotoRemoteResult<void>>;
  setPhotoPath(petId: string, next: string | null, expected: string | null): Promise<PhotoRemoteResult<Pet | null>>;
  /** `photo_path` actual (`data: null` = la mascota no existe o no se ve). */
  fetchPhotoPath(petId: string): Promise<PhotoRemoteResult<{ photo_path: string | null } | null>>;
  canEdit(petId: string): Promise<PhotoRemoteResult<boolean>>;
  /** Objetos borrados (0 = no existía o las políticas lo filtraron: Storage no los distingue). */
  remove(path: string): Promise<PhotoRemoteResult<number>>;
};

type ErrorLike = { status?: unknown; statusCode?: unknown };

/** Estado HTTP de un error de Storage (`StorageApiError` lo tiene; sin respuesta, `StorageUnknownError` no). */
function storageStatus(error: unknown): number | null {
  const { status } = (error ?? {}) as ErrorLike;
  return typeof status === 'number' && status >= 100 ? status : null;
}

async function settle<T>(request: () => PromiseLike<{ data: T | null; error: unknown; status?: number }>, toData: (data: T | null) => unknown) {
  try {
    const { data, error, status } = await request();
    if (error) {
      const http = typeof status === 'number' && status >= 100 ? status : storageStatus(error);
      return { ok: false as const, error, status: http };
    }
    return { ok: true as const, data: toData(data) };
  } catch (error) {
    return { ok: false as const, error, status: null };
  }
}

export function createPetPhotoRemote(client: SupabaseClient<Database>): PetPhotoRemote {
  const bucket = () => client.storage.from(PET_PHOTOS_BUCKET);
  return {
    upload: (path, bytes, contentType) =>
      settle(() => bucket().upload(path, bytes, { contentType, upsert: false }), () => undefined) as Promise<PhotoRemoteResult<void>>,

    setPhotoPath: async (petId, next, expected) => {
      const base = client.from('pets').update({ photo_path: next }).eq('id', petId);
      const conditioned = expected === null ? base.is('photo_path', null) : base.eq('photo_path', expected);
      const result = await settle(() => conditioned.select(PET_COLUMNS).maybeSingle(), (data) => (data === null ? null : toCachedPet(data)));
      if (result.ok && result.data === undefined) return { ok: false, error: { code: 'invalid_response' }, status: 200 };
      return result as PhotoRemoteResult<Pet | null>;
    },

    fetchPhotoPath: (petId) =>
      settle(
        () => client.from('pets').select('photo_path').eq('id', petId).maybeSingle(),
        (data) => data
      ) as Promise<PhotoRemoteResult<{ photo_path: string | null } | null>>,

    canEdit: (petId) =>
      settle(() => client.rpc('can_edit_pet', { target_pet_id: petId }), (data) => data === true) as Promise<PhotoRemoteResult<boolean>>,

    remove: (path) =>
      settle(() => bucket().remove([path]), (data) => (Array.isArray(data) ? data.length : 0)) as Promise<PhotoRemoteResult<number>>,
  };
}
