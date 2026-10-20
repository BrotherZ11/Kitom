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
import { PetSavedBanner } from '@/features/pets/components/pet-saved-banner';
import { usePets } from '@/features/pets/hooks/use-pets';
import { useSpecies } from '@/features/pets/hooks/use-species';
import { petErrorMessage } from '@/features/pets/pet-errors';
import { t } from '@/i18n';

/**
 * Mis mascotas (desde «Tu cuenta»): todas las visibles, propias y compartidas, y añadir otra. Sin
 * conexión, la última lista guardada en el dispositivo con su fecha; sin copia, «no disponible sin
 * conexión» y los registros del dispositivo.
 */
export default function PetsListScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const pets = usePets();
  // El nombre de la especie es secundario: si el catálogo falla, la lista se muestra igual.
  const species = useSpecies();
  const speciesNames = new Map(species.data?.map((item) => [item.id, item.name]));

  const goToNewPet = () => router.push('/pets/new');

  const { view } = pets;

  const content = () => {
    if (view.state === 'loading') return <LoadingState />;
    if (view.state === 'error') return <ErrorState message={petErrorMessage(view.error)} onRetry={pets.refetch} />;
    if (view.state === 'offline_unavailable' || view.state === 'local_error') {
      return (
        <>
          {view.state === 'local_error' ? (
            <ErrorState message={t('pets.offline.localReadFailed')} onRetry={pets.refetch} />
          ) : (
            <ErrorState
              offline
              message={t('pets.offline.listUnavailableTitle')}
              description={t('pets.offline.listUnavailableText')}
              onRetry={pets.refetch}
            />
          )}
          {/* Sin la lista: acceso a los registros guardados en el dispositivo. */}
          <DeviceDailyLogs />
        </>
      );
    }
    if (view.pets.length === 0) {
      return (
        <>
          <PetSavedBanner freshness={view} />
          <EmptyState
            title={t('pets.list.emptyTitle')}
            description={t('pets.list.emptyDescription')}
            actionLabel={t('pets.list.add')}
            onAction={goToNewPet}
          />
        </>
      );
    }
    return (
      <>
        <PetSavedBanner freshness={view} />
        <Card flush>
          {view.pets.map((pet, index) => (
            <PetListItem
              key={pet.id}
              pet={pet}
              speciesName={speciesNames.get(pet.species_id) ?? null}
              // Solo informativo: la visibilidad la decide RLS, no esta comparación.
              isShared={pet.owner_id !== user?.id}
              divider={index < view.pets.length - 1}
              onPress={() => router.push({ pathname: '/pets/[id]', params: { id: pet.id } })}
            />
          ))}
        </Card>
      </>
    );
  };

  return (
    <Screen
      align="top"
      footer={
        view.state === 'ready' && view.pets.length > 0 ? (
          <Button variant="secondary" icon={Plus} label={t('pets.list.add')} onPress={goToNewPet} />
        ) : undefined
      }>
      <TopBar onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} title={t('pets.list.title')} />
      {content()}
    </Screen>
  );
}
