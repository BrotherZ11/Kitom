import { onlineManager, useQueryClient } from '@tanstack/react-query';
import { createContext, use, useEffect, useState, useSyncExternalStore, type PropsWithChildren } from 'react';
import { AppState } from 'react-native';

import { useAuth, type AuthResult } from '@/features/auth/auth-context';
import type { AuthErrorCode } from '@/features/auth/auth-errors';
import { createOwnerAccessToken } from '@/features/auth/owner-session';
import { createSignOutFlow, type SignOutFlow, type SignOutFlowState } from '@/features/auth/sign-out-flow';
import {
  applyLocalChangeToCache,
  ownerScopedSnapshots,
  summarizeUnsynced,
} from '@/features/daily-logs/offline/daily-log-cache';
import { createDailyLogRemote } from '@/features/daily-logs/offline/daily-log-remote';
import {
  createDailyLogRepository,
  type DailyLogRepository,
} from '@/features/daily-logs/offline/daily-log-repository';
import {
  createDailyLogSyncEngine,
  type DailyLogSyncEngine,
} from '@/features/daily-logs/offline/daily-log-sync-engine';
import { createDailyLogSyncSessions } from '@/features/daily-logs/offline/daily-log-sync-sessions';
import { connectSyncTriggers } from '@/features/daily-logs/offline/sync-triggers';
import { createOperationId } from '@/lib/device-operation-id';
import { deviceStorage } from '@/lib/local-store/device-storage';
import { createLocalStore } from '@/lib/local-store/local-store';
import { supabase } from '@/lib/supabase';

/**
 * Almacén local y motor de sincronización de Daily Logs del usuario con sesión. Montar una vez, en
 * el layout de la zona autenticada. Contrato: `docs/FRONTEND_ARCHITECTURE.md` §5 «Sesión».
 *
 * - Una instancia por usuario y proceso (`createDailyLogSyncSessions`); solo la del usuario con sesión
 *   está activa. Al cerrar sesión o cambiar de cuenta, la anterior se para y queda sin sesión; sus datos
 *   se conservan en el dispositivo (aislados por usuario) y se recuperan al volver a entrar con ella.
 * - Cada envío va autorizado con el token de la sesión del dueño (`createOwnerAccessToken`): nunca sale
 *   con la sesión de otra cuenta.
 * - Lo que termina después de un cambio de cuenta (respuestas tardías) se guarda en el almacén de su
 *   dueño, pero no toca la caché ni la interfaz de la cuenta nueva (`isCurrentUser`).
 */

type DailyLogSync = {
  userId: string;
  repository: DailyLogRepository;
  engine: DailyLogSyncEngine;
};

type DailyLogSyncContextValue = DailyLogSync & {
  /** El almacén para las lecturas del servidor: copia solo si la sesión sigue siendo del dueño. */
  snapshots: ReturnType<typeof ownerScopedSnapshots>;
  signOutFlow: SignOutFlow<AuthErrorCode>;
};

const DailyLogSyncContext = createContext<DailyLogSyncContextValue | null>(null);

/** Tiempo máximo de la pasada de «Intentar sincronizar y cerrar sesión». */
export const SIGN_OUT_SYNC_TIMEOUT_MS = 15_000;

const sessions = createDailyLogSyncSessions((userId): DailyLogSync => {
  const repository = createDailyLogRepository(createLocalStore(deviceStorage, userId));
  const remote = createDailyLogRemote(supabase, { accessToken: createOwnerAccessToken(supabase.auth, userId) });
  const engine = createDailyLogSyncEngine({
    repository,
    remote,
    isOnline: () => onlineManager.isOnline(),
    now: Date.now,
    createOperationId,
  });
  return { userId, repository, engine };
});

export function DailyLogSyncProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  // Sin usuario (instante en que se cierra la sesión) no se pinta nada de la zona autenticada: ni
  // datos de la cuenta anterior ni pantallas sin su almacén. `user` también existe en `offline`
  // (identificado por la sesión guardada): su almacén se abre sin red.
  if (!user) return null;
  return (
    <DailyLogSyncSession key={user.id} userId={user.id}>
      {children}
    </DailyLogSyncSession>
  );
}

function DailyLogSyncSession({ userId, children }: PropsWithChildren<{ userId: string }>) {
  const queryClient = useQueryClient();
  const { session, signOut, isCurrentUser } = useAuth();

  const [value] = useState<DailyLogSyncContextValue>(() => {
    const sync = sessions.get(userId);
    return {
      ...sync,
      snapshots: ownerScopedSnapshots(sync.repository, () => isCurrentUser(userId)),
      signOutFlow: createSignOutFlow<AuthErrorCode>({
        checkUnsynced: async () => summarizeUnsynced(await sync.repository.list()),
        syncNow: () => sync.engine.syncNow({ timeoutMs: SIGN_OUT_SYNC_TIMEOUT_MS }),
        signOut: (): Promise<AuthResult> => signOut(),
      }),
    };
  });

  useEffect(() => {
    const { repository, engine } = sessions.activate(userId);
    const unsubscribeCache = repository.subscribe((change) => {
      // Una respuesta que llega después de cambiar de cuenta se guarda en el almacén de su dueño,
      // pero no en la caché: entre el evento de Auth y el desmontaje no debe aparecer en la otra cuenta.
      if (isCurrentUser(userId)) applyLocalChangeToCache(queryClient, userId, change);
    });
    const disconnect = connectSyncTriggers(engine.requestSync, {
      subscribeOnline: (listener) => onlineManager.subscribe(listener),
      subscribeForeground: (listener) => {
        const subscription = AppState.addEventListener('change', (state) => {
          if (state === 'active') listener();
        });
        return () => subscription.remove();
      },
    });
    return () => {
      value.signOutFlow.cancel();
      disconnect();
      unsubscribeCache();
      sessions.deactivate(userId);
    };
  }, [value, queryClient, userId, isCurrentUser]);

  // Sesión vigente para el motor (se comprueba antes de cada envío). Una sesión nueva o renovada
  // (p. ej. tras un 401 por token caducado) permite volver a enviar. En `offline` (sesión guardada sin
  // comprobar) `session` es `null`: se ven los datos locales del usuario, pero no se envía nada.
  useEffect(() => {
    value.engine.setSessionUserId(session?.user.id ?? null);
    if (session) void value.engine.requestSync();
  }, [session, value]);

  return <DailyLogSyncContext value={value}>{children}</DailyLogSyncContext>;
}

export function useDailyLogSync(): DailyLogSyncContextValue {
  const sync = use(DailyLogSyncContext);
  if (!sync) throw new Error('useDailyLogSync debe usarse dentro de DailyLogSyncProvider');
  return sync;
}

/** Registro que se está enviando ahora (`petId/logDate`), o `null`. */
export function useSyncingKey(): string | null {
  const { engine } = useDailyLogSync();
  return useSyncExternalStore(engine.subscribe, engine.getSyncingKey);
}

/**
 * Cierre de sesión de la zona autenticada (`features/auth/sign-out-flow.ts`): con cambios sin
 * sincronizar en el dispositivo no cierra sin una decisión del usuario. Una operación a la vez para
 * toda la sesión (inicio y pantalla de cierre comparten el flujo).
 */
export function useSignOutFlow(): { flow: SignOutFlow<AuthErrorCode>; state: SignOutFlowState } {
  const { signOutFlow } = useDailyLogSync();
  const state = useSyncExternalStore(signOutFlow.subscribe, signOutFlow.getState);
  return { flow: signOutFlow, state };
}
