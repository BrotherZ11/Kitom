import { useLocalSearchParams, useRouter } from 'expo-router';

import { EmptyState, ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { PetForm } from '@/features/pets/components/pet-form';
import { usePet, useUpdatePet } from '@/features/pets/hooks/use-pets';
import { useSpecies } from '@/features/pets/hooks/use-species';
import { petErrorMessage } from '@/features/pets/pet-errors';
import { toPetFormValues } from '@/features/pets/pet-form';
import type { PetFields } from '@/features/pets/types';
import { t } from '@/i18n';

export default function EditPetScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const pet = usePet(id);
  const species = useSpecies();
  const updatePet = useUpdatePet(id);

  const handleSubmit = (fields: PetFields) => {
    updatePet.mutate(fields, { onSuccess: () => router.back() });
  };

  const renderContent = () => {
    if (pet.isPending || species.isPending) return <LoadingState />;
    if (pet.isError) {
      return <ErrorState message={petErrorMessage(pet.error)} onRetry={() => pet.refetch()} />;
    }
    if (species.isError) {
      return (
        <ErrorState message={petErrorMessage(species.error)} onRetry={() => species.refetch()} />
      );
    }
    if (pet.data === null) {
      return (
        <EmptyState
          title={t('pets.detail.notFound')}
          actionLabel={t('pets.detail.backToList')}
          onAction={() => router.dismissTo('/pets')}
        />
      );
    }
    return (
      <PetForm
        // Los valores iniciales se leen una vez: el formulario no se resetea si la caché se refresca.
        initialValues={toPetFormValues(pet.data)}
        species={species.data}
        submitLabel={t('pets.edit.submit')}
        isSubmitting={updatePet.isPending}
        submitError={updatePet.isError ? petErrorMessage(updatePet.error) : null}
        onSubmit={handleSubmit}
      />
    );
  };

  return (
    <Screen align="top" edges={['bottom', 'left', 'right']}>
      {renderContent()}
    </Screen>
  );
}
