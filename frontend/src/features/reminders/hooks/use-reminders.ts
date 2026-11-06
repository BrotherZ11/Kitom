import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

import { useAuth } from '@/features/auth/auth-context';
import { createOwnerAccessToken } from '@/features/auth/owner-session';
import { localQueryOptions } from '@/features/daily-logs/offline/daily-log-cache';
import { useCanEditPet } from '@/features/pets/hooks/use-pets';
import { isLocalPetId } from '@/features/pets/offline/pet-operation';
import { createReminderReadsRemote } from '@/features/reminders/api/reminder-writes-remote';
import { REMINDER_QUERY_LIMIT } from '@/features/reminders/api/reminders-remote';
import { reminderCacheFor } from '@/features/reminders/offline/device-reminder-cache';
import { petScope, type ReminderScope } from '@/features/reminders/offline/reminder-cache-repository';
import {
  isLocalReminderId,
  reminderSyncDisplay,
  operationFor,
  type LocalReminderOperation,
  type ReminderContent,
  type ReminderSyncDisplay,
} from '@/features/reminders/offline/reminder-operation';
import { ReminderEditRejectedError } from '@/features/reminders/offline/reminder-sync-engine';
import { resolveReminderDetailView, resolveReminderListView, resolveReminderPermission } from '@/features/reminders/offline/reminder-view';
import { reminderKeys } from '@/features/reminders/query-keys';
import {
  isReminderActive,
  planCompletion,
  snoozeUntil,
  type Reminder,
  type ReminderWrite,
  type SnoozeOption,
} from '@/features/reminders/reminder-model';
import { useReminderSync, useReminderSyncingKey } from '@/features/reminders/sync/reminder-sync-provider';
import { useIsOnline } from '@/hooks/use-is-online';
import { isNetworkError } from '@/lib/server-errors';
import { supabase } from '@/lib/supabase';

/**
 * Agenda con TanStack Query, copia en el dispositivo y operaciones locales (fase 14; `docs/FRONTEND_ARCHITECTURE.md`
 * §5 «Agenda sin conexión»). Lecturas: solo con sesión utilizable, con el token del dueño, y cada respuesta correcta
 * pasa por la copia local; sin servidor, la copia. Escrituras: **siempre primero en el dispositivo**; las envía el
 * motor (`offline/reminder-sync-engine.ts`). Un id `local-…` nunca se pide al servidor. Con conexión, la acción
 * espera brevemente a la confirmación (`SUBMIT_WAIT_MS`) para decir si ya quedó hecha allí.
 */

/** Cuánto espera una acción a que el servidor confirme antes de decir «guardado en este dispositivo». */
export const SUBMIT_WAIT_MS = 5_000;

const reads = new Map<string, ReturnType<typeof createReminderReadsRemote>>();
function readsFor(userId: string) {
  let remote = reads.get(userId);
  if (!remote) {
    remote = createReminderReadsRemote(supabase, { accessToken: createOwnerAccessToken(supabase.auth, userId) });
    reads.set(userId, remote);
  }
  return remote;
}

function useReminderSession() {
  const auth = useAuth();
  const online = useIsOnline();
  const userId = auth.user?.id ?? '';
  return { auth, userId, serverUsable: auth.canUseServer && online };
}

/** Operaciones del dispositivo del usuario (lectura local). */
export function useReminderOperations() {
  const { userId, operations } = useReminderSync();
  const query = useQuery({
    queryKey: reminderKeys.operations(userId),
    queryFn: () => operations.list(),
    ...localQueryOptions,
  });
  return { ...query, syncingKey: useReminderSyncingKey() };
}

