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
 * Sin conexión: la copia del dispositivo con aviso de que puede estar desactualizada; sin copia,
 * «no disponible sin conexión» (no «no existe»: eso solo lo dice el servidor).
 */
export default function PetDetailScreen() {
  const { id, photoFailed } = useLocalSearchParams<{ id: string; photoFailed?: string }>();
  const router = useRouter();
  const pet = usePet(id);
  const { view } = pet;
  const back = () => (router.canGoBack() ? router.back() : router.replace('/pets'));

  if (view.state === 'ready') {
    return (
      <PetProfile
        pet={view.pet}
        mode="stack"
        freshness={view}
        onOpenHistory={() => router.push({ pathname: '/pets/[id]/daily-logs', params: { id } })}
        notice={photoFailed === '1' ? <Alert tone="warning" message={t('pets.new.photoFailed')} /> : null}
      />
    );
  }

  const content = () => {
    switch (view.state) {
      case 'loading':
        return <LoadingState />;
      case 'error':
        return <ErrorState message={petErrorMessage(view.error)} onRetry={pet.refetch} />;
      case 'local_error':
        return <ErrorState message={t('pets.offline.localReadFailed')} onRetry={pet.refetch} />;
      case 'offline_unavailable':
        return (
          <ErrorState
            offline
            message={t('pets.offline.detailUnavailableTitle')}
            description={t('pets.offline.detailUnavailableText')}
            onRetry={pet.refetch}
          />
        );
      case 'unavailable':
        return (
          <EmptyState
            kind="offline"
            title={t('pets.offline.noLongerAvailableTitle')}
            description={t('pets.offline.noLongerAvailableText')}
            actionLabel={t('common.retry')}
            onAction={pet.refetch}
          />
        );
      case 'not_found':
        return (
          <EmptyState
            title={t('pets.detail.notFound')}
            actionLabel={t('pets.detail.backToList')}
            onAction={() => router.dismissTo('/pets')}
          />
        );
    }
  };

  return (
    <Screen align="top">
      <TopBar onBack={back} />
      {content()}
    </Screen>
  );
}
