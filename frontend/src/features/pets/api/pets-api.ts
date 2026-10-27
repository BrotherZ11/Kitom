import { PET_COLUMNS } from '@/features/pets/api/pets-remote';
import { PetError, toPetError } from '@/features/pets/pet-errors';
import type { Pet, PetFields } from '@/features/pets/types';
import { supabase } from '@/lib/supabase';

/**
 * Escrituras en `pets` (y el permiso de edición). RLS es la autoridad. Las lecturas de la lista y la
 * ficha están en `pets-remote.ts` (con el token del dueño del almacén local, para la copia sin
 * conexión).
 */

/**
 * Copia solo las columnas editables. Aunque llegue un objeto con más propiedades (p. ej. `owner_id`
 * o `id`), nunca se envían a Supabase.
 */
function pickEditableFields(fields: PetFields): PetFields {
  return {
    name: fields.name,
    species_id: fields.species_id,
    sex: fields.sex,
    breed: fields.breed,
    breed_id: fields.breed_id,
    breed_status: fields.breed_status,
    birth_date: fields.birth_date,
    weight_kg: fields.weight_kg,
    sterilized: fields.sterilized,
    known_conditions: fields.known_conditions,
    allergies: fields.allergies,
    temperament_notes: fields.temperament_notes,
  };
}

/** Crea una mascota cuyo propietario es el usuario de la sesión (`pets: insert own`). */
export async function createPet(ownerId: string, fields: PetFields): Promise<Pet> {
  const { data, error } = await supabase
    .from('pets')
    .insert({ ...pickEditableFields(fields), owner_id: ownerId })
    .select(PET_COLUMNS)
    .single();
  if (error) throw toPetError(error);
  return data;
}

/** Solo columnas editables; `owner_id` no tiene GRANT de UPDATE y nunca se envía. */
export async function updatePet(petId: string, fields: PetFields): Promise<Pet> {
  const { data, error } = await supabase
    .from('pets')
    .update(pickEditableFields(fields))
    .eq('id', petId)
    .select(PET_COLUMNS)
    .maybeSingle();
  if (error) throw toPetError(error);
  // RLS (`can_edit_pet`) filtra la fila: sin error pero sin fila = sin permiso de edición.
  if (!data) throw new PetError('not_allowed');
  return data;
}

/** UX: indica si mostrar acciones de edición. La autorización real sigue siendo RLS. */
export async function fetchCanEditPet(petId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('can_edit_pet', { target_pet_id: petId });
  if (error) throw toPetError(error);
  return data;
}
