import { useRouter } from 'expo-router';

import { ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { PetForm } from '@/features/pets/components/pet-form';
import { useCreatePet } from '@/features/pets/hooks/use-pets';
import { useSpecies } from '@/features/pets/hooks/use-species';
import { petErrorMessage } from '@/features/pets/pet-errors';
import { toPetFormValues } from '@/features/pets/pet-form';
import type { PetFields } from '@/features/pets/types';
import { t } from '@/i18n';

export default function NewPetScreen() {
  const router = useRouter();
  const species = useSpecies();
  const createPet = useCreatePet();

  const handleSubmit = (fields: PetFields) => {
    createPet.mutate(fields, {
      // Sustituye el formulario por el detalle: "atrás" vuelve a la lista, no al formulario.
      onSuccess: (pet) => router.replace({ pathname: '/pets/[id]', params: { id: pet.id } }),
    });
  };

  return (
    <Screen align="top" edges={['bottom', 'left', 'right']}>
      {species.isPending ? (
        <LoadingState />
      ) : species.isError ? (
        <ErrorState message={petErrorMessage(species.error)} onRetry={() => species.refetch()} />
      ) : (
        <PetForm
          initialValues={toPetFormValues()}
          species={species.data}
          submitLabel={t('pets.new.submit')}
          isSubmitting={createPet.isPending}
          submitError={createPet.isError ? petErrorMessage(createPet.error) : null}
          onSubmit={handleSubmit}
        />
      )}
    </Screen>
  );
}
