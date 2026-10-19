import { useLocalSearchParams, useRouter } from 'expo-router';

import { EmptyState, ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { TopBar } from '@/components/ui/top-bar';
import { PetHistory } from '@/features/daily-logs/components/pet-history';
import { useCanEditPet, usePet } from '@/features/pets/hooks/use-pets';
import { petErrorMessage, toPetError } from '@/features/pets/pet-errors';
import { t } from '@/i18n';

/**
 * Historial de una mascota concreta (`/pets/[id]/daily-logs`), el mismo que la pestaña Historial. Sin
 * conexión y sin la mascota en caché (Pets aún no funciona sin conexión) se muestra igualmente lo
 * guardado en el dispositivo, sin nombre ni foto: no se inventan.
 */
export default function DailyLogHistoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const pet = usePet(id);
  const canEdit = useCanEditPet(id);
  const offline = !pet.data && pet.isError && toPetError(pet.error).code === 'network';

  if (pet.data || offline) {
    // Sin conexión no se conoce el nombre ni la foto: se dice que no están disponibles.
    const shown = pet.data ?? { id, name: t('dailyLogs.offlinePet.unavailable'), photo_path: null };
    return <PetHistory pet={shown} mode="stack" canEdit={canEdit.data ?? null} />;
  }

  return (
    <Screen align="top">
      <TopBar onBack={() => (router.canGoBack() ? router.back() : router.replace('/history'))} />
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
