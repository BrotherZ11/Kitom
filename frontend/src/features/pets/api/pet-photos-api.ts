import { updatePetPhotoPath } from '@/features/pets/api/pets-api';
import {
  PetError,
  toPetError,
  toPetPhotoError,
  type PetErrorCode,
} from '@/features/pets/pet-errors';
import {
  buildPetPhotoPath,
  isPetPhotoPathOf,
  PET_PHOTO_SIGNED_URL_TTL_SECONDS,
  PET_PHOTOS_BUCKET,
  type PreparedPetPhoto,
} from '@/features/pets/pet-photo';
import type { Pet } from '@/features/pets/types';
import { supabase } from '@/lib/supabase';

/**
 * Fotos de mascota en el bucket privado `pet-photos`. Las políticas de Storage son la autoridad:
 * subir y borrar exigen `can_edit_pet`, leer (firmar) exige `is_pet_member`, siempre sobre el
 * `pet_id` del primer segmento del path. El bucket no permite UPDATE: reemplazar = subir otro
 * objeto y borrar el anterior. En `pets.photo_path` se guarda el path, nunca una URL.
 */

/** URL firmada temporal para mostrar la foto; nunca se persiste. */
export async function fetchPetPhotoUrl(photoPath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(PET_PHOTOS_BUCKET)
    .createSignedUrl(photoPath, PET_PHOTO_SIGNED_URL_TTL_SECONDS);
  if (error) throw toPetPhotoError(error, 'photo_url_failed');
  return data.signedUrl;
}

/**
 * Sube una foto nueva y la asigna a la mascota. Orden pensado para no perder nunca la foto anterior:
 * 1. Subir el objeto nuevo (si falla, `photo_path` no cambia).
 * 2. Actualizar `pets.photo_path` (si falla, se intenta borrar el objeto recién subido).
 * 3. Borrar la foto anterior, ya sin referencias (si falla, queda huérfana; no afecta al usuario).
 */
export async function uploadPetPhoto(
  petId: string,
  photo: PreparedPetPhoto,
  previousPath: string | null,
): Promise<Pet> {
  const path = buildPetPhotoPath(petId);
  const { error: uploadError } = await supabase.storage
    .from(PET_PHOTOS_BUCKET)
    .upload(path, photo.bytes, { contentType: photo.mimeType, upsert: false });
  if (uploadError) throw toPetPhotoError(uploadError, 'photo_upload_failed');

  let pet: Pet;
  try {
    pet = await updatePetPhotoPath(petId, path);
  } catch (error) {
    await removeObjectQuietly(path);
    throw toPhotoReferenceError(error, 'photo_update_failed');
  }

  if (previousPath && previousPath !== path && isPetPhotoPathOf(petId, previousPath)) {
    await removeObjectQuietly(previousPath);
  }
  return pet;
}

/**
 * Quita la foto. Primero se limpia la referencia (RLS comprueba `can_edit_pet`) y después se borra
 * el objeto: así nunca queda `photo_path` apuntando a un archivo inexistente. Si el borrado del
 * objeto falla, queda huérfano (pendiente: limpieza en backend, ver `docs/FRONTEND_ARCHITECTURE.md`).
 */
export async function removePetPhoto(petId: string, photoPath: string): Promise<Pet> {
  let pet: Pet;
  try {
    pet = await updatePetPhotoPath(petId, null);
  } catch (error) {
    throw toPhotoReferenceError(error, 'photo_delete_failed');
  }

  if (isPetPhotoPathOf(petId, photoPath)) await removeObjectQuietly(photoPath);
  return pet;
}

/** Error al cambiar `photo_path`: conserva `not_allowed`/`network`; lo genérico, con el código de la operación. */
function toPhotoReferenceError(error: unknown, fallback: PetErrorCode): PetError {
  const petError = toPetError(error);
  return petError.code === 'unknown' ? new PetError(fallback, error) : petError;
}

/**
 * Limpieza best-effort de un objeto que ya no está referenciado. Storage no devuelve error si las
 * políticas filtran el objeto (0 borrados), así que se comprueba también el resultado.
 */
async function removeObjectQuietly(path: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.storage.from(PET_PHOTOS_BUCKET).remove([path]);
    const removed = !error && data.length > 0;
    if (!removed && __DEV__) console.warn('[pets] photo object not removed (orphan)', path, error);
    return removed;
  } catch (error) {
    if (__DEV__) console.warn('[pets] photo object not removed (orphan)', path, error);
    return false;
  }
}
