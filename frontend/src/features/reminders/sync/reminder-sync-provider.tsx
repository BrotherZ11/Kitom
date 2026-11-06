import { onlineManager, useQueryClient } from '@tanstack/react-query';
import { createContext, use, useEffect, useState, useSyncExternalStore, type PropsWithChildren } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/features/auth/auth-context';
import { createOwnerAccessToken } from '@/features/auth/owner-session';
import { createDailyLogSyncSessions } from '@/features/daily-logs/offline/daily-log-sync-sessions';
import { connectSyncTriggers } from '@/features/daily-logs/offline/sync-triggers';
import { deleteOperationFor } from '@/features/pets/offline/pet-operation';
import { createPetOperationRepository } from '@/features/pets/offline/pet-operation-repository';
import { usePetSync } from '@/features/pets/sync/pet-sync-provider';
import { createReminderWritesRemote } from '@/features/reminders/api/reminder-writes-remote';
import { reminderCacheFor } from '@/features/reminders/offline/device-reminder-cache';
import { createReminderOperationRepository, type ReminderOperationRepository } from '@/features/reminders/offline/reminder-operation-repository';
import { createReminderSyncEngine, type ReminderSyncEngine } from '@/features/reminders/offline/reminder-sync-engine';
import { reminderKeys } from '@/features/reminders/query-keys';
import { createOperationId } from '@/lib/device-operation-id';
import { deviceStorage } from '@/lib/local-store/device-storage';
import { createLocalStore } from '@/lib/local-store/local-store';
import { supabase } from '@/lib/supabase';

/**
 * Operaciones de la agenda guardadas en el dispositivo y su motor (fase 14), del usuario con sesión. Montar una
 * vez, dentro de `PetSyncProvider`. Mismo esquema que Pets: una instancia por usuario y proceso; cada envío con
 * el token del dueño; lo que termina tras un cambio de cuenta no toca la interfaz de la cuenta nueva.
 * Una mascota con una eliminación guardada retiene sus operaciones; al deshacerla, siguen solas.
 */

type ReminderSync = { userId: string; operations: ReminderOperationRepository; engine: ReminderSyncEngine };

const ReminderSyncContext = createContext<ReminderSync | null>(null);

const sessions = createDailyLogSyncSessions((userId): ReminderSync => {
  const store = createLocalStore(deviceStorage, userId);
  const operations = createReminderOperationRepository(store);
  const petOperations = createPetOperationRepository(store);
  const engine = createReminderSyncEngine({
    operations,
    cache: reminderCacheFor(userId),
    remote: createReminderWritesRemote(supabase, {
      ownerUserId: userId,
      accessToken: createOwnerAccessToken(supabase.auth, userId),
    }),
    isOnline: () => onlineManager.isOnline(),
    now: Date.now,
    createOperationId,
    petState: async (petId) => {
      const deletion = deleteOperationFor(await petOperations.list(), petId);
      if (!deletion) return 'normal';
      return deletion.status === 'synced' ? 'deleted' : 'held';
    },
  });
  return { userId, operations, engine };
});

export function ReminderSyncProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <ReminderSyncSession key={user.id} userId={user.id}>
      {children}
    </ReminderSyncSession>
  );
}

function ReminderSyncSession({ userId, children }: PropsWithChildren<{ userId: string }>) {
  const queryClient = useQueryClient();
  const { session, isCurrentUser } = useAuth();
  const { operations: petOperations } = usePetSync();
  const [value] = useState(() => sessions.get(userId));

  // Deshacer o confirmar la eliminación de una mascota libera o cierra sus operaciones.
  useEffect(() => petOperations.subscribe(() => void value.engine.requestSync()), [petOperations, value]);

  useEffect(() => {
    const { operations, engine } = sessions.activate(userId);
    const unsubscribe = operations.subscribe(({ op, previous }) => {
      if (!isCurrentUser(userId)) return;
      void queryClient.invalidateQueries({ queryKey: reminderKeys.operations(userId) });
      // Confirmada: la versión del servidor ya está en la copia; las listas se vuelven a pedir.
      const confirmed = previous && previous.status !== 'synced' && (op === null || op.status === 'synced');
      if (confirmed) void queryClient.invalidateQueries({ queryKey: reminderKeys.user(userId) });
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
      disconnect();
      unsubscribe();
      sessions.deactivate(userId);
    };
  }, [queryClient, userId, isCurrentUser]);

  useEffect(() => {
    value.engine.setSessionUserId(session?.user.id ?? null);
    if (session) void value.engine.requestSync();
  }, [session, value]);

  return <ReminderSyncContext value={value}>{children}</ReminderSyncContext>;
}

export function useReminderSync(): ReminderSync {
  const sync = use(ReminderSyncContext);
  if (!sync) throw new Error('useReminderSync debe usarse dentro de ReminderSyncProvider');
  return sync;
}

export function useReminderSyncingKey(): string | null {
  const { engine } = useReminderSync();
  return useSyncExternalStore(engine.subscribe, engine.getSyncingKey);
}