/** Resultado común de los listados: la vista, las filas y el estado local de cada una. */
function useScopedReminders({
  queryKey,
  scope,
  read,
  enabled,
  includeCreate,
  filter,
}: {
  queryKey: readonly unknown[];
  scope: ReminderScope;
  read: (userId: string) => Promise<Reminder[]>;
  enabled: boolean;
  includeCreate: (op: LocalReminderOperation) => boolean;
  filter?: (reminder: Reminder) => boolean;
}) {
  const queryClient = useQueryClient();
  const { auth, userId, serverUsable } = useReminderSession();
  const operations = useReminderOperations();
  const remote = useQuery({
    queryKey,
    enabled: enabled && auth.canUseServer && userId !== '',
    queryFn: async () => {
      const cache = reminderCacheFor(userId);
      const mark = cache.beginRead();
      const rows = await auth.serverCall(() => read(userId));
      if (!auth.isCurrentUser(userId)) return rows;
      const shown = await cache.applyScope(mark, scope, rows, { complete: rows.length < REMINDER_QUERY_LIMIT });
      void queryClient.invalidateQueries({ queryKey: reminderKeys.local(userId) });
      return shown;
    },
  });
  const needsLocal = enabled && remote.data === undefined && (remote.isError || !serverUsable);
  const local = useQuery({
    queryKey: reminderKeys.localScope(userId, scope),
    enabled: userId !== '' && needsLocal,
    queryFn: () => reminderCacheFor(userId).readScope(scope),
    ...localQueryOptions,
  });
  const view = resolveReminderListView({
    remote: { ...remote, partial: (remote.data?.length ?? 0) >= REMINDER_QUERY_LIMIT },
    local,
    ops: operations.data,
    serverUsable,
    isOfflineError: isNetworkError,
    includeCreate,
    filter,
  });
  const { syncingKey } = operations;
  return {
    view,
    data: view.state === 'ready' ? view.reminders : undefined,
    /** Estado local de una fila (`null` = sin cambios en el dispositivo). */
    displayOf: (id: string): ReminderSyncDisplay | null => {
      const op = operationFor(operations.data, id);
      return reminderSyncDisplay(op, syncingKey !== null && syncingKey === op?.localId);
    },
    refetch: () => {
      if (local.isError) void local.refetch();
      if (operations.isError) void operations.refetch();
      if (auth.status === 'offline') void auth.recoverSession();
      else if (auth.canUseServer) void remote.refetch();
    },
  };
}

/** Agenda de una mascota. Una mascota aún sin crear en el servidor (id local) no tiene. */
export function usePetReminders(petId: string) {
  return useScopedReminders({
    queryKey: reminderKeys.pet(useReminderSession().userId, petId),
    scope: petScope(petId),
    read: (userId) => readsFor(userId).petReminders(petId),
    enabled: !isLocalPetId(petId),
    includeCreate: (op) => op.petId === petId,
  });
}

/** Pendientes de todas las mascotas visibles, vencidos incluidos (listado general). */
export function usePendingReminders() {
  return useScopedReminders({
    queryKey: reminderKeys.pending(useReminderSession().userId),
    scope: 'pending',
    read: (userId) => readsFor(userId).pendingReminders(),
    enabled: true,
    includeCreate: () => true,
    filter: (reminder) => reminder.status === 'pending',
  });
}

/** Pendientes que aún tienen que sonar (avisos del dispositivo), también sin conexión. */
export function useUpcomingReminders(enabled: boolean) {
  return useScopedReminders({
    queryKey: reminderKeys.upcoming(useReminderSession().userId),
    scope: 'upcoming',
    read: (userId) => readsFor(userId).upcomingReminders(),
    enabled,
    includeCreate: () => true,
    filter: (reminder) => reminder.status === 'pending' && isReminderActive(reminder),
  });
}

/** Detalle (también por id local). `view` distingue «no existe» de «no disponible sin conexión». */
export function useReminder(reminderId: string) {
  const queryClient = useQueryClient();
  const { auth, userId, serverUsable } = useReminderSession();
  const operations = useReminderOperations();
  const isLocal = isLocalReminderId(reminderId);
  const remote = useQuery({
    queryKey: reminderKeys.detail(userId, reminderId),
    enabled: auth.canUseServer && userId !== '' && !isLocal,
    queryFn: async () => {
      const cache = reminderCacheFor(userId);
      const mark = cache.beginRead();
      const row = await auth.serverCall(() => readsFor(userId).reminder(reminderId));
      if (!auth.isCurrentUser(userId)) return row;
      const shown = await cache.applyReminder(mark, reminderId, row);
      void queryClient.invalidateQueries({ queryKey: reminderKeys.local(userId) });
      return shown;
    },
  });
  const needsLocal = !isLocal && remote.data === undefined && (remote.isError || !serverUsable);
  const local = useQuery({
    queryKey: reminderKeys.localDetail(userId, reminderId),
    enabled: userId !== '' && needsLocal,
    queryFn: () => reminderCacheFor(userId).readReminder(reminderId),
    ...localQueryOptions,
  });
  const view = resolveReminderDetailView({
    id: reminderId,
    remote,
    local,
    ops: operations.data,
    opsError: operations.error,
    syncingKey: operations.syncingKey,
    serverUsable,
    isOfflineError: isNetworkError,
  });
  return {
    view,
    refetch: () => {
      if (local.isError) void local.refetch();
      if (operations.isError) void operations.refetch();
      if (auth.status === 'offline') void auth.recoverSession();
      else if (auth.canUseServer && !isLocal) void remote.refetch();
    },
  };
}

