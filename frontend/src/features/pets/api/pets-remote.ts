import type { SupabaseClient } from '@supabase/supabase-js';

import type { OwnerAccessToken } from '@/features/auth/owner-session';
import type { Pet } from '@/features/pets/types';
import type { Database } from '@/types/database.types';

import { SessionUnavailableError } from '../../../lib/user-token-fetch.ts';

/**
 * Lecturas de `pets` para la lista y la ficha. Módulo puro: el cliente de Supabase y el token se
 * inyectan (se prueba contra el Supabase local). RLS es la autoridad: no se filtra por `owner_id`,
 * así que llegan las mascotas propias y las compartidas (`is_pet_member`).
 *
 * Cada lectura va autorizada como el **dueño del almacén local** donde se copiará la respuesta
 * (`accessToken`, `features/auth/owner-session.ts`): el token se pide justo antes de enviarla y se fija
 * en su cabecera. Si la sesión del cliente compartido ya es de otra cuenta (o no hay sesión), la
 * petición no sale (`SessionUnavailableError`, que la app trata como «sin conexión»): una respuesta
 * nunca es de una cuenta distinta a la del almacén en el que se guarda.
 *
 * Lanzan el error de supabase-js tal cual (la UI lo traduce con `toPetError`).
 */

export const PET_COLUMNS =
  'id, owner_id, name, species_id, sex, breed, breed_id, breed_status, birth_date, weight_kg, sterilized, known_conditions, allergies, temperament_notes, photo_path, is_active, created_at, updated_at';

export type PetReads = {
  /** Mascotas visibles, por `created_at`. */
  list(): Promise<Pet[]>;
  /** `null` si no existe o el usuario no tiene acceso (RLS no distingue ambos casos). */
  detail(petId: string): Promise<Pet | null>;
};

export function createPetReads(
  client: SupabaseClient<Database>,
  { accessToken }: { accessToken: () => Promise<OwnerAccessToken> }
): PetReads {
  const authorization = async (): Promise<string> => {
    const owner = await accessToken().catch((): OwnerAccessToken => ({ status: 'unavailable' }));
    if (owner.status !== 'ok') throw new SessionUnavailableError();
    return `Bearer ${owner.token}`;
  };

  return {
    async list() {
      const header = await authorization();
      const { data, error } = await client
        .from('pets')
        .select(PET_COLUMNS)
        .order('created_at', { ascending: true })
        .setHeader('Authorization', header);
      if (error) throw error;
      return data;
    },

    async detail(petId) {
      const header = await authorization();
      const { data, error } = await client
        .from('pets')
        .select(PET_COLUMNS)
        .eq('id', petId)
        .setHeader('Authorization', header)
        .maybeSingle();
      if (error) {
        // Un id con formato inválido (p. ej. una URL manipulada) equivale a "no existe".
        if (error.code === '22P02') return null;
        throw error;
      }
      return data;
    },
  };
}
