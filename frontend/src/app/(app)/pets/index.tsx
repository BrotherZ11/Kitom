import { useRouter } from 'expo-router';

import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { useAuth } from '@/features/auth/auth-context';
import { PetListItem } from '@/features/pets/components/pet-list-item';
import { usePets } from '@/features/pets/hooks/use-pets';
import { useSpecies } from '@/features/pets/hooks/use-species';
import { petErrorMessage } from '@/features/pets/pet-errors';
import { t } from '@/i18n';

export default function PetsListScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const pets = usePets();
  // El nombre de la especie es secundario: si el catálogo falla, la lista se muestra igual.
  const species = useSpecies();
  const speciesNames = new Map(species.data?.map((item) => [item.id, item.name]));

  const goToNewPet = () => router.push('/pets/new');

  return (
    <Screen align="top" edges={['bottom', 'left', 'right']}>
      {pets.isPending ? (
        <LoadingState />
      ) : pets.isError ? (
        <ErrorState message={petErrorMessage(pets.error)} onRetry={() => pets.refetch()} />
      ) : pets.data.length === 0 ? (
        <EmptyState
          title={t('pets.list.emptyTitle')}
          description={t('pets.list.emptyDescription')}
          actionLabel={t('pets.list.add')}
          onAction={goToNewPet}
        />
      ) : (
        <>
          {pets.data.map((pet) => (
            <PetListItem
              key={pet.id}
              pet={pet}
              speciesName={speciesNames.get(pet.species_id) ?? null}
              // Solo informativo: la visibilidad la decide RLS, no esta comparación.
              isShared={pet.owner_id !== user?.id}
              onPress={() => router.push({ pathname: '/pets/[id]', params: { id: pet.id } })}
            />
          ))}
          <Button label={t('pets.list.add')} onPress={goToNewPet} />
        </>
      )}
    </Screen>
  );
}