/**
 * ¿Se ofrecen las acciones de la agenda de esta mascota? Del servidor si responde; si no, el último `can_edit_pet`
 * confirmado en este dispositivo; sin valor conocido, solo lectura. **Solo una indicación de interfaz:** nunca
 * autoriza nada. Si el permiso se revocó, RLS rechaza al sincronizar y la operación se conserva.
 */
export function useReminderPermission(petId: string) {
  const queryClient = useQueryClient();
  const { auth, userId, serverUsable } = useReminderSession();
  const canEdit = useCanEditPet(petId);
  const isLocal = isLocalPetId(petId);
  const confirmed = canEdit.data;
  useEffect(() => {
    if (confirmed === undefined || isLocal || !auth.isCurrentUser(userId)) return;
    void reminderCacheFor(userId)
      .applyPermission(petId, confirmed)
      .then(() => queryClient.invalidateQueries({ queryKey: reminderKeys.localPermission(userId, petId) }));
  }, [confirmed, isLocal, petId, userId, auth, queryClient]);
  const stored = useQuery({
    queryKey: reminderKeys.localPermission(userId, petId),
    enabled: userId !== '' && !isLocal,
    queryFn: () => reminderCacheFor(userId).readPermission(petId),
    ...localQueryOptions,
  });
  return {
    permission: resolveReminderPermission({
      remote: confirmed,
      remoteLoading: serverUsable && canEdit.isPending && !isLocal,
      stored: stored.data,
      storedLoading: stored.isPending && !isLocal,
    }),
    refetch: () => void canEdit.refetch(),
  };
}

/** Resultado de una acción: `synced` si el servidor ya la tiene; si no, su estado en el dispositivo. */
export type ReminderSaveOutcome = { synced: boolean; display: ReminderSyncDisplay | null };

function useWrites() {
  const { engine, operations, userId } = useReminderSync();
  const { serverUsable } = useReminderSession();

  /** Alta ya confirmada: las acciones van con el id del servidor. */
  const liveId = async (id: string): Promise<string> => {
    if (!isLocalReminderId(id)) return id;
    const op = await operations.read(id);
    return op?.status === 'synced' && op.reminderId ? op.reminderId : id;
  };

  const settle = async (localId: string): Promise<ReminderSaveOutcome> => {
    if (serverUsable) await engine.syncFor(SUBMIT_WAIT_MS);
    const op = await operations.read(localId);
    if (!op || op.status === 'synced') return { synced: true, display: null };
    return { synced: false, display: reminderSyncDisplay(op, false) };
  };

  /** Edita sobre la versión que se ve. Sin operación, esa fila es la base (la precondición detecta cambios). */
  const edit = async (reminder: Reminder, patch: Partial<ReminderContent>): Promise<ReminderSaveOutcome> => {
    const id = await liveId(reminder.id);
    const saved = await engine.saveEdit(id, patch, isLocalReminderId(reminder.id) ? null : reminder);
    if (!saved) return { synced: true, display: null };
    return settle(saved.localId);
  };

  /** Deshacer: mismo camino que una edición, sobre lo último que se sabe de la fila. */
  const undo = async (reminder: Reminder, patch: Partial<ReminderContent>) => {
    const id = await liveId(reminder.id);
    const known = isLocalReminderId(id) ? null : ((await reminderCacheFor(userId).readReminder(id).catch(() => null))?.reminder ?? reminder);
    await engine.saveEdit(id, patch, known);
  };

  return { engine, settle, edit, undo };
}

/** Columnas de un alta. `completed_at` y el aplazamiento, vacíos; activo. */
function contentForNew(values: ReminderWrite): ReminderContent {
  return { ...values, snooze_until: null, status: 'pending', completed_at: null, is_active: true };
}

