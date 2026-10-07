import type { Enums, Tables, TablesInsert } from '@/types/database.types';

export type Pet = Tables<'pets'>;
export type PetSex = Enums<'pet_sex'>;

export const PET_SEX_VALUES = ['male', 'female', 'unknown'] as const satisfies readonly PetSex[];

/**
 * Columnas que el formulario puede escribir. Coinciden con los GRANT de INSERT/UPDATE de
 * `authenticated` sobre `pets`, excepto:
 * - `owner_id`: solo INSERT, y lo pone la capa de datos a partir de la sesión (nunca el formulario);
 *   cambiarlo solo es posible con la RPC `transfer_pet_ownership`.
 * - `is_active`: solo el propietario puede cambiarlo (trigger); archivar no está implementado.
 * - `photo_path`: la subida a Storage no está implementada.
 * `id`, `created_at` y `updated_at` los gestiona la base de datos.
 */
export type PetEditableColumn =
  | 'name'
  | 'species_id'
  | 'sex'
  | 'breed'
  | 'birth_date'
  | 'weight_kg'
  | 'sterilized'
  | 'known_conditions'
  | 'allergies'
  | 'temperament_notes';

/** Valores completos de los campos editables (se envían todos en crear y en editar). */
export type PetFields = Required<Pick<TablesInsert<'pets'>, PetEditableColumn>>;

export type Species = {
  id: string;
  code: string;
  isActive: boolean;
  /** Nombre traducido (`catalog_translations`), o el `code` si no hay traducción. */
  name: string;
};
