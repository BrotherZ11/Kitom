import { usePet } from '@/features/pets/hooks/use-pets';
import { useSpecies } from '@/features/pets/hooks/use-species';
import type { Species } from '@/features/pets/types';

export type PetSpecies = {
  /** `species.code`, o `null` si todavía no se sabe (cargando, o sin conexión y sin copia). */
  code: string | null;
  species: Species | null;
};

/**
 * Especie de una mascota, para pintar los campos que le corresponden. Sale de la ficha (servidor o
 * copia del dispositivo) y del catálogo de especies (también con copia local), así que funciona sin
 * conexión si se abrió antes.
 */
export function usePetSpecies(petId: string): PetSpecies {
  const pet = usePet(petId);
  const species = useSpecies();
  const speciesId = pet.view.state === 'ready' ? pet.view.pet.species_id : null;
  const found = speciesId ? (species.data?.find((item) => item.id === speciesId) ?? null) : null;
  return { code: found?.code ?? null, species: found };
}