export function useCreateReminder(petId: string) {
  const { engine, settle } = useWrites();
  return useMutation({
    mutationFn: async (values: ReminderWrite) => {
      const saved = await engine.saveCreate(petId, contentForNew(values));
      return settle(saved.localId);
    },
  });
}

/** Editar desde el formulario. Cambiar la fecha o la repetición anula un aplazamiento anterior. */
export function useEditReminder(reminder: Reminder | null) {
  const { edit } = useWrites();
  return useMutation({
    mutationFn: (values: ReminderWrite) => {
      if (!reminder) throw new ReminderEditRejectedError('not_editable');
      return edit(reminder, { ...values, snooze_until: null });
    },
  });
}

export type CompletionResult = ReminderSaveOutcome & { undo: () => Promise<void>; next: Date | null };

/**
 * «Hecho»: sin repetición pasa a hecho y conserva la hora real aunque se envíe después (`completed_at`); con
 * repetición avanza a la próxima vez (`planCompletion`). Devuelve cómo deshacerlo.
 */
export function useCompleteReminder() {
  const { edit, undo } = useWrites();
  return useMutation({
    mutationFn: async (reminder: Reminder): Promise<CompletionResult> => {
      const now = new Date();
      const plan = planCompletion(reminder, now);
      const patch: Partial<ReminderContent> =
        plan.kind === 'complete' ? { status: 'completed', completed_at: now.toISOString() } : plan.patch;
      const reverse: Partial<ReminderContent> = plan.kind === 'complete' ? { status: 'pending', completed_at: null } : plan.undo;
      const outcome = await edit(reminder, patch);
      return { ...outcome, undo: () => undo(reminder, reverse), next: plan.kind === 'advance' ? plan.next : null };
    },
  });
}

/** Volver a pendiente uno hecho. */
export function useReopenReminder() {
  const { edit } = useWrites();
  return useMutation({
    mutationFn: (reminder: Reminder) => edit(reminder, { status: 'pending', completed_at: null }),
  });
}

export type ActiveResult = ReminderSaveOutcome & { undo: () => Promise<void> };

/** Activar o desactivar (`is_active`): no toca `status`. Con «Deshacer». */
export function useSetReminderActive() {
  const { edit, undo } = useWrites();
  return useMutation({
    mutationFn: async ({ reminder, active }: { reminder: Reminder; active: boolean }): Promise<ActiveResult> => {
      const outcome = await edit(reminder, { is_active: active });
      return { ...outcome, undo: () => undo(reminder, { is_active: !active }) };
    },
  });
}

export type SnoozeResult = ReminderSaveOutcome & { until: Date };

export function useSnoozeReminder() {
  const { edit } = useWrites();
  return useMutation({
    mutationFn: async ({ reminder, option }: { reminder: Reminder; option: SnoozeOption }): Promise<SnoozeResult> => {
      const until = snoozeUntil(option, reminder, new Date());
      return { ...(await edit(reminder, { snooze_until: until.toISOString() })), until };
    },
  });
}

/** Eliminar: se guarda en el dispositivo y lo envía el motor con precondición. Se puede deshacer hasta enviarlo. */
export function useDeleteReminder() {
  const { engine, settle } = useWrites();
  return useMutation({
    mutationFn: async (reminder: Reminder): Promise<ReminderSaveOutcome & { undone: boolean }> => {
      const request = await engine.requestDelete(reminder.id, isLocalReminderId(reminder.id) ? null : reminder);
      if (request.result === 'cancelled') return { synced: true, display: null, undone: false };
      if (request.result === 'rejected') throw new ReminderEditRejectedError('not_editable');
      return { ...(await settle(request.op.localId)), undone: false };
    },
  });
}

export function useReminderSyncActions() {
  const { engine } = useReminderSync();
  return useMemo(
    () => ({
      retry: (localId: string) => engine.retry(localId),
      discard: (localId: string) => engine.discard(localId),
      undoDelete: (localId: string) => engine.undoDelete(localId),
      resolveConflict: (localId: string, input: { choice: 'local' | 'remote'; shownRemote: Reminder }) => engine.resolveConflict(localId, input),
      resolveDeleteConflict: (localId: string, input: { decision: 'keep' | 'delete'; shownRemote: Reminder }) =>
        engine.resolveDeleteConflict(localId, input),
    }),
    [engine]
  );
}
