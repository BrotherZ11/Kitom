import { useLocalSearchParams, useRouter } from 'expo-router';

import { Alert } from '@/components/ui/alert';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { TopBar } from '@/components/ui/top-bar';
import { PetProfile } from '@/features/pets/components/pet-profile';
import { usePet } from '@/features/pets/hooks/use-pets';
import { petErrorMessage } from '@/features/pets/pet-errors';
import { t } from '@/i18n';

/**
 * Perfil de una mascota abierto desde «Mis mascotas» o un enlace (`/pets/[id]`). Es el mismo perfil
 * que la pestaña Perfil, con «Volver». `?photoFailed=1`: se creó, pero la foto no se pudo subir.
 */
export default function PetDetailScreen() {
  const { id, photoFailed } = useLocalSearchParams<{ id: string; photoFailed?: string }>();
  const router = useRouter();
  const pet = usePet(id);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/pets'));

  if (pet.data) {
    return (
      <PetProfile
        pet={pet.data}
        mode="stack"
        onOpenHistory={() => router.push({ pathname: '/pets/[id]/daily-logs', params: { id } })}
        notice={photoFailed === '1' ? <Alert tone="warning" message={t('pets.new.photoFailed')} /> : null}
      />
    );
  }

  return (
    <Screen align="top">
      <TopBar onBack={back} />
      {pet.isPending ? (
        <LoadingState />
      ) : pet.isError ? (
        <ErrorState message={petErrorMessage(pet.error)} onRetry={() => void pet.refetch()} />
      ) : (
        <EmptyState
          title={t('pets.detail.notFound')}
          actionLabel={t('pets.detail.backToList')}
          onAction={() => router.dismissTo('/pets')}
        />
      )}
    </Screen>
  );
}
