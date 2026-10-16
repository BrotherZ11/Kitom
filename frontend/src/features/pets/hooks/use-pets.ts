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

/**
 * Mascotas visibles para el usuario (propias y compartidas), según RLS. Todas las llamadas pasan por
 * `serverCall`: sin sesión utilizable (`offline`) fallan al momento como «sin conexión».
 */
export function usePets() {
  const { serverCall } = useAuth();
  return useQuery({ queryKey: petKeys.lists(), queryFn: () => serverCall(fetchPets) });
}

/** `data === null` si la mascota no existe o el usuario no tiene acceso. */
export function usePet(petId: string) {
  const { serverCall } = useAuth();
  return useQuery({ queryKey: petKeys.detail(petId), queryFn: () => serverCall(() => fetchPet(petId)) });
}

/** Solo para decidir qué acciones mostrar; RLS decide de verdad al escribir. */
export function useCanEditPet(petId: string) {
  const { serverCall } = useAuth();
  return useQuery({ queryKey: petKeys.canEdit(petId), queryFn: () => serverCall(() => fetchCanEditPet(petId)) });
}

export function useCreatePet() {
  const queryClient = useQueryClient();
  const { user, serverCall } = useAuth();

  return useMutation({
    mutationFn: (fields: PetFields) => {
      // El propietario siempre es el usuario de la sesión, nunca un valor del formulario.
      if (!user) throw new PetError('not_allowed');
      return serverCall(() => createPet(user.id, fields));
    },
    onSuccess: (pet) => {
      queryClient.setQueryData(petKeys.detail(pet.id), pet);
      return queryClient.invalidateQueries({ queryKey: petKeys.lists() });
    },
  });
}

export function useUpdatePet(petId: string) {
  const queryClient = useQueryClient();
  const { serverCall } = useAuth();

  return useMutation({
    mutationFn: (fields: PetFields) => serverCall(() => updatePet(petId, fields)),
    onSuccess: (pet) => {
      queryClient.setQueryData(petKeys.detail(pet.id), pet);
      return queryClient.invalidateQueries({ queryKey: petKeys.lists() });
    },
  });
}

export function useDeletePet(petId: string) {
  const queryClient = useQueryClient();
  const { serverCall } = useAuth();

  return useMutation({
    mutationFn: () => serverCall(() => deletePet(petId)),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: petKeys.detail(petId) });
      return queryClient.invalidateQueries({ queryKey: petKeys.lists() });
    },
  });
}
