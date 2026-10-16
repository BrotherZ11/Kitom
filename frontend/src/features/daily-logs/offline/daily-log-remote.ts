import type { SupabaseClient } from '@supabase/supabase-js';

import type { OwnerAccessToken } from '@/features/auth/owner-session';
import type { DailyLog, GeneratedSaveDailyLogArgs, SaveDailyLogArgs } from '@/features/daily-logs/types';
import type { Database } from '@/types/database.types';

import { DAILY_LOG_COLUMNS } from '../daily-log-history.ts';
import { parseDailyLogRow } from './daily-log-content.ts';

/**
 * Acceso remoto del motor de sincronización: guardar con `save_daily_log` (siempre con precondición)
 * y leer la fila de un día para reconciliar. Módulo puro: el cliente de Supabase se inyecta (se
 * prueba contra el Supabase local).
 *
 * Cada petición va autorizada como el **propietario** de las operaciones (`accessToken`, ver
 * `features/auth/owner-session.ts`): el token se pide justo antes de enviarla y se fija en su cabecera,
 * sin depender de la sesión que tenga el cliente compartido en ese instante. Sin sesión del
 * propietario no sale nada y el resultado es un 401 (`owner_session_required`): el motor espera a
 * una sesión nueva sin contar el intento.
 *
 * Nunca lanza: devuelve el error original y el `status` HTTP para clasificarlo
 * (`classifySyncError`). Sin respuesta (fetch falló o se agotó el tiempo) → `status: null`.
 * Sin reintentos propios de supabase-js (`retry(false)`): la política de reintentos es del motor.
 */

export type SyncPrecondition = { p_expected_updated_at: string } | { p_expect_absent: true };

export type RemoteResult<T> = { ok: true; data: T } | { ok: false; error: unknown; status: number | null };

export type DailyLogRemote = {
  save(args: SaveDailyLogArgs & SyncPrecondition): Promise<RemoteResult<DailyLog>>;
  fetch(petId: string, logDate: string): Promise<RemoteResult<DailyLog | null>>;
};

/** Tiempo máximo de una petición: sin él, una conexión colgada bloquearía la cola entera. */
export const REMOTE_TIMEOUT_MS = 20_000;

/** Error de una petición que no recibió respuesta a tiempo (se clasifica como red). */
const TIMEOUT_ERROR = { name: 'TimeoutError', message: 'Request timed out' };
/** Respuesta 2xx que no es una fila válida de `daily_logs`. */
const INVALID_RESPONSE = { code: 'invalid_response', message: 'Invalid response' };
/** No hay sesión del propietario: la petición no se envió. */
export const OWNER_SESSION_REQUIRED = 'owner_session_required';

type PostgrestLikeResponse<T> = { data: T | null; error: unknown; status: number };

export type DailyLogRemoteOptions = {
  /** Token de la sesión del propietario de las operaciones (`createOwnerAccessToken`). */
  accessToken: () => Promise<OwnerAccessToken>;
  timeoutMs?: number;
};

export function createDailyLogRemote(
  client: SupabaseClient<Database>,
  { accessToken, timeoutMs = REMOTE_TIMEOUT_MS }: DailyLogRemoteOptions
): DailyLogRemote {
  async function run<T, R>(
    request: (signal: AbortSignal, authorization: string) => PromiseLike<PostgrestLikeResponse<T>>,
    toData: (data: T | null) => R | undefined
  ): Promise<RemoteResult<R>> {
    const controller = new AbortController();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // El tiempo límite incluye leer la sesión (renovar el token también puede colgarse).
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        resolve('timeout');
      }, timeoutMs);
    });
    try {
      const owner = await Promise.race([
        accessToken().catch((): OwnerAccessToken => ({ status: 'unavailable' })),
        timeout,
      ]);
      if (owner === 'timeout') return { ok: false, error: TIMEOUT_ERROR, status: null };
      if (owner.status !== 'ok') {
        return { ok: false, error: { code: OWNER_SESSION_REQUIRED, details: owner.status }, status: 401 };
      }

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
    save: (args) =>
      run(
        (signal, authorization) =>
          client
            // Los tipos generados no admiten NULL en los parámetros; la RPC sí (ver `SaveDailyLogArgs`).
            .rpc('save_daily_log', args as GeneratedSaveDailyLogArgs)
            .setHeader('Authorization', authorization)
            .retry(false)
            .abortSignal(signal),
        (data) => parseDailyLogRow(data) ?? undefined
      ),

    fetch: (petId, logDate) =>
      run(
        (signal, authorization) =>
          client
            .from('daily_logs')
            .select(DAILY_LOG_COLUMNS)
            .eq('pet_id', petId)
            .eq('log_date', logDate)
            .setHeader('Authorization', authorization)
            .retry(false)
            .abortSignal(signal)
            .maybeSingle(),
        (data) => (data === null ? null : (parseDailyLogRow(data) ?? undefined))
      ),
  };
}
