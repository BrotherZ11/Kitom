// =====================================================================
// KITOM · Lógica de pet-storage-cleanup (sin imports de Deno: se prueba con Node)
// =====================================================================
// Borra los objetos de `pet-photos` de las mascotas eliminadas. La cola, la
// reserva, la verificación final y los plazos viven en la BD
// (supabase/migrations/20261027194908_pet_storage_cleanup.sql); aquí:
//  - la invocación: solo con el secreto propio (PET_STORAGE_CLEANUP_SECRET),
//    nunca con un JWT de usuario;
//  - el modo: `report` (por defecto, solo lectura) o `delete`;
//  - cada trabajo reservado: pide sus objetos por páginas, vuelve a validar
//    cada uno (bucket fijo, id de mascota del primer segmento como las
//    políticas, sin referencias) y borra los válidos con la API de Storage;
//    lo dudoso no se borra y queda como error recuperable;
//  - el informe al servidor, que decide si el trabajo termina.
// Los registros son códigos y recuentos: ni rutas, ni URLs, ni secretos.
// =====================================================================

/** El único bucket que se limpia (los demás, fuera de alcance: ver la migración). */
export const BUCKET = 'pet-photos';
export const SECRET_HEADER = 'x-kitom-cleanup-secret';
export const MIN_SECRET_LENGTH = 32;
/** Reserva de cada trabajo: muy por encima del presupuesto de una ejecución. */
export const LOCK_SECONDS = 300;
export const DEFAULT_BATCH = 5;
export const MAX_BATCH = 10;
export const PAGE_SIZE = 200;
export const REMOVE_CHUNK = 100;
/** Presupuesto de una ejecución; lo que no cabe se libera y sigue en la siguiente. */
export const TIME_BUDGET_MS = 50_000;

export type CleanupMode = 'report' | 'delete';
export type CleanupTask = 'process' | 'audit';
export type JobStatus = 'pending' | 'done' | 'failed';
/** Los únicos errores que acepta pet_storage_cleanup_report. */
export type ErrorCode =
  | 'object_list_failed'
  | 'storage_remove_failed'
  | 'object_referenced'
  | 'invalid_object'
  | 'pet_exists'
  | 'time_budget'
  | 'unexpected';

export type ClaimedJob = { job_id: string; pet_id: string; lock_token: string; attempts: number };
export type CandidateObject = { object_bucket: string; object_name: string; referenced: boolean };
export type PreviewRow = { job_id: string; attempts: number; due: boolean; pet_exists: boolean; objects: number; referenced: number };
export type AuditRow = { folder_pet_id: string; objects: number; job_status: JobStatus | null };

export interface CleanupDb {
  claim(limit: number, lockSeconds: number): Promise<ClaimedJob[]>;
  objects(job: ClaimedJob, after: string | null, limit: number): Promise<CandidateObject[]>;
  report(job: ClaimedJob, removed: number, error: ErrorCode | null): Promise<JobStatus>;
  preview(limit: number): Promise<PreviewRow[]>;
  audit(limit: number): Promise<AuditRow[]>;
  purge(): Promise<number>;
}

export interface CleanupStorage {
  /** Borra esos nombres exactos del bucket; devuelve cuántos existían y se borraron. */
  remove(bucket: typeof BUCKET, names: string[]): Promise<number>;
}

export type Log = (event: string, fields: Record<string, string | number | boolean | null>) => void;

export type CleanupDeps = { db: CleanupDb; storage: CleanupStorage; now: () => number; log: Log };

/** Error de una RPC con un código seguro para registrar (nunca el mensaje del servidor). */
export class CleanupRpcError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'CleanupRpcError';
    this.code = code;
  }
}

export class StorageRemoveError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'StorageRemoveError';
    this.code = code;
  }
}

export const LOCK_LOST = 'pet_storage_cleanup_lock_lost';
export const PET_EXISTS = 'pet_storage_cleanup_pet_exists';
/** La BD no puede trabajar con garantías (no ve storage.objects, o falta el CHECK de photo_path): nada se reserva. */
export const STORAGE_NOT_VISIBLE = 'pet_storage_cleanup_storage_not_visible';
export const PHOTO_PATH_UNCHECKED = 'pet_storage_cleanup_photo_path_unchecked';

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * El id de mascota de una ruta, como `public.safe_pet_id_from_path` (que usan las políticas): el primer
 * segmento de carpeta si es un uuid (cualquier combinación de mayúsculas), en minúsculas; si no hay
 * carpeta o no es un uuid, null.
 */
export function petIdFromObjectName(name: string): string | null {
  const segments = name.split('/');
  if (segments.length < 2) return null;
  return UUID.test(segments[0]) ? segments[0].toLowerCase() : null;
}

