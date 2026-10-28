// =====================================================================
// KITOM · pet-storage-cleanup: RPC (PostgREST) y Storage por HTTP
// =====================================================================
// Las mismas llamadas que haría supabase-js (`rpc`, `storage.from().remove`),
// con `fetch` para que el mismo código corra en Deno y en las pruebas de Node
// contra el Supabase local. Con la clave de servicio, que la plataforma da a la
// función (SUPABASE_SERVICE_ROLE_KEY) y nunca sale de aquí: los errores son
// códigos, nunca el mensaje ni la URL.
// =====================================================================
import {
  BUCKET,
  CleanupRpcError,
  LOCK_LOST,
  PET_EXISTS,
  PHOTO_PATH_UNCHECKED,
  STORAGE_NOT_VISIBLE,
  StorageRemoveError,
  type AuditRow,
  type CandidateObject,
  type ClaimedJob,
  type CleanupDb,
  type CleanupStorage,
  type ErrorCode,
  type JobStatus,
  type PreviewRow,
} from './cleanup.ts';

export type RestConfig = { url: string; serviceKey: string; fetch?: typeof fetch; timeoutMs?: number };

const REQUEST_TIMEOUT_MS = 15_000;

function settings(config: RestConfig) {
  return {
    base: config.url.replace(/\/+$/, ''),
    doFetch: config.fetch ?? fetch,
    timeoutMs: config.timeoutMs ?? REQUEST_TIMEOUT_MS,
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
      'Content-Type': 'application/json',
    },
  };
}

/** Código seguro de un error de PostgREST: los nuestros por su nombre; el resto, por su código SQL. */
async function rpcErrorCode(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { code?: unknown; message?: unknown; hint?: unknown };
    for (const known of [LOCK_LOST, PET_EXISTS, STORAGE_NOT_VISIBLE, PHOTO_PATH_UNCHECKED]) {
      if (body.hint === known || body.message === known) return known;
    }
    if (typeof body.code === 'string' && /^[0-9A-Z]{5}$/.test(body.code)) return `rpc_${body.code.toLowerCase()}`;
  } catch {
    // Sin cuerpo JSON: solo el estado HTTP.
  }
  return `rpc_http_${response.status}`;
}

export function createRestCleanupDb(config: RestConfig): CleanupDb {
  const { base, doFetch, timeoutMs, headers } = settings(config);

  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    let response: Response;
    try {
      response = await doFetch(`${base}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new CleanupRpcError('rpc_network');
    }
    if (!response.ok) throw new CleanupRpcError(await rpcErrorCode(response));
    return (await response.json()) as T;
  }

  return {
    claim: (limit, lockSeconds) => rpc<ClaimedJob[]>('pet_storage_cleanup_claim', { p_limit: limit, p_lock_seconds: lockSeconds }),
    objects: (job, after, limit) =>
      rpc<CandidateObject[]>('pet_storage_cleanup_objects', {
        p_job_id: job.job_id,
        p_lock_token: job.lock_token,
        p_after: after,
        p_limit: limit,
      }),
    report: (job, removed, error: ErrorCode | null) =>
      rpc<JobStatus>('pet_storage_cleanup_report', {
        p_job_id: job.job_id,
        p_lock_token: job.lock_token,
        p_removed: removed,
        p_error: error,
      }),
    preview: (limit) => rpc<PreviewRow[]>('pet_storage_cleanup_preview', { p_limit: limit }),
    audit: (limit) => rpc<AuditRow[]>('pet_storage_cleanup_audit', { p_limit: limit }),
    purge: () => rpc<number>('pet_storage_cleanup_purge', {}),
  };
}

export function createRestCleanupStorage(config: RestConfig): CleanupStorage {
  const { base, doFetch, timeoutMs, headers } = settings(config);
  return {
    // DELETE /storage/v1/object/{bucket} con { prefixes }: lo que hace `storage.from(bucket).remove(names)`.
    // Nombres exactos (no prefijos de carpeta); los que ya no existen no son un error.
    async remove(bucket: typeof BUCKET, names: string[]): Promise<number> {
      if (bucket !== BUCKET) throw new StorageRemoveError('storage_bucket_not_allowed');
      let response: Response;
      try {
        response = await doFetch(`${base}/storage/v1/object/${BUCKET}`, {
          method: 'DELETE',
          headers,
          body: JSON.stringify({ prefixes: names }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        throw new StorageRemoveError('storage_network');
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new StorageRemoveError(`storage_http_${response.status}`);
      }
      const removed = (await response.json()) as unknown;
      if (!Array.isArray(removed)) throw new StorageRemoveError('storage_bad_response');
      return removed.length;
    },
  };
}
