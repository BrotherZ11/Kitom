import type { ReactNode } from 'react';

import { ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { OfflineSessionNotice } from '@/features/auth/components/offline-session-notice';
import { DeviceDailyLogs } from '@/features/daily-logs/components/device-logs';
import { UnsyncedDailyLogsEntry } from '@/features/daily-logs/components/unsynced-entry';
import { useActivePet } from '@/features/pets/active-pet-context';
import { NoPetsScreen } from '@/features/pets/components/no-pets';
import { petErrorMessage } from '@/features/pets/pet-errors';
import type { Pet } from '@/features/pets/types';
import { t } from '@/i18n';

/** Bordes de las pantallas de pestaña: abajo está la barra, que ya respeta el área segura. */
export const TAB_SCREEN_EDGES = ['top', 'left', 'right'] as const;

/**
 * Estados comunes de las pestañas que dependen de la mascota activa (Hoy, Historial, Agenda, Perfil):
 * cargando, error al cargar las mascotas y sin mascotas (tablero 3.10). Con datos (del servidor o la
 * copia del dispositivo), un fallo al refrescar no tapa la pantalla. Sin conexión y sin copia de la
 * lista, «no disponible sin conexión» (nunca «sin mascotas») y los registros guardados en el
 * dispositivo.
 */
export function ActivePetGate({ children }: { children: (pet: Pet) => ReactNode }) {
  const { pets, activePet } = useActivePet();
  const { view } = pets;

  if (activePet) return children(activePet);

  if (view.state === 'ready' && view.pets.length === 0) return <NoPetsScreen />;

  if (view.state === 'error' || view.state === 'offline_unavailable' || view.state === 'local_error') {
    return (
      <Screen align="top" edges={[...TAB_SCREEN_EDGES]}>
        <OfflineSessionNotice />
        <UnsyncedDailyLogsEntry />
        {view.state === 'error' ? (
          <ErrorState message={petErrorMessage(view.error)} onRetry={pets.refetch} />
        ) : view.state === 'local_error' ? (
          <ErrorState message={t('pets.offline.localReadFailed')} onRetry={pets.refetch} />
        ) : (
          <ErrorState
            offline
            message={t('pets.offline.listUnavailableTitle')}
            description={t('pets.offline.listUnavailableText')}
            onRetry={pets.refetch}
          />
        )}
        {view.state !== 'error' ? <DeviceDailyLogs /> : null}
      </Screen>
    );
  }

  return (
    <Screen align="top" edges={[...TAB_SCREEN_EDGES]}>
      <LoadingState />
    </Screen>
  );
}
