import type { SupabaseClient } from '@supabase/supabase-js';

import type { OwnerAccessToken } from '@/features/auth/owner-session';
import type { ReminderContent } from '@/features/reminders/offline/reminder-operation';
import type { Reminder } from '@/features/reminders/reminder-model';
import type { Database } from '@/types/database.types';

import { toCachedReminder } from '../offline/reminder-operation.ts';
import { REMINDER_COLUMNS } from '../reminder-model.ts';
import { DONE_RETENTION_DAYS, REMINDER_QUERY_LIMIT } from './reminders-remote.ts';

/**
 * Acceso remoto de la agenda sin conexión (fase 14). Módulo puro: el cliente se inyecta (se prueba contra el
 * Supabase local). Cada petición va autorizada como el **dueño de las operaciones** (`accessToken`): sin su
 * sesión no sale nada (401 `owner_session_required`).
 *
 * - Alta: `client_request_id` = id de la operación (migración `20261105093545`). Reenviarla da 23505 en
 *   `reminders_creator_client_request_id_key` (`duplicate: true`) y la fila se lee por su clave.
 * - Edición y eliminación: con precondición `updated_at = base`. 0 filas = no se aplicó: lo decide quien llama
 *   leyendo la fila. Nunca se envían `id`, `pet_id` (al editar), `created_by` ni `updated_at`.
 *
 * Nunca lanza: devuelve el error original y el `status`. Sin respuesta → `status: null`.
 */

export type RemoteResult<T> = { ok: true; data: T } | { ok: false; error: unknown; status: number | null };
export type ReminderCreateResult =
  | { ok: true; data: Reminder; duplicate: false }
  | { ok: true; duplicate: true }
  | Extract<RemoteResult<never>, { ok: false }>;

export type ReminderWritesRemote = {
  create(petId: string, content: ReminderContent, clientRequestId: string): Promise<ReminderCreateResult>;
  findByRequestId(clientRequestId: string): Promise<RemoteResult<Reminder | null>>;
  update(reminderId: string, content: ReminderContent, baseUpdatedAt: string): Promise<RemoteResult<Reminder | null>>;
  fetch(reminderId: string): Promise<RemoteResult<Reminder | null>>;
  delete(reminderId: string, baseUpdatedAt: string): Promise<RemoteResult<boolean>>;
  /** Solo para no pedir que resuelva un conflicto a quien ya no puede escribir. */
  canEdit(petId: string): Promise<RemoteResult<boolean>>;
};

export type ReminderReadsRemote = {
  petReminders(petId: string, now?: Date): Promise<Reminder[]>;
  pendingReminders(): Promise<Reminder[]>;
  upcomingReminders(now?: Date): Promise<Reminder[]>;
  reminder(reminderId: string): Promise<Reminder | null>;
};

export const REMINDER_REMOTE_TIMEOUT_MS = 20_000;
export const OWNER_SESSION_REQUIRED = 'owner_session_required';
export const REMINDER_REQUEST_ID_INDEX = 'reminders_creator_client_request_id_key';

const TIMEOUT_ERROR = { name: 'TimeoutError', message: 'Request timed out' };
const INVALID_RESPONSE = { code: 'invalid_response', message: 'Invalid response' };

type PostgrestLikeResponse<T> = { data: T | null; error: unknown; status: number };

/** Copia solo las columnas que escribe la app. */
export function writableColumns(content: ReminderContent): ReminderContent {
  return {
    type: content.type,
    title: content.title,
    description: content.description,
    due_at: content.due_at,
    recurrence_rule: content.recurrence_rule,
    snooze_until: content.snooze_until,
    status: content.status,
    completed_at: content.completed_at,
    is_active: content.is_active,
  };
}

/** ¿Es el 23505 del índice de la clave de alta (y no otra restricción)? */
export function isDuplicateReminderRequest(error: unknown): boolean {
  const fields = (typeof error === 'object' && error !== null ? error : {}) as Record<string, unknown>;
  const text = [fields.message, fields.details].filter((value) => typeof value === 'string').join(' ');
  return fields.code === '23505' && text.includes(REMINDER_REQUEST_ID_INDEX);
}

const asReminder = (data: unknown): Reminder | undefined => toCachedReminder(data) ?? undefined;
const asReminderOrNull = (data: unknown): Reminder | null | undefined => (data === null ? null : asReminder(data));

