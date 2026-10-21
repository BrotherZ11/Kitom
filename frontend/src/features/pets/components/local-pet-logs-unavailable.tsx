import { useLocalSearchParams, useRouter } from 'expo-router';
import type { ComponentType } from 'react';

import { EmptyState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { TopBar } from '@/components/ui/top-bar';
import { canHaveDailyLogs } from '@/features/pets/offline/pet-write-view';
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

/** Pantalla de registros que, con un id local, muestra `LocalPetLogsUnavailable` sin montar nada de Daily Logs. */
export function withServerPetId<P extends object>(Screen_: ComponentType<P>) {
  return function ServerPetScreen(props: P) {
    const { id } = useLocalSearchParams<{ id: string }>();
    if (!canHaveDailyLogs(id)) return <LocalPetLogsUnavailable />;
    return <Screen_ {...props} />;
  };
}
