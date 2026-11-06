import type { DailyLogRepository } from '@/features/daily-logs/offline/daily-log-repository';
import type { DailyLogSyncEngine, SyncNowOutcome } from '@/features/daily-logs/offline/daily-log-sync-engine';
import type { PetOperationRepository } from '@/features/pets/offline/pet-operation-repository';
import type { PetSyncEngine } from '@/features/pets/offline/pet-sync-engine';

import { summarizeUnsynced } from '../daily-logs/offline/daily-log-cache.ts';
import { petUnsyncedTotal, summarizePetOperations, type PetUnsyncedSummary } from '../pets/offline/pet-operation.ts';
import type { ReminderOperationRepository } from '../reminders/offline/reminder-operation-repository.ts';
import { reminderUnsyncedTotal, summarizeReminderOperations, type ReminderUnsyncedSummary } from '../reminders/offline/reminder-operation.ts';
import type { ReminderSyncEngine } from '../reminders/offline/reminder-sync-engine.ts';
import { createSignOutFlow, unsyncedTotal, type SignOutFlow, type UnsyncedSummary } from './sign-out-flow.ts';

/**
 * Cambios que solo existen en este dispositivo, de todas las fuentes, para decidir al cerrar sesión:
 * registros diarios (`daily-logs`), altas y ediciones de mascotas (`pets`, fase 8) y la agenda (`reminders`,
 * fase 14). Módulo puro.
 */
export type SignOutSummary = { dailyLogs: UnsyncedSummary; pets: PetUnsyncedSummary; reminders: ReminderUnsyncedSummary };

export const NO_PET_CHANGES: PetUnsyncedSummary = {
  pendingCreate: 0,
  pendingUpdate: 0,
  pendingDelete: 0,
  uncertain: 0,
  conflict: 0,
  failed: 0,
  forbidden: 0,
  unreadable: 0,
};

/** Todo lo que no está confirmado por el servidor (incluido lo incierto y lo ilegible). */
export function signOutTotal(summary: SignOutSummary): number {
  return unsyncedTotal(summary.dailyLogs) + petUnsyncedTotal(summary.pets) + reminderUnsyncedTotal(summary.reminders);
}

/** Lo que necesita al usuario: sincronizar no lo resuelve solo. */
export function needsReview(summary: SignOutSummary): boolean {
  const { dailyLogs, pets, reminders } = summary;
  return (
    dailyLogs.conflict +
      dailyLogs.failed +
      pets.conflict +
      pets.failed +
      pets.forbidden +
      pets.unreadable +
      reminders.conflict +
      reminders.failed +
      reminders.forbidden +
      reminders.unreadable >
    0
  );
}

/**
 * Resultado conjunto de las pasadas de cada motor: si alguno no pudo empezar, ese motivo; si alguno
 * agotó el tiempo, `timed_out`; si todos terminaron, `completed`. Qué quedó sin sincronizar se lee
 * después del dispositivo (nunca se deduce de esto).
 */
export function combineSyncNow(outcomes: readonly SyncNowOutcome[]): SyncNowOutcome {
  const unavailable = outcomes.find((outcome) => outcome.status === 'unavailable');
  if (unavailable) return unavailable;
  if (outcomes.some((outcome) => outcome.status === 'timed_out')) return { status: 'timed_out' };
  return { status: 'completed' };
}

/**
 * Flujo de cierre de sesión de la cuenta activa con todas las fuentes de cambios locales. Lo usa el
 * proveedor (`sign-out-provider.tsx`) y se prueba tal cual (`sign-out-combined.test.mjs`):
 * - comprobar = leer todos los almacenes; si cualquiera falla al leer, el flujo pide decisión (`null`);
 * - sincronizar = todas las pasadas a la vez, cada una con su límite de tiempo;
 * - cerrar solo si el total (de todos, incluidos inciertos e ilegibles) es 0.
 */
export function createAppSignOutFlow<E>({
  dailyLogs,
  pets,
  reminders,
  signOut,
  clearLocalData,
  timeoutMs,
}: {
  dailyLogs: { repository: Pick<DailyLogRepository, 'list'>; engine: Pick<DailyLogSyncEngine, 'syncNow'> };
  pets: { operations: Pick<PetOperationRepository, 'list' | 'unreadableCount'>; engine: Pick<PetSyncEngine, 'syncNow'> };
  reminders: { operations: Pick<ReminderOperationRepository, 'list' | 'unreadableCount'>; engine: Pick<ReminderSyncEngine, 'syncNow'> };
  signOut: () => Promise<{ error: E | null }>;
  clearLocalData?: () => Promise<unknown>;
  timeoutMs: number;
}): SignOutFlow<E, SignOutSummary> {
  return createSignOutFlow<E, SignOutSummary>({
    checkUnsynced: async () => ({
      dailyLogs: summarizeUnsynced(await dailyLogs.repository.list()),
      pets: summarizePetOperations(await pets.operations.list(), await pets.operations.unreadableCount()),
      reminders: summarizeReminderOperations(await reminders.operations.list(), await reminders.operations.unreadableCount()),
    }),
    total: signOutTotal,
    syncNow: async () =>
      combineSyncNow(
        await Promise.all([dailyLogs.engine.syncNow({ timeoutMs }), pets.engine.syncNow({ timeoutMs }), reminders.engine.syncNow({ timeoutMs })])
      ),
    signOut,
    clearLocalData,
  });
}
