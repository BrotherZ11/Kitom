import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/features/auth/auth-context';
import { fetchPetPhotoUrl, removePetPhoto, uploadPetPhoto } from '@/features/pets/api/pet-photos-api';
import { PetError } from '@/features/pets/pet-errors';
import { PET_PHOTO_SIGNED_URL_TTL_SECONDS, type PreparedPetPhoto } from '@/features/pets/pet-photo';
import { petKeys } from '@/features/pets/query-keys';
import type { Pet } from '@/features/pets/types';

const SIGNED_URL_TTL_MS = PET_PHOTO_SIGNED_URL_TTL_SECONDS * 1000;
/** Se renueva 10 min antes de que caduque la URL firmada. */
const SIGNED_URL_REFRESH_MS = SIGNED_URL_TTL_MS - 10 * 60 * 1000;

/**
 * URL firmada de la foto. La clave es el path: cada foto nueva tiene un path distinto (uuid), así
 * que cambiarla o quitarla no reutiliza una URL anterior. Se firma una vez por path y se renueva
 * antes de caducar, no en cada render.
 */
export function usePetPhotoUrl(photoPath: string | null) {
  const { serverCall } = useAuth();
  return useQuery({
    queryKey: petKeys.photo(photoPath ?? ''),
    queryFn: () => serverCall(() => fetchPetPhotoUrl(photoPath ?? '')),
    enabled: photoPath !== null,
    staleTime: SIGNED_URL_REFRESH_MS,
    refetchInterval: SIGNED_URL_REFRESH_MS,
    // Una URL ya caducada no debe reutilizarse desde la caché.
    gcTime: SIGNED_URL_REFRESH_MS,
  });
}

/**
 * Tras cambiar `photo_path`: detalle actualizado con la fila devuelta y lista invalidada (al volver a
 * leerla, la copia sin conexión recibe el `photo_path` nuevo). Si otro dispositivo la cambió antes, o
 * no se sabe si se aplicó, se vuelve a leer la mascota para enseñar la foto actual.
 */
function useApplyPetPhotoChange() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? '';

  return {
    userId,
    applied: (pet: Pet, previousPath: string | null) => {
      queryClient.setQueryData(petKeys.detail(userId, pet.id), pet);
      if (previousPath) queryClient.removeQueries({ queryKey: petKeys.photo(previousPath) });
      return queryClient.invalidateQueries({ queryKey: petKeys.lists(userId) });
    },
    failed: (petId: string, error: unknown) => {
      const code = error instanceof PetError ? error.code : null;
      if (code !== 'photo_changed' && code !== 'photo_unconfirmed' && code !== 'not_allowed') return;
      void queryClient.invalidateQueries({ queryKey: petKeys.detail(userId, petId) });
      void queryClient.invalidateQueries({ queryKey: petKeys.lists(userId) });
    },
  };
}

export function useUploadPetPhoto(petId: string) {
  const change = useApplyPetPhotoChange();
  const { serverCall } = useAuth();

  return useMutation({
    mutationFn: ({ photo, previousPath }: { photo: PreparedPetPhoto; previousPath: string | null }) =>
      serverCall(() => uploadPetPhoto(change.userId, petId, photo, previousPath)),
    onSuccess: (pet, { previousPath }) => change.applied(pet, previousPath),
    onError: (error) => change.failed(petId, error),
  });
}

/** Primera foto de una mascota recién creada (el id se conoce al crearla, no al montar la pantalla). */
export function useUploadNewPetPhoto() {
  const change = useApplyPetPhotoChange();
  const { serverCall } = useAuth();

  return useMutation({
    mutationFn: ({ petId, photo }: { petId: string; photo: PreparedPetPhoto }) =>
      serverCall(() => uploadPetPhoto(change.userId, petId, photo, null)),
    onSuccess: (pet) => change.applied(pet, null),
    onError: (error, { petId }) => change.failed(petId, error),
  });
}

export function useRemovePetPhoto(petId: string) {
  const change = useApplyPetPhotoChange();
  const { serverCall } = useAuth();

  return useMutation({
    mutationFn: (photoPath: string) => serverCall(() => removePetPhoto(change.userId, petId, photoPath)),
    onSuccess: (pet, photoPath) => change.applied(pet, photoPath),
    onError: (error) => change.failed(petId, error),
  });
}
