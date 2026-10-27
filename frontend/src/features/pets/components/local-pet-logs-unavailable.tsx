import { useLocalSearchParams, useRouter } from 'expo-router';
import type { ComponentType } from 'react';

import { EmptyState, ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { TopBar } from '@/components/ui/top-bar';
import { usePetOperations } from '@/features/pets/hooks/use-pet-writes';
import { dailyLogsAccess } from '@/features/pets/offline/pet-write-view';
import { t } from '@/i18n';

/**
 * Registros diarios de una mascota creada en este dispositivo y aún sin id del servidor (fase 8): no
 * hay. Los registros necesitan el id del servidor (`save_daily_log`); nunca se guardan con un id
 * temporal, así que el motor de Daily Logs no cambia y ningún registro queda sin resolver.
 */
export function LocalPetLogsUnavailable() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const back = () => (router.canGoBack() ? router.back() : router.replace({ pathname: '/pets/[id]', params: { id } }));
  return (
    <Screen align="top">
      <TopBar onBack={back} />
      <EmptyState
        title={t('pets.sync.dailyLogsUnavailable')}
        description={t('pets.sync.dailyLogsUnavailableText')}
        actionLabel={t('common.back')}
        onAction={back}
      />
    </Screen>
  );
}

/**
 * Mascota con una eliminación guardada en el dispositivo (fase 10): no se abren sus registros para
 * añadir ni editar. Los ya guardados no se tocan (siguen en «Cambios sin sincronizar»).
 */
function DeletingPetLogsUnavailable() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const back = () => (router.canGoBack() ? router.back() : router.replace({ pathname: '/pets/[id]', params: { id } }));
  return (
    <Screen align="top">
      <TopBar onBack={back} />
      <EmptyState
        title={t('pets.deletion.dailyLogsBlocked')}
        description={t('pets.deletion.dailyLogsBlockedText')}
        actionLabel={t('common.back')}
        onAction={back}
      />
    </Screen>
  );
}

/**
 * Pantalla de registros que, con un id local o una eliminación guardada, no monta nada de Daily Logs.
 * Si las operaciones del dispositivo no se pueden leer, no se supone que no hay eliminación.
 */
export function withServerPetId<P extends object>(Screen_: ComponentType<P>) {
  return function ServerPetScreen(props: P) {
    const { id } = useLocalSearchParams<{ id: string }>();
    const operations = usePetOperations();
    const access = dailyLogsAccess(id, operations.data);
    if (access === 'local_pet') return <LocalPetLogsUnavailable />;
    if (operations.isError) {
      return (
        <Screen align="top">
          <ErrorState message={t('pets.deletion.dailyLogsCheckFailed')} onRetry={() => void operations.refetch()} />
        </Screen>
      );
    }
    if (operations.data === undefined) return <LoadingState />;
    if (access === 'deleting') return <DeletingPetLogsUnavailable />;
    return <Screen_ {...props} />;
  };
}
