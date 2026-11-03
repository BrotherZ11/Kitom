// =====================================================================
// KITOM · delete-account: Auth, PostgREST y Storage por HTTP
// =====================================================================
// Las mismas llamadas que haría supabase-js, con `fetch`, para que el mismo
// código corra en Deno y en las pruebas de Node contra el Supabase local.
// - Auth y datos del usuario: clave anónima + el JWT del usuario (RLS y las
//   RPC autorizan cada operación como en la app).
// - Admin: la clave de servicio (SUPABASE_SERVICE_ROLE_KEY), solo para
//   borrar el usuario de Auth; nunca sale de aquí.
// Los errores son códigos, nunca el mensaje del servidor, la URL ni claves.
// =====================================================================
import {
  AVATARS_BUCKET,
  GatewayError,
  isUuid,
  type AdminGateway,
  type AuthGateway,
  type OwnedPet,
  type PetMember,
  type TokenCheck,
  type UserGateway,
} from './deletion.ts';

export type RestConfig = { url: string; apiKey: string; fetch?: typeof fetch; timeoutMs?: number };

const REQUEST_TIMEOUT_MS = 15_000;
const LIST_PAGE = 1000;
/** Profundidad máxima de carpetas dentro de `avatars/{user_id}/` (la app usa una sola). */
const MAX_FOLDER_DEPTH = 5;
const REMOVE_CHUNK = 100;

function base(url: string): string {
  return url.replace(/\/+$/, '');
}

