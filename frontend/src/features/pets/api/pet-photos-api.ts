import { petPhotoOpsFor } from '@/features/pets/offline/device-pet-photo-ops';
import { PetError, toPetError, toPetPhotoError, type PetErrorCode } from '@/features/pets/pet-errors';
import { PET_PHOTO_SIGNED_URL_TTL_SECONDS, PET_PHOTOS_BUCKET, type PreparedPetPhoto } from '@/features/pets/pet-photo';
import { PhotoOpError, removePetPhotoSafely, replacePetPhoto } from '@/features/pets/pet-photo-ops';
import type { Pet } from '@/features/pets/types';
import { supabase } from '@/lib/supabase';

/**
 * Fotos de mascota en el bucket privado `pet-photos`. Las políticas de Storage son la autoridad:
 * subir y borrar exigen `can_edit_pet`, leer (firmar) exige `is_pet_member`, siempre sobre el
 * `pet_id` del primer segmento del path. El bucket no permite UPDATE: reemplazar = subir otro
 * objeto y borrar el anterior. En `pets.photo_path` se guarda el path, nunca una URL.
 *
 * Subir, reemplazar y quitar siguen las reglas de `pet-photo-ops.ts` (fase 10): `photo_path` con
 * precondición sobre su valor actual, ningún objeto se borra mientras pueda estar referenciado y lo que
 * no se puede cerrar en el momento queda en el diario del dispositivo del usuario.
 */

/** URL firmada temporal para mostrar la foto; nunca se persiste. */
export async function fetchPetPhotoUrl(photoPath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(PET_PHOTOS_BUCKET)
    .createSignedUrl(photoPath, PET_PHOTO_SIGNED_URL_TTL_SECONDS);
  if (error) throw toPetPhotoError(error, 'photo_url_failed');
  return data.signedUrl;
}

/** Error de una operación de foto como `PetError` (la UI lo traduce con `petErrorMessage`). */
function toPhotoError(error: unknown): PetError {
  if (!(error instanceof PhotoOpError)) return toPetError(error);
  switch (error.code) {
    case 'upload_failed':
      return toPetPhotoError(error.cause, 'photo_upload_failed');
    case 'update_failed':
      return toPhotoReferenceError(error.cause, 'photo_update_failed');
    case 'remove_failed':
      return toPhotoReferenceError(error.cause, 'photo_delete_failed');
    case 'photo_changed':
      return new PetError('photo_changed', error);
    case 'not_allowed':
      return new PetError('not_allowed', error);
    case 'unconfirmed':
      return new PetError('photo_unconfirmed', error);
    case 'local_failed':
      return new PetError('photo_local_failed', error);
  }
}

/**
 * Sube una foto nueva y la asigna a la mascota en lugar de `previousPath` (la que se veía). La anterior
 * solo se borra cuando el servidor confirma el cambio; si otro dispositivo cambió la foto antes,
 * `photo_changed` y no se toca nada suyo.
 */
export async function uploadPetPhoto(
  userId: string,
  petId: string,
  photo: PreparedPetPhoto,
  previousPath: string | null
): Promise<Pet> {
  try {
    return await replacePetPhoto(petPhotoOpsFor(userId), { petId, previousPath, bytes: photo.bytes, contentType: photo.mimeType });
  } catch (error) {
    throw toPhotoError(error);
  }
}

/** Quita la foto: primero la referencia (con precondición) y después el objeto. */
export async function removePetPhoto(userId: string, petId: string, photoPath: string): Promise<Pet> {
  try {
    return await removePetPhotoSafely(petPhotoOpsFor(userId), { petId, photoPath });
  } catch (error) {
    throw toPhotoError(error);
  }
}

/** Error al cambiar `photo_path`: conserva `not_allowed`/`network`; lo genérico, con el código de la operación. */
function toPhotoReferenceError(error: unknown, fallback: PetErrorCode): PetError {
  const petError = toPetError(error);
  return petError.code === 'unknown' ? new PetError(fallback, error) : petError;
}
