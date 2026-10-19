import { useRouter } from 'expo-router';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Plus } from '@/components/ui/icons';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { TopBar } from '@/components/ui/top-bar';
import { useAuth } from '@/features/auth/auth-context';
import { DeviceDailyLogs } from '@/features/daily-logs/components/device-logs';
import { PetListItem } from '@/features/pets/components/pet-list-item';
import { usePets } from '@/features/pets/hooks/use-pets';
import { useSpecies } from '@/features/pets/hooks/use-species';
import { petErrorMessage, toPetError } from '@/features/pets/pet-errors';
import { t } from '@/i18n';

/** Mis mascotas (desde «Tu cuenta»): todas las visibles, propias y compartidas, y añadir otra. */
export default function PetsListScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const pets = usePets();
  // El nombre de la especie es secundario: si el catálogo falla, la lista se muestra igual.
  const species = useSpecies();
  const speciesNames = new Map(species.data?.map((item) => [item.id, item.name]));

  const goToNewPet = () => router.push('/pets/new');

  const content = () => {
    if (pets.isPending) return <LoadingState />;
    if (pets.isError) {
      return (
        <>
          <ErrorState message={petErrorMessage(pets.error)} onRetry={() => void pets.refetch()} />
          {/* Sin conexión (Pets aún no funciona sin ella): acceso a los registros del dispositivo. */}
          {toPetError(pets.error).code === 'network' ? <DeviceDailyLogs /> : null}
        </>
      );
    }
    if (pets.data.length === 0) {
      return (
        <EmptyState
          title={t('pets.list.emptyTitle')}
          description={t('pets.list.emptyDescription')}
          actionLabel={t('pets.list.add')}
          onAction={goToNewPet}
        />
      );
    }
    return (
      <Card flush>
        {pets.data.map((pet, index) => (
          <PetListItem
            key={pet.id}
            pet={pet}
            speciesName={speciesNames.get(pet.species_id) ?? null}
            // Solo informativo: la visibilidad la decide RLS, no esta comparación.
            isShared={pet.owner_id !== user?.id}
            divider={index < pets.data.length - 1}
            onPress={() => router.push({ pathname: '/pets/[id]', params: { id: pet.id } })}
          />
        ))}
      </Card>
    );
  };

  return (
    <Screen
      align="top"
      footer={
        pets.data && pets.data.length > 0 ? (
          <Button variant="secondary" icon={Plus} label={t('pets.list.add')} onPress={goToNewPet} />
        ) : undefined
      }>
      <TopBar onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} title={t('pets.list.title')} />
      {content()}
    </Screen>
  );
}