export function createReminderWritesRemote(
  client: SupabaseClient<Database>,
  {
    ownerUserId,
    accessToken,
    timeoutMs = REMINDER_REMOTE_TIMEOUT_MS,
  }: { ownerUserId: string; accessToken: () => Promise<OwnerAccessToken>; timeoutMs?: number }
): ReminderWritesRemote {
  async function run<T, R>(
    request: (signal: AbortSignal, authorization: string) => PromiseLike<PostgrestLikeResponse<T>>,
    toData: (data: T | null) => R | undefined
  ): Promise<RemoteResult<R>> {
    const controller = new AbortController();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        resolve('timeout');
      }, timeoutMs);
    });
    try {
      const owner = await Promise.race([accessToken().catch((): OwnerAccessToken => ({ status: 'unavailable' })), timeout]);
      if (owner === 'timeout') return { ok: false, error: TIMEOUT_ERROR, status: null };
      if (owner.status !== 'ok') return { ok: false, error: { code: OWNER_SESSION_REQUIRED, details: owner.status }, status: 401 };
      const { data, error, status } = await request(controller.signal, `Bearer ${owner.token}`);
      if (timedOut) return { ok: false, error: TIMEOUT_ERROR, status: null };
      if (error) return { ok: false, error, status: status >= 100 ? status : null };
      const value = toData(data);
      if (value === undefined) return { ok: false, error: INVALID_RESPONSE, status };
      return { ok: true, data: value };
    } catch (error) {
      return { ok: false, error: timedOut ? TIMEOUT_ERROR : error, status: null };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async create(petId, content, clientRequestId) {
      const result = await run(
        (signal, authorization) =>
          client
            .from('reminders')
            .insert({ ...writableColumns(content), pet_id: petId, created_by: ownerUserId, client_request_id: clientRequestId })
            .select(REMINDER_COLUMNS)
            .setHeader('Authorization', authorization)
            .abortSignal(signal)
            .single(),
        asReminder
      );
      if (result.ok) return { ok: true, data: result.data, duplicate: false };
      if (isDuplicateReminderRequest(result.error)) return { ok: true, duplicate: true };
      return result;
    },

    findByRequestId: (clientRequestId) =>
      run(
        (signal, authorization) =>
          client
            .from('reminders')
            .select(REMINDER_COLUMNS)
            .eq('client_request_id', clientRequestId)
            .eq('created_by', ownerUserId)
            .setHeader('Authorization', authorization)
            .retry(false)
            .abortSignal(signal)
            .maybeSingle(),
        asReminderOrNull
      ),

    update: (reminderId, content, baseUpdatedAt) =>
      run(
        (signal, authorization) =>
          client
            .from('reminders')
            .update(writableColumns(content))
            .eq('id', reminderId)
            .eq('updated_at', baseUpdatedAt)
            .select(REMINDER_COLUMNS)
            .setHeader('Authorization', authorization)
            .abortSignal(signal)
            .maybeSingle(),
        asReminderOrNull
      ),

    fetch: (reminderId) =>
      run(
        (signal, authorization) =>
          client
            .from('reminders')
            .select(REMINDER_COLUMNS)
            .eq('id', reminderId)
            .setHeader('Authorization', authorization)
            .retry(false)
            .abortSignal(signal)
            .maybeSingle(),
        asReminderOrNull
      ),

    delete: (reminderId, baseUpdatedAt) =>
      run(
        (signal, authorization) =>
          client
            .from('reminders')
            .delete()
            .eq('id', reminderId)
            .eq('updated_at', baseUpdatedAt)
            .select('id')
            .setHeader('Authorization', authorization)
            .abortSignal(signal)
            .maybeSingle(),
        (data: { id: string } | null) => (data === null ? false : data.id === reminderId ? true : undefined)
      ),

    canEdit: (petId) =>
      run(
        (signal, authorization) =>
          client.rpc('can_edit_pet', { target_pet_id: petId }).setHeader('Authorization', authorization).abortSignal(signal),
        (data: boolean | null) => (typeof data === 'boolean' ? data : undefined)
      ),
  };
}

/** Lecturas de la agenda con el token del dueño. Lanzan el error de supabase-js tal cual. */
export function createReminderReadsRemote(
  client: SupabaseClient<Database>,
  { accessToken }: { accessToken: () => Promise<OwnerAccessToken> }
): ReminderReadsRemote {
  const authorization = async (): Promise<string> => {
    const owner = await accessToken().catch((): OwnerAccessToken => ({ status: 'unavailable' }));
    if (owner.status !== 'ok') throw Object.assign(new Error(OWNER_SESSION_REQUIRED), { name: 'SessionUnavailableError' });
    return `Bearer ${owner.token}`;
  };

  return {
    async petReminders(petId, now = new Date()) {
      const header = await authorization();
      const since = new Date(now.getTime() - DONE_RETENTION_DAYS * 86_400_000).toISOString();
      const { data, error } = await client
        .from('reminders')
        .select(REMINDER_COLUMNS)
        .eq('pet_id', petId)
        .or(`status.eq.pending,completed_at.gte."${since}"`)
        .order('due_at', { ascending: true })
        .limit(REMINDER_QUERY_LIMIT)
        .setHeader('Authorization', header);
      if (error) throw error;
      return data;
    },

    async pendingReminders() {
      const header = await authorization();
      const { data, error } = await client
        .from('reminders')
        .select(REMINDER_COLUMNS)
        .eq('status', 'pending')
        .order('due_at', { ascending: true })
        .limit(REMINDER_QUERY_LIMIT)
        .setHeader('Authorization', header);
      if (error) throw error;
      return data;
    },

    async upcomingReminders(now = new Date()) {
      const header = await authorization();
      const at = now.toISOString();
      const { data, error } = await client
        .from('reminders')
        .select(REMINDER_COLUMNS)
        .eq('status', 'pending')
        .eq('is_active', true)
        .or(`due_at.gt."${at}",snooze_until.gt."${at}"`)
        .order('due_at', { ascending: true })
        .limit(REMINDER_QUERY_LIMIT)
        .setHeader('Authorization', header);
      if (error) throw error;
      return data;
    },

    async reminder(reminderId) {
      const header = await authorization();
      const { data, error } = await client
        .from('reminders')
        .select(REMINDER_COLUMNS)
        .eq('id', reminderId)
        .setHeader('Authorization', header)
        .maybeSingle();
      if (error) {
        if (error.code === '22P02') return null;
        throw error;
      }
      return data;
    },
  };
}
