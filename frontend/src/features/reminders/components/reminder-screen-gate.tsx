import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';

import { CalendarDays } from '@/components/ui/icons';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { TopBar } from '@/components/ui/top-bar';
import { useAuth } from '@/features/auth/auth-context';
import { useActivePet } from '@/features/pets/active-pet-context';
import { useCanEditPet } from '@/features/pets/hooks/use-pets';
import { isLocalPetId } from '@/features/pets/offline/pet-operation';
import { useIsOnline } from '@/hooks/use-is-online';
import { t, tf } from '@/i18n';

/**
 * Estados comunes de las pantallas de un recordatorio que escriben (nuevo, editar): la mascota
 * (de la lista ya cargada), una mascota aún sin crear en el servidor, sin conexión y sin permiso de
 * edición. Con todo bien, `children(nombre de la mascota)`.
 */
export function ReminderScreenGate({ petId, children }: { petId: string; children: (petName: string) => ReactNode }) {
  const router = useRouter();
  const { canUseServer } = useAuth();
  const online = useIsOnline();
  const { pets } = useActivePet();
  const canEdit = useCanEditPet(petId);
  const pet = pets.data?.find((item) => item.id === petId) ?? null;
  const back = () => (router.canGoBack() ? router.back() : router.replace('/agenda'));

  const frame = (content: ReactNode) => (
    <Screen align="top">
      <TopBar onBack={back} />
      {content}
    </Screen>
  );

  if (!pet) {
    return frame(
      pets.view.state === 'loading' ? (
        <LoadingState />
      ) : (
        <EmptyState icon={CalendarDays} title={t('agenda.errors.notFound')} actionLabel={t('common.back')} onAction={back} />
      )
    );
  }
  if (isLocalPetId(pet.id)) {
    return frame(<EmptyState icon={CalendarDays} title={tf('agenda.errors.localPet', { name: pet.name })} />);
  }
  if (!canUseServer || !online) {
    return frame(
      <ErrorState
        offline
        message={t('agenda.errors.offlineTitle')}
        description={t('agenda.errors.offlineText')}
        onRetry={() => void canEdit.refetch()}
      />
    );
  }
  if (canEdit.isPending) return frame(<LoadingState />);
  if (canEdit.isError) {
    return frame(<ErrorState message={t('agenda.errors.unknown')} onRetry={() => void canEdit.refetch()} />);
  }
  if (!canEdit.data) {
    return frame(<EmptyState icon={CalendarDays} title={tf('agenda.detail.readOnly', { name: pet.name })} />);
  }
  return children(pet.name);
}
