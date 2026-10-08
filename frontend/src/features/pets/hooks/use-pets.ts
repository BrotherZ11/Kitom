import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/features/auth/auth-context';
import {
  createPet,
  deletePet,
  fetchCanEditPet,
  fetchPet,
  fetchPets,
  updatePet,
} from '@/features/pets/api/pets-api';
import { PetError } from '@/features/pets/pet-errors';
import { petKeys } from '@/features/pets/query-keys';
import type { PetFields } from '@/features/pets/types';

/** Mascotas visibles para el usuario (propias y compartidas), según RLS. */
export function usePets() {
  return useQuery({ queryKey: petKeys.lists(), queryFn: fetchPets });
}

/** `data === null` si la mascota no existe o el usuario no tiene acceso. */
export function usePet(petId: string) {
  return useQuery({ queryKey: petKeys.detail(petId), queryFn: () => fetchPet(petId) });
}

/** Solo para decidir qué acciones mostrar; RLS decide de verdad al escribir. */
export function useCanEditPet(petId: string) {
  return useQuery({ queryKey: petKeys.canEdit(petId), queryFn: () => fetchCanEditPet(petId) });
}

export function useCreatePet() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: (fields: PetFields) => {
      // El propietario siempre es el usuario de la sesión, nunca un valor del formulario.
      if (!user) throw new PetError('not_allowed');
      return createPet(user.id, fields);
    },
    onSuccess: (pet) => {
      queryClient.setQueryData(petKeys.detail(pet.id), pet);
      return queryClient.invalidateQueries({ queryKey: petKeys.lists() });
    },
  });
}

export function useUpdatePet(petId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (fields: PetFields) => updatePet(petId, fields),
    onSuccess: (pet) => {
      queryClient.setQueryData(petKeys.detail(pet.id), pet);
      return queryClient.invalidateQueries({ queryKey: petKeys.lists() });
    },
  });
}

export function useDeletePet(petId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => deletePet(petId),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: petKeys.detail(petId) });
      return queryClient.invalidateQueries({ queryKey: petKeys.lists() });
    },
  });
}
