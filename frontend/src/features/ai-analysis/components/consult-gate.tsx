import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';

import { Stethoscope } from '@/components/ui/icons';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { TopBar } from '@/components/ui/top-bar';
import { useAuth } from '@/features/auth/auth-context';
import { useActivePet } from '@/features/pets/active-pet-context';
import { useCanEditPet } from '@/features/pets/hooks/use-pets';
import { isLocalPetId } from '@/features/pets/offline/pet-operation';
import type { Pet } from '@/features/pets/types';
import { useIsOnline } from '@/hooks/use-is-online';
import { t, tf } from '@/i18n';

/**
 * Estados comunes de las pantallas de orientación: la mascota (de la lista ya cargada), una mascota aún
 * sin crear en el servidor, sin conexión (todo necesita el servidor) y, si `requireEdit`, el permiso de
 * edición (`request_ai_analysis` exige `can_edit_pet`). Con todo bien, `children(mascota, canEdit)`.
 */
export function ConsultGate({
  petId,
  requireEdit = false,
  children,
}: {
  petId: string;
  requireEdit?: boolean;
  children: (pet: Pet, canEdit: boolean) => ReactNode;
}) {
  const router = useRouter();
  const { canUseServer } = useAuth();
  const online = useIsOnline();
  const { pets } = useActivePet();
  const permission = useCanEditPet(petId);
  const pet = pets.data?.find((item) => item.id === petId) ?? null;
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

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
        <EmptyState icon={Stethoscope} title={t('consult.errors.notFound')} actionLabel={t('common.back')} onAction={back} />
      )
    );
  }
  if (isLocalPetId(pet.id)) return frame(<EmptyState icon={Stethoscope} title={tf('consult.localPet', { name: pet.name })} />);
  if (!canUseServer || !online) {
    return frame(
      <ErrorState offline message={t('consult.offlineTitle')} description={t('consult.offlineText')} onRetry={() => void permission.refetch()} />
    );
  }
  if (permission.isPending) return frame(<LoadingState />);
  if (permission.isError) return frame(<ErrorState message={t('consult.errors.unknown')} onRetry={() => void permission.refetch()} />);
  if (requireEdit && !permission.data) {
    return frame(<EmptyState icon={Stethoscope} title={t('consult.errors.not_allowed')} actionLabel={t('common.back')} onAction={back} />);
  }
  return children(pet, permission.data === true);
}