/** Si un candidato se puede borrar. Todo lo que no sea exactamente lo esperado, no. */
export function objectVerdict(object: CandidateObject, petId: string): 'ok' | 'invalid_object' | 'object_referenced' {
  const name = object.object_name;
  if (object.object_bucket !== BUCKET) return 'invalid_object';
  if (typeof name !== 'string' || name.length === 0 || name.length > 1024 || CONTROL_CHARS.test(name)) return 'invalid_object';
  if (petIdFromObjectName(name) !== petId.toLowerCase()) return 'invalid_object';
  // Solo `false` explícito: una referencia que no se pudo comprobar cuenta como referencia.
  if (object.referenced !== false) return 'object_referenced';
  return 'ok';
}

/** Comparación que no depende de dónde difieren (sí de la longitud del secreto configurado). */
export function secretMatches(given: string | null, expected: string): boolean {
  if (given === null) return false;
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i];
  return diff === 0;
}

export function checkInvocation(given: string | null, configured: string | undefined): 'ok' | 'unauthorized' | 'not_configured' {
  if (!configured || configured.length < MIN_SECRET_LENGTH) return 'not_configured';
  return secretMatches(given, configured) ? 'ok' : 'unauthorized';
}

/** Solo `delete` borra; cualquier otro valor (o ninguno) es el modo informe. */
export function modeFromEnv(value: string | undefined): CleanupMode {
  return value === 'delete' ? 'delete' : 'report';
}

/** Cuerpo opcional: `{ task?: 'process' | 'audit', batch?: 1..10 }`. Nada más: ni buckets ni rutas. */
export function parseRequestBody(text: string): { task: CleanupTask; batch: number } | null {
  if (text.trim() === '') return { task: 'process', batch: DEFAULT_BATCH };
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== 'task' && key !== 'batch')) return null;
  const task = record.task ?? 'process';
  const batch = record.batch ?? DEFAULT_BATCH;
  if (task !== 'process' && task !== 'audit') return null;
  if (typeof batch !== 'number' || !Number.isInteger(batch) || batch < 1 || batch > MAX_BATCH) return null;
  return { task, batch };
}

const errorCodeOf = (error: unknown): string =>
  error instanceof CleanupRpcError || error instanceof StorageRemoveError ? error.code : 'unexpected';

type JobOutcome = { status: JobStatus | 'lock_lost' | 'report_failed'; removed: number; error: ErrorCode | null };

/** Una pasada sobre un trabajo reservado. Nunca lanza: el resultado va al servidor o se registra. */
async function processJob(deps: CleanupDeps, job: ClaimedJob, deadline: number): Promise<JobOutcome> {
  let removed = 0;
  let error: ErrorCode | null = null;
  let after: string | null = null;
  try {
    for (;;) {
      if (deps.now() >= deadline) {
        error = 'time_budget';
        break;
      }
      let page: CandidateObject[];
      try {
        page = await deps.db.objects(job, after, PAGE_SIZE);
      } catch (listError) {
        if (errorCodeOf(listError) === LOCK_LOST) return { status: 'lock_lost', removed, error: null };
        error = errorCodeOf(listError) === PET_EXISTS ? 'pet_exists' : 'object_list_failed';
        break;
      }
      if (page.length === 0) break;
      after = page[page.length - 1].object_name;

      const deletable: string[] = [];
      for (const object of page) {
        const verdict = objectVerdict(object, job.pet_id);
        if (verdict === 'ok') deletable.push(object.object_name);
        else error ??= verdict;
      }
      for (let i = 0; i < deletable.length; i += REMOVE_CHUNK) {
        try {
          removed += await deps.storage.remove(BUCKET, deletable.slice(i, i + REMOVE_CHUNK));
        } catch (removeError) {
          deps.log('pet_storage_cleanup.remove_failed', { job: job.job_id, code: errorCodeOf(removeError) });
          error = 'storage_remove_failed';
          break;
        }
      }
      if (error === 'storage_remove_failed' || page.length < PAGE_SIZE) break;
    }
  } catch {
    error = 'unexpected';
  }

  try {
    const status = await deps.db.report(job, removed, error);
    return { status, removed, error };
  } catch (reportError) {
    // Sin informe, la reserva caduca y otra ejecución lo retoma: lo ya borrado no se vuelve a pedir.
    const code = errorCodeOf(reportError);
    return { status: code === LOCK_LOST ? 'lock_lost' : 'report_failed', removed, error };
  }
}

export type RunSummary = {
  mode: CleanupMode;
  task: CleanupTask;
  jobs: number;
  done: number;
  pending: number;
  failed: number;
  skipped: number;
  removed: number;
  errors: Record<string, number>;
  /** Solo en el modo informe y en la auditoría. */
  objects?: number;
  referenced?: number;
  folders?: number;
  foldersWithoutJob?: number;
  purged?: number;
};

