import { t } from '@/i18n';

/** Errores de datos de mascotas que entiende la UI. Nunca se muestra el error crudo de Supabase. */
export type PetErrorCode =
  | 'network'
  | 'not_found'
  | 'not_allowed'
  | 'invalid_species'
  | 'invalid_breed'
  | 'invalid_weight'
  | 'birth_date_future'
  | 'invalid_value'
  // Fotos (`pet-photo-picker.ts`, `api/pet-photos-api.ts`).
  | 'camera_permission'
  | 'gallery_permission'
  | 'camera_unavailable'
  | 'invalid_image_type'
  | 'image_too_large'
  | 'image_processing_failed'
  | 'photo_upload_failed'
  | 'photo_update_failed'
  | 'photo_delete_failed'
  | 'photo_url_failed'
  | 'photo_storage'
  | 'unknown';

export class PetError extends Error {
  readonly code: PetErrorCode;

  constructor(code: PetErrorCode, cause?: unknown) {
    super(code, { cause });
    this.name = 'PetError';
    this.code = code;
  }
}

/** Permiso de cámara o galería denegado. `canAskAgain = false`: solo se puede activar en Ajustes. */
export class PetPhotoPermissionError extends PetError {
  readonly canAskAgain: boolean;

  constructor(code: 'camera_permission' | 'gallery_permission', canAskAgain: boolean) {
    super(code);
    this.name = 'PetPhotoPermissionError';
    this.canAskAgain = canAskAgain;
  }
}

type PostgrestLikeError = { code?: string; message?: string };

function isNetworkFailure(message: string): boolean {
  return /network request failed|failed to fetch|fetch failed/i.test(message);
}

/** Traduce un error de PostgREST/Postgres a un código de UI. */
export function toPetError(error: unknown): PetError {
  if (error instanceof PetError) return error;
  if (__DEV__) console.warn('[pets]', error);

  if (error instanceof TypeError) return new PetError('network', error);

  const { code = '', message = '' } = (error ?? {}) as PostgrestLikeError;
  if (isNetworkFailure(message)) return new PetError('network', error);

  switch (code) {
    case '42501': // RLS o GRANT por columna
      return new PetError('not_allowed', error);
    case 'PGRST116': // .single() sin filas
      return new PetError('not_found', error);
    // Postgres incluye el nombre de la constraint en el mensaje; distingue raza, especie y peso.
    case '23503':
      // pets_breed_species_fkey: raza de otra especie o inexistente; pets_species_id_fkey: especie.
      if (message.includes('pets_breed_species_fkey')) return new PetError('invalid_breed', error);
      return new PetError('invalid_species', error);
    case '23514':
      if (message.includes('pets_breed_status_check')) return new PetError('invalid_breed', error);
      if (message.includes('pets_weight_kg_check')) return new PetError('invalid_weight', error);
      return new PetError('invalid_value', error);
    case '22P02':
    case '22007':
    case '22008':
    case '22003':
      return new PetError('invalid_value', error);
    case 'P0001':
      // Excepciones de triggers: validate_pet_birth_date.
      if (/fecha de nacimiento/i.test(message)) return new PetError('birth_date_future', error);
      return new PetError('not_allowed', error);
  }

  return new PetError('unknown', error);
}

type StorageLikeError = { status?: number; statusCode?: string; message?: string };

/**
 * Traduce un error de Storage (`StorageApiError`) a un código de UI. `fallback` es el código de la
 * operación que falló (subir, borrar o firmar) cuando el error no es más específico.
 */
export function toPetPhotoError(error: unknown, fallback: PetErrorCode): PetError {
  if (error instanceof PetError) return error;
  if (__DEV__) console.warn('[pets] photo', error);

  if (error instanceof TypeError) return new PetError('network', error);

  const { status, statusCode, message = '' } = (error ?? {}) as StorageLikeError;
  if (isNetworkFailure(message)) return new PetError('network', error);

  const httpStatus = Number(status ?? statusCode);
  if (httpStatus === 401 || httpStatus === 403 || /row-level security|unauthorized/i.test(message)) {
    return new PetError('not_allowed', error);
  }
  if (httpStatus === 413 || /maximum allowed size|too large/i.test(message)) {
    return new PetError('image_too_large', error);
  }
  if (httpStatus === 415 || /mime type/i.test(message)) {
    return new PetError('invalid_image_type', error);
  }
  if (httpStatus >= 500) return new PetError('photo_storage', error);

  return new PetError(fallback, error);
}

export function petErrorMessage(error: unknown): string {
  return t(`pets.errors.${toPetError(error).code}`);
}
