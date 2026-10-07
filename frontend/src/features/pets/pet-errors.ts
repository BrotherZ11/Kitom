import { t } from '@/i18n';

/** Errores de datos de mascotas que entiende la UI. Nunca se muestra el error crudo de Supabase. */
export type PetErrorCode =
  | 'network'
  | 'not_found'
  | 'not_allowed'
  | 'invalid_species'
  | 'invalid_weight'
  | 'birth_date_future'
  | 'invalid_value'
  | 'unknown';

export class PetError extends Error {
  readonly code: PetErrorCode;

  constructor(code: PetErrorCode, cause?: unknown) {
    super(code, { cause });
    this.name = 'PetError';
    this.code = code;
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
    case '23503': // species_id inexistente
      return new PetError('invalid_species', error);
    case '23514': // pets_weight_kg_check
      return new PetError('invalid_weight', error);
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

export function petErrorMessage(error: unknown): string {
  return t(`pets.errors.${toPetError(error).code}`);
}
