import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';

import { CalendarDays } from '@/components/ui/icons';
import { EmptyState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { TopBar } from '@/components/ui/top-bar';
import { useActivePet } from '@/features/pets/active-pet-context';
import { isLocalPetId } from '@/features/pets/offline/pet-operation';
import { useReminderPermission } from '@/features/reminders/hooks/use-reminders';
import { t, tf } from '@/i18n';

/**
 * Estados comunes de las pantallas de un recordatorio que escriben (nuevo, editar): la mascota (de la lista o de
 * la copia), una mascota aún sin crear en el servidor y el permiso. Sin conexión se puede escribir si el último
 * permiso confirmado lo permitía (solo una indicación; lo decide RLS al sincronizar). Sin valor conocido, no.
 */
export function ReminderScreenGate({ petId, children }: { petId: string; children: (petName: string) => ReactNode }) {
  const router = useRouter();
  const { pets } = useActivePet();
  const { permission } = useReminderPermission(petId);
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
  if (permission === 'loading') return frame(<LoadingState />);
  if (permission === 'read_only') {
    return frame(<EmptyState icon={CalendarDays} title={tf('agenda.detail.readOnly', { name: pet.name })} />);
  }
  if (permission === 'unknown') {
    return frame(<EmptyState icon={CalendarDays} title={t('agenda.offline.permissionTitle')} description={t('agenda.offline.permissionText')} />);
  }
  return children(pet.name);
}
