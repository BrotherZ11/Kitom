import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  finishAccountDeletion,
  type DeletionPlan,
  type DeletionPreview,
} from '@/features/account/account-deletion';
import { deleteAccount, fetchDeletionPreview } from '@/features/account/api/account-deletion-api';
import { useAuth } from '@/features/auth/auth-context';
import { useDailyLogSync } from '@/features/daily-logs/sync/daily-log-sync-provider';
import { cancelAllAppNotifications } from '@/features/notifications/device-notifications';
import { usePetSync } from '@/features/pets/sync/pet-sync-provider';
import { useReminderSync } from '@/features/reminders/sync/reminder-sync-provider';
import { deviceStorage } from '@/lib/local-store/device-storage';
import { clearLocalUserData } from '@/lib/local-store/local-store';

/** Espera máxima a los envíos en vuelo de los motores antes de borrar lo local. */
const ENGINE_IDLE_TIMEOUT_MS = 5_000;

/** Query keys del borrado de cuenta (con el usuario, como el resto de features). */
export const accountKeys = {
  all: ['account'] as const,
  deletionPreview: (userId: string) => [...accountKeys.all, userId, 'deletion-preview'] as const,
};

/**
 * Vista previa del borrado (qué pasa con cada mascota). Siempre fresca: se pide al abrir la pantalla y
 * no se guarda al salir (la decisión se toma sobre el estado actual del servidor).
 */
export function useDeletionPreview() {
  const { canUseServer, serverCall, user } = useAuth();
  const userId = user?.id ?? '';
  return useQuery({
    queryKey: accountKeys.deletionPreview(userId),
    enabled: canUseServer && userId !== '',
    queryFn: () => serverCall(() => fetchDeletionPreview()),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

/** Sustituye la vista previa por el plan nuevo que devolvió la función (`plan_changed`). */
export function useReplaceDeletionPlan() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? '';
  return (plan: DeletionPlan) => {
    const next: DeletionPreview = { status: 'ready', plan };
    queryClient.setQueryData(accountKeys.deletionPreview(userId), next);
  };
}

/**
 * Cierre en el dispositivo tras borrar la cuenta (`finishAccountDeletion`): para los motores de Daily
 * Logs, Pets y Agenda, borra todo lo local del usuario (registros, operaciones pendientes, copias, razas) y sus
 * avisos, y cierra la sesión. Es la única excepción a «cerrar sesión siempre con `useSignOutFlow`»: la
 * cuenta ya no existe y el usuario ya aceptó perder lo no sincronizado. Montar dentro de `(app)`.
 */
export function useFinishAccountDeletion() {
  const { signOut, user } = useAuth();
  const daily = useDailyLogSync();
  const pets = usePetSync();
  const reminders = useReminderSync();
  const userId = user?.id ?? null;
  return () =>
    finishAccountDeletion({
      engines: [daily.engine, pets.engine, reminders.engine],
      idleTimeoutMs: ENGINE_IDLE_TIMEOUT_MS,
      clearLocalData: () => (userId ? clearLocalUserData(deviceStorage, userId) : Promise.resolve(0)),
      cancelNotifications: () => cancelAllAppNotifications(),
      signOut: () => signOut(),
    });
}

/** Borra la cuenta con el plan confirmado. Nunca se reintenta solo: lo decide el usuario. */
export function useDeleteAccount() {
  const { serverCall } = useAuth();
  return useMutation({
    mutationFn: (plan: DeletionPlan) => serverCall(() => deleteAccount(plan)),
    retry: false,
  });
}
