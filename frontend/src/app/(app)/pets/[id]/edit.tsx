import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Trash } from '@/components/ui/icons';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { useToast } from '@/components/ui/toast';
import { TopBar, TopBarText } from '@/components/ui/top-bar';
import { useAuth } from '@/features/auth/auth-context';
import { PetForm } from '@/features/pets/components/pet-form';
import { PetPhotoEditor } from '@/features/pets/components/pet-photo-editor';
import { useCanEditPet, useDeletePet, usePet, useUpdatePet } from '@/features/pets/hooks/use-pets';
import { useSpecies } from '@/features/pets/hooks/use-species';
import { petErrorMessage } from '@/features/pets/pet-errors';
import { toPetFormValues } from '@/features/pets/pet-form';
import { missingProfileFields, PROFILE_FIELDS } from '@/features/pets/pet-profile';
import type { PetFields } from '@/features/pets/types';
import { t, tf } from '@/i18n';

/**
 * Editar el perfil (tablero 3.8): todo opcional salvo el nombre; la especie no cambia si solo hay una
 * disponible. La foto se gestiona aparte (hoja 3.2). Eliminar (solo el propietario) se confirma con
 * sus consecuencias (3.11). Al guardar, vuelve con «Cambios guardados» (3.7).
 */
export default function EditPetScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const pet = usePet(id);
  const canEdit = useCanEditPet(id);
  const species = useSpecies();
  const updatePet = useUpdatePet(id);
  const deletePet = useDeletePet(id);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const back = () => (router.canGoBack() ? router.back() : router.replace({ pathname: '/pets/[id]', params: { id } }));

  const handleSubmit = (fields: PetFields) => {
    updatePet.mutate(fields, {
      onSuccess: () => {
        toast({ message: t('pets.edit.saved') });
        back();
      },
    });
  };

  const frame = (content: ReactNode) => (
    <Screen align="top">
      <TopBar onBack={back} title={pet.data ? tf('pets.edit.heading', { name: pet.data.name }) : t('pets.edit.title')} />
      {content}
    </Screen>
  );

  if (pet.isPending || species.isPending) return frame(<LoadingState />);
  if (pet.isError) return frame(<ErrorState message={petErrorMessage(pet.error)} onRetry={() => void pet.refetch()} />);
  if (species.isError) {
    return frame(<ErrorState message={petErrorMessage(species.error)} onRetry={() => void species.refetch()} />);
  }
  if (pet.data === null) {
    return frame(
      <EmptyState
        title={t('pets.detail.notFound')}
        actionLabel={t('pets.detail.backToList')}
        onAction={() => router.dismissTo('/pets')}
      />
    );
  }

  const current = pet.data;
  const filled = PROFILE_FIELDS.length - missingProfileFields(current).length;
  // Solo UX: ocultar lo que RLS rechazaría (borrar: propietario).
  const isOwner = current.owner_id === user?.id;

  return (
    <>
      <PetForm
        variant="edit"
        // Los valores iniciales se leen una vez: el formulario no se resetea si la caché se refresca.
        initialValues={toPetFormValues(current)}
        species={species.data}
        header={
          <TopBar
            onBack={back}
            title={tf('pets.edit.heading', { name: current.name })}
            right={<TopBarText mono text={`${filled}/${PROFILE_FIELDS.length}`} />}
          />
        }
        photo={<PetPhotoEditor pet={current} canEdit={canEdit.data === true} />}
        footerExtra={
          isOwner ? (
            <Button
              variant="dangerGhost"
              size="md"
              icon={Trash}
              label={tf('pets.edit.delete', { name: current.name })}
              onPress={() => {
                deletePet.reset();
                setConfirmingDelete(true);
              }}
            />
          ) : undefined
        }
        isSubmitting={updatePet.isPending}
        leaveAllowed={confirmingDelete || updatePet.isSuccess}
        submitError={updatePet.isError ? petErrorMessage(updatePet.error) : null}
        onSubmit={handleSubmit}
      />
      <Dialog
        visible={confirmingDelete}
        tone="danger"
        icon={Trash}
        title={tf('pets.detail.deleteTitleNamed', { name: current.name })}
        message={t('pets.detail.deleteConfirmDescription')}
        confirmLabel={tf('pets.detail.deleteNamed', { name: current.name })}
        loading={deletePet.isPending}
        error={deletePet.isError ? petErrorMessage(deletePet.error) : null}
        onConfirm={() => deletePet.mutate(undefined, { onSuccess: () => router.dismissTo('/') })}
        onCancel={() => setConfirmingDelete(false)}
      />
    </>
  );
}
