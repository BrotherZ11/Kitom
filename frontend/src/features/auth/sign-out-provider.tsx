import { useQuery } from '@tanstack/react-query';
import { createContext, use, useEffect, useState, useSyncExternalStore, type PropsWithChildren } from 'react';

import { useAuth, type AuthResult } from '@/features/auth/auth-context';
import type { AuthErrorCode } from '@/features/auth/auth-errors';
import type { SignOutFlow, SignOutFlowState } from '@/features/auth/sign-out-flow';
import { createAppSignOutFlow, type SignOutSummary } from '@/features/auth/unsynced-changes';
import { localQueryOptions, summarizeUnsynced } from '@/features/daily-logs/offline/daily-log-cache';
import { useUnsyncedDailyLogs } from '@/features/daily-logs/hooks/use-daily-log';
import { useDailyLogSync } from '@/features/daily-logs/sync/daily-log-sync-provider';
import { usePetOperations } from '@/features/pets/hooks/use-pet-writes';
import { summarizePetOperations } from '@/features/pets/offline/pet-operation';
import { petKeys } from '@/features/pets/query-keys';
import { usePetSync } from '@/features/pets/sync/pet-sync-provider';

/**
 * Cierre de sesión de la zona autenticada con **todos** los cambios que solo existen en el dispositivo:
 * registros diarios y altas y ediciones de mascotas (fase 8.5). Montar dentro de los proveedores de
 * Daily Logs y de Pets (`(app)/_layout.tsx`): se crea uno por cuenta, porque esos proveedores se
 * vuelven a montar al cambiar de usuario. El flujo es `features/auth/sign-out-flow.ts`:
 * - `request`: sin nada pendiente, cierra; con algo pendiente (de cualquier fuente), o si alguno de los
 *   almacenes no se puede leer, pide una decisión. Nunca da por vacío lo que no pudo leer.
 * - Sincronizar y cerrar: una pasada acotada de los dos motores; solo cierra si después no queda nada
 *   (tampoco altas o ediciones de resultado incierto, en conflicto, fallidas o sin permiso).
 * - Conservar y cerrar: no toca nada. Las operaciones de cada cuenta siguen en el dispositivo, aisladas
 *   por usuario; los motores de la cuenta que sale se paran y quedan sin sesión, y cada envío lleva el
 *   token del dueño: nada sale con otra cuenta.
 */

/** Tiempo máximo de «Intentar sincronizar y cerrar sesión» (cada motor). */
export const SIGN_OUT_SYNC_TIMEOUT_MS = 15_000;

type Flow = SignOutFlow<AuthErrorCode, SignOutSummary>;

const SignOutFlowContext = createContext<Flow | null>(null);

export function SignOutFlowProvider({ children }: PropsWithChildren) {
  const daily = useDailyLogSync();
  const pets = usePetSync();
  const { signOut } = useAuth();
  const [flow] = useState<Flow>(() =>
    createAppSignOutFlow<AuthErrorCode>({
      dailyLogs: daily,
      pets,
      signOut: (): Promise<AuthResult> => signOut(),
      timeoutMs: SIGN_OUT_SYNC_TIMEOUT_MS,
    })
  );

  // Al salir de la cuenta (o desmontar), una pasada en curso ya no cierra la sesión al terminar.
  useEffect(() => () => flow.cancel(), [flow]);

  return <SignOutFlowContext value={flow}>{children}</SignOutFlowContext>;
}

/**
 * Cierre de sesión de la zona autenticada: con cambios sin sincronizar en el dispositivo no cierra sin
 * una decisión del usuario. Una operación a la vez para toda la sesión.
 */
export function useSignOutFlow(): { flow: Flow; state: SignOutFlowState } {
  const flow = use(SignOutFlowContext);
  if (!flow) throw new Error('useSignOutFlow debe usarse dentro de SignOutFlowProvider');
  const state = useSyncExternalStore(flow.subscribe, flow.getState);
  return { flow, state };
}

export type UnsyncedChangesView =
  | { state: 'loading' }
  /** Algún almacén no se pudo leer: no se afirma que no haya nada. */
  | { state: 'error' }
  | { state: 'ready'; summary: SignOutSummary };

/** Resumen en vivo de lo que solo está en el dispositivo (pantallas de ajustes y de cierre de sesión). */
export function useUnsyncedChanges(): { view: UnsyncedChangesView; refetch: () => void } {
  const { view: dailyView, refetch: refetchDaily } = useUnsyncedDailyLogs();
  const operations = usePetOperations();
  const { userId, operations: repository } = usePetSync();
  const unreadable = useQuery({
    queryKey: [...petKeys.operations(userId), 'unreadable'],
    queryFn: () => repository.unreadableCount(),
    ...localQueryOptions,
  });

  const refetch = () => {
    refetchDaily();
    void operations.refetch();
    void unreadable.refetch();
  };
  if (dailyView.state === 'error' || operations.isError || unreadable.isError) return { view: { state: 'error' }, refetch };
  if (dailyView.state !== 'ready' || operations.data === undefined || unreadable.data === undefined) {
    return { view: { state: 'loading' }, refetch };
  }
  return {
    view: {
      state: 'ready',
      summary: {
        dailyLogs: summarizeUnsynced(dailyView.items.map((item) => item.record)),
        pets: summarizePetOperations(operations.data, unreadable.data),
      },
    },
    refetch,
  };
}
