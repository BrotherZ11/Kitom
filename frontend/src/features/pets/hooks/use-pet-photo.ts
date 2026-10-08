import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { fetchPetPhotoUrl, removePetPhoto, uploadPetPhoto } from '@/features/pets/api/pet-photos-api';
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
  return useQuery({
    queryKey: petKeys.photo(photoPath ?? ''),
    queryFn: () => fetchPetPhotoUrl(photoPath ?? ''),
    enabled: photoPath !== null,
    staleTime: SIGNED_URL_REFRESH_MS,
    refetchInterval: SIGNED_URL_REFRESH_MS,
    // Una URL ya caducada no debe reutilizarse desde la caché.
    gcTime: SIGNED_URL_REFRESH_MS,
  });
}

/** Tras cambiar `photo_path`: detalle actualizado con la fila devuelta y lista invalidada. */
function useApplyPetPhotoChange() {
  const queryClient = useQueryClient();

  return (pet: Pet, previousPath: string | null) => {
    queryClient.setQueryData(petKeys.detail(pet.id), pet);
    if (previousPath) queryClient.removeQueries({ queryKey: petKeys.photo(previousPath) });
    return queryClient.invalidateQueries({ queryKey: petKeys.lists() });
  };
}

export function useUploadPetPhoto(petId: string) {
  const applyChange = useApplyPetPhotoChange();

  return useMutation({
    mutationFn: ({ photo, previousPath }: { photo: PreparedPetPhoto; previousPath: string | null }) =>
      uploadPetPhoto(petId, photo, previousPath),
    onSuccess: (pet, { previousPath }) => applyChange(pet, previousPath),
  });
}

export function useRemovePetPhoto(petId: string) {
  const applyChange = useApplyPetPhotoChange();

  return useMutation({
    mutationFn: (photoPath: string) => removePetPhoto(petId, photoPath),
    onSuccess: (pet, photoPath) => applyChange(pet, photoPath),
  });
}
