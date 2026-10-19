import type { ReactNode } from 'react';

import { ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { OfflineSessionNotice } from '@/features/auth/components/offline-session-notice';
import { DeviceDailyLogs } from '@/features/daily-logs/components/device-logs';
import { UnsyncedDailyLogsEntry } from '@/features/daily-logs/components/unsynced-entry';
import { useActivePet } from '@/features/pets/active-pet-context';
import { NoPetsScreen } from '@/features/pets/components/no-pets';
import { petErrorMessage, toPetError } from '@/features/pets/pet-errors';
import type { Pet } from '@/features/pets/types';

/** Bordes de las pantallas de pestaña: abajo está la barra, que ya respeta el área segura. */
export const TAB_SCREEN_EDGES = ['top', 'left', 'right'] as const;

/**
 * Estados comunes de las pestañas que dependen de la mascota activa (Hoy, Historial, Agenda, Perfil):
 * cargando, error al cargar las mascotas y sin mascotas (tablero 3.10). Con datos en caché, un fallo
 * al refrescar no tapa la pantalla. Sin conexión ofrece los registros guardados en el dispositivo
 * (Pets todavía no funciona sin conexión).
 */
export function ActivePetGate({ children }: { children: (pet: Pet) => ReactNode }) {
  const { pets, activePet } = useActivePet();

  if (activePet) return children(activePet);

  if (!pets.data && pets.isError) {
    const offline = toPetError(pets.error).code === 'network';
    return (
      <Screen align="top" edges={[...TAB_SCREEN_EDGES]}>
        <OfflineSessionNotice />
        <UnsyncedDailyLogsEntry />
        <ErrorState message={petErrorMessage(pets.error)} offline={offline} onRetry={() => void pets.refetch()} />
        {offline ? <DeviceDailyLogs /> : null}
      </Screen>
    );
  }

  if (pets.data && pets.data.length === 0) return <NoPetsScreen />;

  return (
    <Screen align="top" edges={[...TAB_SCREEN_EDGES]}>
      <LoadingState />
    </Screen>
  );
}
