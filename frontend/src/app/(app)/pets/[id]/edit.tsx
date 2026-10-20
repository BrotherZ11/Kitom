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
import { resolveEditPetForm } from '@/features/pets/offline/pet-form-gate';
import { isPetOfflineError, petErrorMessage } from '@/features/pets/pet-errors';
import { toPetFormValues } from '@/features/pets/pet-form';
import { missingProfileFields, PROFILE_FIELDS } from '@/features/pets/pet-profile';
import type { PetFields } from '@/features/pets/types';
import { useIsOnline } from '@/hooks/use-is-online';
import { t, tf } from '@/i18n';

/**
 * Editar el perfil (tablero 3.8): todo opcional salvo el nombre; la especie no cambia si solo hay una
 * disponible. La foto se gestiona aparte (hoja 3.2). Eliminar (solo el propietario) se confirma con
 * sus consecuencias (3.11). Al guardar, vuelve con «Cambios guardados» (3.7).
 *
 * Guardar y eliminar necesitan conexión (no hay escrituras de mascotas sin conexión): sin ella, si no
 * se puede mostrar el formulario se explica; si ya estaba abierto, se avisa, no se puede enviar y lo
 * escrito se conserva. Sin conexión no se edita sobre la copia del dispositivo (puede estar
 * desactualizada).
 */
export default function EditPetScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { user, canUseServer } = useAuth();
  const online = useIsOnline();
  const writable = canUseServer && online;
  const pet = usePet(id);
  const { view } = pet;
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

  const gate = resolveEditPetForm({ pet: view, species, writable, isOfflineError: isPetOfflineError });

  if (gate.state === 'loading') return frame(<LoadingState />);
  if (gate.state === 'offline') {
    return frame(
      <ErrorState
        offline
        message={t('pets.offline.editTitle')}
        description={t('pets.offline.formText')}
        onRetry={() => {
          pet.refetch();
          void species.refetch();
        }}
      />
    );
  }
  if (gate.state === 'error') {
    const retry = gate.source === 'pet' ? pet.refetch : () => void species.refetch();
    return frame(<ErrorState message={petErrorMessage(gate.error)} onRetry={retry} />);
  }
  if (gate.state === 'not_found' || view.state !== 'ready' || !species.data) {
    return frame(
      <EmptyState
        title={t('pets.detail.notFound')}
        actionLabel={t('pets.detail.backToList')}
        onAction={() => router.dismissTo('/pets')}
      />
    );
  }

  const current = view.pet;
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
        photo={<PetPhotoEditor pet={current} canEdit={canEdit.data === true && writable} />}
        footerExtra={
          isOwner && writable ? (
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
        offline={gate.offline}
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