async function send(config: RestConfig, path: string, init: { method: string; bearer: string; body?: unknown; headers?: Record<string, string> }) {
  const doFetch = config.fetch ?? fetch;
  try {
    return await doFetch(`${base(config.url)}${path}`, {
      method: init.method,
      headers: {
        apikey: config.apiKey,
        Authorization: `Bearer ${init.bearer}`,
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...init.headers,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(config.timeoutMs ?? REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new GatewayError('network');
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** Código seguro de una respuesta con error de PostgREST: su `hint` estable o el código SQL. */
async function restErrorCode(response: Response, prefix: string): Promise<string> {
  const body = (await readJson(response)) as { code?: unknown; hint?: unknown } | null;
  if (typeof body?.hint === 'string' && /^[a-z_]{1,64}$/.test(body.hint)) return `${prefix}_${body.hint}`;
  if (typeof body?.code === 'string' && /^[0-9A-Z]{5}$/.test(body.code)) return `${prefix}_${body.code.toLowerCase()}`;
  return `${prefix}_http_${response.status}`;
}

/** Usuario de un JWT (GET /auth/v1/user con la clave anónima). */
export function createRestAuth(config: RestConfig): AuthGateway {
  return {
    async userFromToken(token: string): Promise<TokenCheck> {
      const response = await send(config, '/auth/v1/user', { method: 'GET', bearer: token });
      const body = (await readJson(response)) as { id?: unknown; code?: unknown; error_code?: unknown } | null;
      if (response.ok) return isUuid(body?.id) ? { status: 'ok', userId: body.id.toLowerCase() } : { status: 'invalid' };
      // JWT bien firmado y vigente cuyo usuario ya no existe (cuenta borrada).
      if (body?.error_code === 'user_not_found' || body?.code === 'user_not_found') return { status: 'not_found' };
      if (response.status === 401 || response.status === 403) return { status: 'invalid' };
      throw new GatewayError(`auth_http_${response.status}`);
    },
  };
}

/** Datos del usuario con su JWT: `config.apiKey` es la clave anónima. */
export function createRestUserGateway(config: RestConfig & { token: string }): UserGateway {
  const bearer = config.token;

  const rest = async (path: string, init: { method: string; body?: unknown; headers?: Record<string, string> }) => {
    const response = await send(config, path, { ...init, bearer });
    if (!response.ok) throw new GatewayError(await restErrorCode(response, 'rest'));
    return response;
  };

  const rpc = async (name: string, args: Record<string, unknown>) => {
    const response = await send(config, `/rest/v1/rpc/${name}`, { method: 'POST', bearer, body: args });
    if (!response.ok) throw new GatewayError(await restErrorCode(response, 'rpc'));
    return readJson(response);
  };

  const storage = (path: string, body: unknown, method = 'POST') => send(config, `/storage/v1/${path}`, { method, bearer, body });

  /** Nombres (rutas completas) bajo `prefix`, entrando en subcarpetas. */
  const listFolder = async (prefix: string, depth: number): Promise<string[]> => {
    const names: string[] = [];
    for (let offset = 0; ; offset += LIST_PAGE) {
      const response = await storage(`object/list/${AVATARS_BUCKET}`, {
        prefix,
        limit: LIST_PAGE,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      });
      if (!response.ok) {
        const body = (await readJson(response)) as { error?: unknown; message?: unknown } | null;
        // Sin bucket (p. ej. un Supabase local sin `avatars`) no hay nada que borrar.
        if (body?.error === 'Bucket not found' || body?.message === 'Bucket not found') return [];
        throw new GatewayError(`storage_http_${response.status}`);
      }
      const items = await readJson(response);
      if (!Array.isArray(items)) throw new GatewayError('storage_bad_response');
      for (const item of items as { name?: unknown; id?: unknown }[]) {
        if (typeof item.name !== 'string' || item.name === '' || item.name.includes('..')) continue;
        const path = `${prefix}/${item.name}`;
        // Una carpeta (sin id): se recorre; los ficheros, a la lista.
        if (item.id === null || item.id === undefined) {
          if (depth >= MAX_FOLDER_DEPTH) throw new GatewayError('storage_too_deep');
          names.push(...(await listFolder(path, depth + 1)));
        } else {
          names.push(path);
        }
      }
      if (items.length < LIST_PAGE) return names;
    }
  };

  return {
    async ownedPets(userId, limit): Promise<OwnedPet[]> {
      const response = await rest(
        `/rest/v1/pets?select=id,name&owner_id=eq.${encodeURIComponent(userId)}&order=created_at.asc,id.asc&limit=${limit}`,
        { method: 'GET' }
      );
      const rows = await readJson(response);
      if (!Array.isArray(rows)) throw new GatewayError('rest_bad_response');
      return rows.map((row: { id: string; name: string }) => ({ id: row.id, name: row.name }));
    },

    async petMembers(petId): Promise<PetMember[]> {
      const rows = await rpc('get_pet_members', { target_pet_id: petId });
      if (!Array.isArray(rows)) throw new GatewayError('rpc_bad_response');
      return rows as PetMember[];
    },

    async sharedPetIds(userId): Promise<string[]> {
      const response = await rest(
        `/rest/v1/pet_co_owners?select=pet_id&user_id=eq.${encodeURIComponent(userId)}&status=eq.accepted`,
        { method: 'GET' }
      );
      const rows = await readJson(response);
      if (!Array.isArray(rows)) throw new GatewayError('rest_bad_response');
      return rows.map((row: { pet_id: string }) => row.pet_id);
    },

    async transferPet(petId, newOwnerId) {
      await rpc('transfer_pet_ownership', { target_pet_id: petId, new_owner_id: newOwnerId });
    },

    async deletePet(petId, userId) {
      const response = await rest(
        `/rest/v1/pets?id=eq.${encodeURIComponent(petId)}&owner_id=eq.${encodeURIComponent(userId)}&select=id`,
        { method: 'DELETE', headers: { Prefer: 'return=representation' } }
      );
      const rows = await readJson(response);
      if (!Array.isArray(rows)) throw new GatewayError('rest_bad_response');
      return rows.length > 0;
    },

    listAvatars: (userId) => listFolder(userId, 1),

    async removeAvatars(names) {
      let removed = 0;
      for (let i = 0; i < names.length; i += REMOVE_CHUNK) {
        // DELETE /storage/v1/object/{bucket} con { prefixes }: lo que hace `storage.from(bucket).remove(names)`.
        const response = await storage(`object/${AVATARS_BUCKET}`, { prefixes: names.slice(i, i + REMOVE_CHUNK) }, 'DELETE');
        if (!response.ok) {
          await response.body?.cancel();
          throw new GatewayError(`storage_http_${response.status}`);
        }
        const deleted = await readJson(response);
        if (!Array.isArray(deleted)) throw new GatewayError('storage_bad_response');
        removed += deleted.length;
      }
      return removed;
    },
  };
}

/** Borrado del usuario de Auth: `config.apiKey` es la clave de servicio. */
export function createRestAdmin(config: RestConfig): AdminGateway {
  return {
    async deleteUser(userId) {
      if (!isUuid(userId)) throw new GatewayError('invalid_user_id');
      const response = await send(config, `/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
        method: 'DELETE',
        bearer: config.apiKey,
      });
      await response.body?.cancel();
      if (response.ok) return 'deleted';
      if (response.status === 404) return 'not_found';
      throw new GatewayError(`auth_admin_http_${response.status}`);
    },
  };
}
