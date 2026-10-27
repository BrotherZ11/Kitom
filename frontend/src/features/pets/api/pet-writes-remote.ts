import type { SupabaseClient } from '@supabase/supabase-js';

import type { OwnerAccessToken } from '@/features/auth/owner-session';
import type { Pet, PetFields } from '@/features/pets/types';
import type { Database } from '@/types/database.types';

import { toCachedPet } from '../offline/pet-snapshot.ts';
import { PET_COLUMNS } from './pets-remote.ts';

/**
 * Acceso remoto de la sincronización de altas y ediciones de mascotas (Pets offline, fase 8). Módulo
 * puro: el cliente de Supabase se inyecta (se prueba contra el Supabase local).
 *
 * - Cada petición va autorizada como el **propietario de las operaciones** (`accessToken`,
 *   `features/auth/owner-session.ts`): el token se pide justo antes y se fija en su cabecera. Sin sesión
 *   del propietario no sale nada (401 `owner_session_required`).
 * - Alta: `client_request_id` = id de la operación (migración `20261020135440`). Reenviarla da 23505 en
 *   `pets_owner_client_request_id_key` (`duplicate: true`) y la fila se lee con `findByRequestId`.
 * - Edición: solo columnas editables y con precondición `updated_at = base` (compare-and-set atómico).
 *   0 filas (`data: null`) = no se aplicó (otra versión, sin permiso o no existe): lo decide quien llama
 *   leyendo la fila.
 * - Eliminación (fase 10): con la misma precondición (`delete … eq('updated_at', base)`, una sola
 *   sentencia: si otra transacción cambia la fila, Postgres vuelve a evaluar el `WHERE` y no la borra).
 *   0 filas (`data: false`) = no se aplicó (otra versión, sin permiso o ya no existe): lo decide quien
 *   llama leyendo la fila. RLS: solo el propietario (`pets: delete owner`).
 * - Nunca toca fotos (`photo_path` no se envía; los objetos de Storage no se borran desde aquí).
 *
 * Nunca lanza: devuelve el error original y el `status` HTTP. Sin respuesta → `status: null`. Sin
 * reintentos de supabase-js: los decide el motor.
 */

export type RemoteResult<T> = { ok: true; data: T } | { ok: false; error: unknown; status: number | null };
export type CreateResult = { ok: true; data: Pet; duplicate: false } | { ok: true; duplicate: true } | Extract<RemoteResult<never>, { ok: false }>;

export type PetWritesRemote = {
  create(content: PetFields, clientRequestId: string): Promise<CreateResult>;
  /** Mascota creada con esa clave por el propietario (`null` si no hay). */
  findByRequestId(clientRequestId: string): Promise<RemoteResult<Pet | null>>;
  /** Edición con precondición; `data: null` = 0 filas (no se aplicó). */
  update(petId: string, content: PetFields, baseUpdatedAt: string): Promise<RemoteResult<Pet | null>>;
  /** Fila actual (`null` = no existe o no se ve). */
  fetch(petId: string): Promise<RemoteResult<Pet | null>>;
  /** Eliminación con precondición; `data: true` = borrada, `false` = 0 filas (no se aplicó). */
  delete(petId: string, baseUpdatedAt: string): Promise<RemoteResult<boolean>>;
};

export const REMOTE_TIMEOUT_MS = 20_000;
export const OWNER_SESSION_REQUIRED = 'owner_session_required';
export const CLIENT_REQUEST_ID_INDEX = 'pets_owner_client_request_id_key';

const TIMEOUT_ERROR = { name: 'TimeoutError', message: 'Request timed out' };
const INVALID_RESPONSE = { code: 'invalid_response', message: 'Invalid response' };

type PostgrestLikeResponse<T> = { data: T | null; error: unknown; status: number };

/** Copia solo las columnas editables (nunca `owner_id`, `id`, `photo_path` ni `is_active`). */
export function editableColumns(content: PetFields): PetFields {
  return {
    name: content.name,
    species_id: content.species_id,
    sex: content.sex,
    breed: content.breed,
    breed_id: content.breed_id,
    breed_status: content.breed_status,
    birth_date: content.birth_date,
    weight_kg: content.weight_kg,
    sterilized: content.sterilized,
    known_conditions: content.known_conditions,
    allergies: content.allergies,
    temperament_notes: content.temperament_notes,
  };
}

/** ¿Es el 23505 del índice de la clave de alta (y no otra restricción única)? */
export function isDuplicateRequest(error: unknown): boolean {
  const fields = (typeof error === 'object' && error !== null ? error : {}) as Record<string, unknown>;
  const text = [fields.message, fields.details].filter((value) => typeof value === 'string').join(' ');
  return fields.code === '23505' && text.includes(CLIENT_REQUEST_ID_INDEX);
}

export function createPetWritesRemote(
  client: SupabaseClient<Database>,
  {
    ownerUserId,
    accessToken,
    timeoutMs = REMOTE_TIMEOUT_MS,
  }: { ownerUserId: string; accessToken: () => Promise<OwnerAccessToken>; timeoutMs?: number }
): PetWritesRemote {
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

  /** Fila válida (las columnas de `PET_COLUMNS`), o `undefined` si la respuesta no lo es. */
  const asPet = (data: unknown): Pet | undefined => toCachedPet(data) ?? undefined;
  const asPetOrNull = (data: unknown): Pet | null | undefined => (data === null ? null : asPet(data));

  return {
    async create(content, clientRequestId) {
      const result = await run(
        (signal, authorization) =>
          client
            .from('pets')
            .insert({ ...editableColumns(content), owner_id: ownerUserId, client_request_id: clientRequestId })
            .select(PET_COLUMNS)
            .setHeader('Authorization', authorization)
            .abortSignal(signal)
            .single(),
        asPet
      );
      if (result.ok) return { ok: true, data: result.data, duplicate: false };
      if (isDuplicateRequest(result.error)) return { ok: true, duplicate: true };
      return result;
    },

    findByRequestId: (clientRequestId) =>
      run(
        (signal, authorization) =>
          client
            .from('pets')
            .select(PET_COLUMNS)
            // La clave es única por propietario (índice): se busca la del propietario, no se filtra visibilidad.
            .eq('client_request_id', clientRequestId)
            .eq('owner_id', ownerUserId)
            .setHeader('Authorization', authorization)
            .retry(false)
            .abortSignal(signal)
            .maybeSingle(),
        asPetOrNull
      ),

    update: (petId, content, baseUpdatedAt) =>
      run(
        (signal, authorization) =>
          client
            .from('pets')
            .update(editableColumns(content))
            .eq('id', petId)
            .eq('updated_at', baseUpdatedAt)
            .select(PET_COLUMNS)
            .setHeader('Authorization', authorization)
            .abortSignal(signal)
            .maybeSingle(),
        asPetOrNull
      ),

    fetch: (petId) =>
      run(
        (signal, authorization) =>
          client
            .from('pets')
            .select(PET_COLUMNS)
            .eq('id', petId)
            .setHeader('Authorization', authorization)
            .retry(false)
            .abortSignal(signal)
            .maybeSingle(),
        asPetOrNull
      ),

    delete: (petId, baseUpdatedAt) =>
      run(
        (signal, authorization) =>
          client
            .from('pets')
            .delete()
            .eq('id', petId)
            .eq('updated_at', baseUpdatedAt)
            .select('id')
            .setHeader('Authorization', authorization)
            .abortSignal(signal)
            .maybeSingle(),
        (data: { id: string } | null) => (data === null ? false : data.id === petId ? true : undefined)
      ),
  };
}
