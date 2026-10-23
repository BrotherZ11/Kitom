import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';

import { Users } from '@/components/ui/icons';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { TopBar } from '@/components/ui/top-bar';
import { useAuth } from '@/features/auth/auth-context';
import { useActivePet } from '@/features/pets/active-pet-context';
import { isLocalPetId } from '@/features/pets/offline/pet-operation';
import type { Pet } from '@/features/pets/types';
import { useIsOnline } from '@/hooks/use-is-online';
import { t, tf } from '@/i18n';

/**
 * Estados comunes de las pantallas de co-tutores: la mascota (de la lista ya cargada), una mascota aún
 * sin crear en el servidor y sin conexión (todo son RPC). Con todo bien, `children(mascota, esTitular)`;
 * ser titular solo decide qué se ofrece: el servidor vuelve a comprobarlo en cada RPC.
 */
export function CoOwnersGate({ petId, children }: { petId: string; children: (pet: Pet, isHolder: boolean) => ReactNode }) {
  const router = useRouter();
  const { canUseServer, user } = useAuth();
  const online = useIsOnline();
  const { pets } = useActivePet();
  const pet = pets.data?.find((item) => item.id === petId) ?? null;
  const back = () => (router.canGoBack() ? router.back() : router.replace('/profile'));

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
        <EmptyState icon={Users} title={t('coOwners.errors.not_member')} actionLabel={t('common.back')} onAction={back} />
      )
    );
  }
  if (isLocalPetId(pet.id)) return frame(<EmptyState icon={Users} title={tf('coOwners.localPet', { name: pet.name })} />);
  if (!canUseServer || !online) {
    return frame(<ErrorState offline message={t('coOwners.offlineTitle')} description={t('coOwners.offlineText')} />);
  }
  return children(pet, pet.owner_id === user?.id);
}
