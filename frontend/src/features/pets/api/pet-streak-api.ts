import { toPetError } from '@/features/pets/pet-errors';
import type { Tables } from '@/types/database.types';
import { supabase } from '@/lib/supabase';

export type PetStreak = Pick<Tables<'pet_streaks'>, 'current_streak' | 'longest_streak' | 'last_log_date'>;

/**
 * Racha de una mascota (`pet_streaks`). Solo lectura: la calcula el servidor al guardar registros
 * (`recompute_pet_streak`) y RLS la deja ver a los miembros de la mascota. `null` si todavía no hay.
 */
export async function fetchPetStreak(petId: string): Promise<PetStreak | null> {
  const { data, error } = await supabase
    .from('pet_streaks')
    .select('current_streak, longest_streak, last_log_date')
    .eq('pet_id', petId)
    .maybeSingle();
  if (error) throw toPetError(error);
  return data;
}
