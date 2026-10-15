import { onlineManager, useQueryClient } from '@tanstack/react-query';
import { createContext, use, useEffect, useState, useSyncExternalStore, type PropsWithChildren } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/features/auth/auth-context';
import { applyLocalChangeToCache } from '@/features/daily-logs/offline/daily-log-cache';
import { createDailyLogRemote } from '@/features/daily-logs/offline/daily-log-remote';
import {
  createDailyLogRepository,
  type DailyLogRepository,
} from '@/features/daily-logs/offline/daily-log-repository';
import {
  createDailyLogSyncEngine,
  type DailyLogSyncEngine,
} from '@/features/daily-logs/offline/daily-log-sync-engine';
import { connectSyncTriggers } from '@/features/daily-logs/offline/sync-triggers';
import { createOperationId } from '@/lib/device-operation-id';
import { deviceStorage } from '@/lib/local-store/device-storage';
import { createLocalStore } from '@/lib/local-store/local-store';
import { supabase } from '@/lib/supabase';

/**
 * Almacén local y motor de sincronización de Daily Logs del usuario con sesión. Montar una vez, en
 * el layout de la zona autenticada. Al cambiar de usuario se crean otros (la `key` es el usuario):
 * cada usuario solo ve y envía lo suyo. Los datos locales de otros usuarios no se borran (pendiente).
 */

type DailyLogSync = {
  userId: string;
  repository: DailyLogRepository;
  engine: DailyLogSyncEngine;
};

const DailyLogSyncContext = createContext<DailyLogSync | null>(null);

const remote = createDailyLogRemote(supabase);

export function DailyLogSyncProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  if (!user) return children;
  return (
    <DailyLogSyncSession key={user.id} userId={user.id}>
      {children}
    </DailyLogSyncSession>
  );
}

function DailyLogSyncSession({ userId, children }: PropsWithChildren<{ userId: string }>) {
  const queryClient = useQueryClient();
  const { session } = useAuth();

  const [sync] = useState<DailyLogSync>(() => {
    const repository = createDailyLogRepository(createLocalStore(deviceStorage, userId));
    const engine = createDailyLogSyncEngine({
      repository,
      remote,
      isOnline: () => onlineManager.isOnline(),
      now: Date.now,
      createOperationId,
    });
    return { userId, repository, engine };
  });

  useEffect(() => {
    const unsubscribeCache = sync.repository.subscribe((change) =>
      applyLocalChangeToCache(queryClient, userId, change)
    );
    sync.engine.start();
    const disconnect = connectSyncTriggers(sync.engine.requestSync, {
      subscribeOnline: (listener) => onlineManager.subscribe(listener),
      subscribeForeground: (listener) => {
        const subscription = AppState.addEventListener('change', (state) => {
          if (state === 'active') listener();
        });
        return () => subscription.remove();
      },
    });
    return () => {
      disconnect();
      sync.engine.stop();
      unsubscribeCache();
    };
  }, [sync, queryClient, userId]);

  // Sesión vigente para el motor (se comprueba antes de cada envío). Una sesión nueva o renovada
  // (p. ej. tras un 401 por token caducado) permite volver a enviar.
  useEffect(() => {
    sync.engine.setSessionUserId(session?.user.id ?? null);
    if (session) void sync.engine.requestSync();
  }, [session, sync]);

  return <DailyLogSyncContext value={sync}>{children}</DailyLogSyncContext>;
}

export function useDailyLogSync(): DailyLogSync {
  const sync = use(DailyLogSyncContext);
  if (!sync) throw new Error('useDailyLogSync debe usarse dentro de DailyLogSyncProvider');
  return sync;
}

/** Registro que se está enviando ahora (`petId/logDate`), o `null`. */
export function useSyncingKey(): string | null {
  const { engine } = useDailyLogSync();
  return useSyncExternalStore(engine.subscribe, engine.getSyncingKey);
}
