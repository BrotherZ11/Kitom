import { PetError, toPetError } from '@/features/pets/pet-errors';
import type { Pet, PetFields } from '@/features/pets/types';
import { supabase } from '@/lib/supabase';

/**
 * Acceso a `pets`. RLS es la autoridad: no se filtra por `owner_id`, así que las consultas devuelven
 * tanto las mascotas propias como las compartidas (`pet_co_owners` aceptado, `is_pet_member`).
 */

const PET_COLUMNS =
  'id, owner_id, name, species_id, sex, breed, breed_id, breed_status, birth_date, weight_kg, sterilized, known_conditions, allergies, temperament_notes, photo_path, is_active, created_at, updated_at';

const PET_PHOTOS_BUCKET = 'pet-photos';

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

export async function fetchPets(): Promise<Pet[]> {
  const { data, error } = await supabase
    .from('pets')
    .select(PET_COLUMNS)
    .order('created_at', { ascending: true });
  if (error) throw toPetError(error);
  return data;
}

/** `null` si no existe o el usuario no tiene acceso (RLS no distingue ambos casos). */
export async function fetchPet(petId: string): Promise<Pet | null> {
  const { data, error } = await supabase
    .from('pets')
    .select(PET_COLUMNS)
    .eq('id', petId)
    .maybeSingle();
  if (error) {
    // Un id con formato inválido (p. ej. una URL manipulada) equivale a "no existe".
    if (error.code === '22P02') return null;
    throw toPetError(error);
  }
  return data;
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

/**
 * Borra la mascota (solo el propietario, `pets: delete owner`). En cascada se borran sus registros
 * diarios, recordatorios, análisis, logros, rachas, co-tutores e informes.
 */
export async function deletePet(petId: string): Promise<void> {
  const { data, error } = await supabase.from('pets').delete().eq('id', petId).select('id');
  if (error) throw toPetError(error);
  if (data.length === 0) throw new PetError('not_allowed');
}

/** UX: indica si mostrar acciones de edición. La autorización real sigue siendo RLS. */
export async function fetchCanEditPet(petId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('can_edit_pet', { target_pet_id: petId });
  if (error) throw toPetError(error);
  return data;
}

/** URL firmada temporal de la foto (bucket privado); nunca se persiste. */
export async function fetchPetPhotoUrl(photoPath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(PET_PHOTOS_BUCKET)
    .createSignedUrl(photoPath, 60 * 60);
  if (error) throw toPetError(error);
  return data.signedUrl;
}
