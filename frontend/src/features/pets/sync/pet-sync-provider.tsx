import { onlineManager, useQueryClient } from '@tanstack/react-query';
import { createContext, use, useEffect, useState, useSyncExternalStore, type PropsWithChildren } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/features/auth/auth-context';
import { createOwnerAccessToken } from '@/features/auth/owner-session';
import { createDailyLogSyncSessions } from '@/features/daily-logs/offline/daily-log-sync-sessions';
import { connectSyncTriggers } from '@/features/daily-logs/offline/sync-triggers';
import { createPetWritesRemote } from '@/features/pets/api/pet-writes-remote';
import { petCacheFor } from '@/features/pets/offline/device-pet-cache';
import { createPetOperationRepository, type PetOperationRepository } from '@/features/pets/offline/pet-operation-repository';
import { createPetSyncEngine, type PetSyncEngine } from '@/features/pets/offline/pet-sync-engine';
import { petKeys } from '@/features/pets/query-keys';
import { createOperationId } from '@/lib/device-operation-id';
import { deviceStorage } from '@/lib/local-store/device-storage';
import { createLocalStore } from '@/lib/local-store/local-store';
import { supabase } from '@/lib/supabase';

/**
 * Altas y ediciones de mascotas guardadas en el dispositivo y su motor de sincronización (Pets offline,
 * fase 8), del usuario con sesión. Montar una vez, en el layout de la zona autenticada. Mismo esquema
 * que Daily Logs (`DailyLogSyncProvider`):
 * - Una instancia por usuario y proceso; solo la del usuario con sesión está activa. Al cambiar de
 *   cuenta, la anterior se para y queda sin sesión; sus operaciones siguen en el dispositivo.
 * - Cada envío va autorizado con el token de la sesión del dueño (`createOwnerAccessToken`).
 * - Lo que termina después de un cambio de cuenta se guarda en los almacenes de su dueño, pero no toca
 *   la caché ni la interfaz de la cuenta nueva (`isCurrentUser`).
 * Contrato: `docs/FRONTEND_ARCHITECTURE.md` §5 «Pets: altas y ediciones sin conexión (fase 8)».
 */

type PetSync = { userId: string; operations: PetOperationRepository; engine: PetSyncEngine };

const PetSyncContext = createContext<PetSync | null>(null);

const sessions = createDailyLogSyncSessions((userId): PetSync => {
  const operations = createPetOperationRepository(createLocalStore(deviceStorage, userId));
  const engine = createPetSyncEngine({
    operations,
    cache: petCacheFor(userId),
    remote: createPetWritesRemote(supabase, {
      ownerUserId: userId,
      accessToken: createOwnerAccessToken(supabase.auth, userId),
    }),
    isOnline: () => onlineManager.isOnline(),
    now: Date.now,
    createOperationId,
  });
  return { userId, operations, engine };
});

export function PetSyncProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  // Sin usuario (instante en que se cierra la sesión) no se pinta nada de la zona autenticada.
  if (!user) return null;
  return (
    <PetSyncSession key={user.id} userId={user.id}>
      {children}
    </PetSyncSession>
  );
}

function PetSyncSession({ userId, children }: PropsWithChildren<{ userId: string }>) {
  const queryClient = useQueryClient();
  const { session, isCurrentUser } = useAuth();
  const [value] = useState(() => sessions.get(userId));

  useEffect(() => {
    const { operations, engine } = sessions.activate(userId);
    const unsubscribe = operations.subscribe(({ op, previous }) => {
      if (!isCurrentUser(userId)) return;
      void queryClient.invalidateQueries({ queryKey: petKeys.operations(userId) });
      // Confirmada (alta → `synced`, edición → borrada): la versión del servidor ya está en la copia.
      const confirmed = previous && previous.status !== 'synced' && (op === null || op.status === 'synced');
      if (confirmed) {
        void queryClient.invalidateQueries({ queryKey: petKeys.lists(userId) });
        void queryClient.invalidateQueries({ queryKey: petKeys.details(userId) });
        void queryClient.invalidateQueries({ queryKey: petKeys.local(userId) });
      }
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

  // Sesión vigente para el motor (se comprueba antes de cada envío). En `offline` es `null`.
  useEffect(() => {
    value.engine.setSessionUserId(session?.user.id ?? null);
    if (session) void value.engine.requestSync();
  }, [session, value]);

  return <PetSyncContext value={value}>{children}</PetSyncContext>;
}

export function usePetSync(): PetSync {
  const sync = use(PetSyncContext);
  if (!sync) throw new Error('usePetSync debe usarse dentro de PetSyncProvider');
  return sync;
}

/** Operación que se está enviando ahora (`localId`), o `null`. */
export function usePetSyncingKey(): string | null {
  const { engine } = usePetSync();
  return useSyncExternalStore(engine.subscribe, engine.getSyncingKey);
}