const emptySummary = (mode: CleanupMode, task: CleanupTask): RunSummary => ({
  mode,
  task,
  jobs: 0,
  done: 0,
  pending: 0,
  failed: 0,
  skipped: 0,
  removed: 0,
  errors: {},
});

/**
 * Una ejecución. `process` en modo informe: los trabajos pendientes y lo que se borraría, sin reservar
 * ni escribir nada. `process` en modo borrado: reserva un lote y lo procesa. `audit`: carpetas de
 * mascotas que ya no existen (también las que no tienen trabajo, que no se encolan aquí) y, solo en
 * modo borrado, la retención de los terminados.
 */
export async function runCleanup(
  deps: CleanupDeps,
  options: { mode: CleanupMode; task: CleanupTask; batch: number },
): Promise<RunSummary> {
  const summary = emptySummary(options.mode, options.task);

  if (options.task === 'audit') {
    const rows = await deps.db.audit(1000);
    summary.folders = rows.length;
    summary.foldersWithoutJob = rows.filter((row) => row.job_status === null).length;
    summary.objects = rows.reduce((total, row) => total + row.objects, 0);
    for (const row of rows) {
      if (row.job_status === 'done') summary.done++;
      else if (row.job_status === 'pending') summary.pending++;
      else if (row.job_status === 'failed') summary.failed++;
    }
    if (options.mode === 'delete') summary.purged = await deps.db.purge();
    deps.log('pet_storage_cleanup.audit', {
      folders: summary.folders,
      without_job: summary.foldersWithoutJob,
      done_with_objects: summary.done,
      objects: summary.objects,
      purged: summary.purged ?? null,
    });
    return summary;
  }

  if (options.mode === 'report') {
    const rows = await deps.db.preview(100);
    summary.jobs = rows.length;
    summary.objects = 0;
    summary.referenced = 0;
    for (const row of rows) {
      summary.objects += row.objects;
      summary.referenced += row.referenced;
      if (row.pet_exists) summary.errors.pet_exists = (summary.errors.pet_exists ?? 0) + 1;
      deps.log('pet_storage_cleanup.preview', {
        job: row.job_id,
        due: row.due,
        attempts: row.attempts,
        pet_exists: row.pet_exists,
        objects: row.objects,
        referenced: row.referenced,
      });
    }
    return summary;
  }

  const deadline = deps.now() + TIME_BUDGET_MS;
  const jobs = await deps.db.claim(options.batch, LOCK_SECONDS);
  summary.jobs = jobs.length;
  for (const job of jobs) {
    const outcome = await processJob(deps, job, deadline);
    summary.removed += outcome.removed;
    if (outcome.error) summary.errors[outcome.error] = (summary.errors[outcome.error] ?? 0) + 1;
    if (outcome.status === 'lock_lost' || outcome.status === 'report_failed') summary.skipped++;
    else summary[outcome.status]++;
    deps.log('pet_storage_cleanup.job', {
      job: job.job_id,
      attempt: job.attempts,
      status: outcome.status,
      removed: outcome.removed,
      error: outcome.error,
    });
  }
  return summary;
}

export type CleanupEnv = {
  secret: string | undefined;
  mode: string | undefined;
  supabaseUrl: string | undefined;
  serviceKey: string | undefined;
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** La petición HTTP completa; `index.ts` solo la conecta con Deno. */
export async function handleCleanupRequest(
  request: Request,
  env: CleanupEnv,
  makeDeps: (url: string, serviceKey: string) => CleanupDeps,
  log: Log,
): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const access = checkInvocation(request.headers.get(SECRET_HEADER), env.secret);
  if (access === 'not_configured') {
    log('pet_storage_cleanup.rejected', { reason: 'not_configured' });
    return json(503, { error: 'not_configured' });
  }
  if (access === 'unauthorized') {
    log('pet_storage_cleanup.rejected', { reason: 'unauthorized' });
    return json(401, { error: 'unauthorized' });
  }

  const body = parseRequestBody(await request.text());
  if (body === null) return json(400, { error: 'invalid_body' });
  if (!env.supabaseUrl || !env.serviceKey) {
    log('pet_storage_cleanup.rejected', { reason: 'not_configured' });
    return json(503, { error: 'not_configured' });
  }

  const mode = modeFromEnv(env.mode);
  try {
    const summary = await runCleanup(makeDeps(env.supabaseUrl, env.serviceKey), { mode, task: body.task, batch: body.batch });
    return json(200, summary);
  } catch (error) {
    log('pet_storage_cleanup.run_failed', { mode, task: body.task, code: errorCodeOf(error) });
    return json(500, { error: 'cleanup_failed' });
  }
}
