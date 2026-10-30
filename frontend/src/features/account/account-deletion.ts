/**
 * Borrado de cuenta (Edge Function `delete-account`): lectura de sus respuestas, errores y el cierre en
 * el dispositivo. Módulo puro (sin imports): se prueba con `npm test`. Contrato: `docs/README.md` §12 y
 * `docs/FRONTEND_ARCHITECTURE.md` «DeleteAccountScreen».
 *
 * La app no decide nada: muestra el plan que calcula la función (qué mascotas pasan a un co-tutor
 * editor y cuáles se borran) y lo devuelve tal cual al confirmar. Si al borrar ya no coincide, la
 * función responde `plan_changed` con el plan nuevo y el usuario vuelve a confirmar.
 */

/** Lo que la función exige en `confirm` (no es un secreto: evita un borrado con un cuerpo incompleto). */
export const DELETE_ACCOUNT_CONFIRM = 'DELETE';

export type PlannedTransfer = { petId: string; petName: string; newOwnerId: string; newOwnerName: string | null };
export type PlannedDeletion = { petId: string; petName: string };
export type DeletionPlan = {
  transfer: PlannedTransfer[];
  delete: PlannedDeletion[];
  /** Mascotas de otras personas compartidas con el usuario: solo deja de tener acceso. */
  leaveShared: number;
};

export type ExpectedAction =
  | { pet_id: string; action: 'transfer'; new_owner_id: string }
  | { pet_id: string; action: 'delete' };

/**
 * - `network`: sin conexión o sin sesión utilizable (no llegó a la función).
 * - `session`: la función no aceptó la sesión: hay que volver a entrar.
 * - `plan_changed`: lo confirmado ya no es lo que pasaría; viene el plan nuevo.
 * - `too_many_pets`: más mascotas propias de las que la función planifica de una vez.
 * - `incomplete`: falló a medias; repetir converge (lo hecho no se deshace).
 * - `server`: cualquier otra respuesta.
 */
export type AccountDeletionErrorCode = 'network' | 'session' | 'plan_changed' | 'too_many_pets' | 'incomplete' | 'server';

export class AccountDeletionError extends Error {
  readonly code: AccountDeletionErrorCode;
  /** Solo con `plan_changed`. */
  readonly plan: DeletionPlan | null;

  constructor(code: AccountDeletionErrorCode, plan: DeletionPlan | null = null) {
    super(code);
    this.name = 'AccountDeletionError';
    this.code = code;
    this.plan = plan;
  }
}

/** Resultado de la vista previa: el plan, o que la cuenta ya no existe (borrada desde otro dispositivo). */
export type DeletionPreview = { status: 'ready'; plan: DeletionPlan } | { status: 'already_deleted' };
/** `already_deleted`: el usuario del JWT ya no existe; para la app es lo mismo que `deleted`. */
export type DeletionResult = { status: 'deleted' | 'already_deleted' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';

/** El plan de la respuesta, validado. `null` si no tiene la forma esperada. */
export function parseDeletionPlan(value: unknown): DeletionPlan | null {
  if (!isRecord(value) || !Array.isArray(value.transfer) || !Array.isArray(value.delete)) return null;
  const leaveShared = value.leave_shared;
  if (typeof leaveShared !== 'number' || !Number.isInteger(leaveShared) || leaveShared < 0) return null;
  const transfer: PlannedTransfer[] = [];
  for (const item of value.transfer as unknown[]) {
    if (!isRecord(item) || !isText(item.pet_id) || typeof item.pet_name !== 'string' || !isText(item.new_owner_id)) return null;
    const name = item.new_owner_name;
    if (name !== null && typeof name !== 'string') return null;
    transfer.push({ petId: item.pet_id, petName: item.pet_name, newOwnerId: item.new_owner_id, newOwnerName: name || null });
  }
  const deletion: PlannedDeletion[] = [];
  for (const item of value.delete as unknown[]) {
    if (!isRecord(item) || !isText(item.pet_id) || typeof item.pet_name !== 'string') return null;
    deletion.push({ petId: item.pet_id, petName: item.pet_name });
  }
  return { transfer, delete: deletion, leaveShared };
}

/** Lo que se envía al confirmar: exactamente el plan mostrado. */
export function expectedFromPlan(plan: DeletionPlan): ExpectedAction[] {
  return [
    ...plan.transfer.map((item): ExpectedAction => ({ pet_id: item.petId, action: 'transfer', new_owner_id: item.newOwnerId })),
    ...plan.delete.map((item): ExpectedAction => ({ pet_id: item.petId, action: 'delete' })),
  ];
}

export function deletionRequestBody(plan: DeletionPlan) {
  return { mode: 'delete' as const, confirm: DELETE_ACCOUNT_CONFIRM, expected: expectedFromPlan(plan) };
}

const errorOf = (body: unknown): unknown => (isRecord(body) ? body.error : undefined);

/** Error de una respuesta que no es 2xx (o de un 2xx con una forma inesperada). */
function responseError(status: number, body: unknown): AccountDeletionError {
  const code = errorOf(body);
  if (status === 409 && code === 'plan_changed') {
    const plan = isRecord(body) ? parseDeletionPlan(body.plan) : null;
    return plan ? new AccountDeletionError('plan_changed', plan) : new AccountDeletionError('server');
  }
  if (status === 409 && code === 'too_many_pets') return new AccountDeletionError('too_many_pets');
  if (status === 401) return new AccountDeletionError('session');
  if (status === 500 && code === 'deletion_incomplete') return new AccountDeletionError('incomplete');
  return new AccountDeletionError('server');
}

/** Respuesta de `{ mode: 'preview' }`. Lanza `AccountDeletionError` si no es un plan. */
export function readPreviewResponse(status: number, body: unknown): DeletionPreview {
  if (status === 410 && errorOf(body) === 'account_not_found') return { status: 'already_deleted' };
  if (status === 200 && isRecord(body) && body.status === 'preview') {
    const plan = parseDeletionPlan(body.plan);
    if (plan) return { status: 'ready', plan };
  }
  throw responseError(status, body);
}

/** Respuesta de `{ mode: 'delete' }`. Lanza `AccountDeletionError` si la cuenta no quedó borrada. */
export function readDeleteResponse(status: number, body: unknown): DeletionResult {
  if (status === 410 && errorOf(body) === 'account_not_found') return { status: 'already_deleted' };
  if (status === 200 && isRecord(body) && body.status === 'deleted') return { status: 'deleted' };
  throw responseError(status, body);
}

/** Error lanzado antes de tener una respuesta HTTP (red, sesión no utilizable, relé). */
export function deletionErrorFromThrown(error: unknown): AccountDeletionError {
  if (error instanceof AccountDeletionError) return error;
  if (error instanceof TypeError) return new AccountDeletionError('network');
  const { name, message } = (error ?? {}) as { name?: unknown; message?: unknown };
  if (name === 'FunctionsFetchError' || name === 'SessionUnavailableError') return new AccountDeletionError('network');
  if (typeof message === 'string' && /network request failed|failed to fetch|fetch failed|load failed|networkerror/i.test(message)) {
    return new AccountDeletionError('network');
  }
  return new AccountDeletionError('server');
}

/** Un motor de sincronización local (Daily Logs, Pets): parar y esperar a lo que esté en vuelo. */
export type LocalEngine = { stop(): void; idle(): Promise<void> };

export type FinishDeletionDeps = {
  engines: readonly LocalEngine[];
  /** Tope de la espera a los envíos en vuelo (fallarán: el usuario ya no existe). */
  idleTimeoutMs: number;
  /** Borra del dispositivo todo lo del usuario (`clearLocalUserData`). */
  clearLocalData(): Promise<unknown>;
  /** Quita los avisos programados de Kitom. */
  cancelNotifications(): Promise<unknown>;
  /** Cierra la sesión en el dispositivo (el servidor ya no tiene el usuario: su error no importa). */
  signOut(): Promise<unknown>;
  wait?: (ms: number) => Promise<void>;
};

/**
 * Cierre en el dispositivo tras borrar la cuenta en el servidor. Nunca lanza: la cuenta ya no existe y
 * la sesión debe terminar pase lo que pase.
 * 1. Para los motores (no se envía nada más) y espera, con tope, a lo que estuviera en vuelo.
 * 2. Borra los datos locales del usuario y sus avisos.
 * 3. Cierra la sesión (la zona autenticada se desmonta y se llega al acceso).
 * 4. Vuelve a borrar los datos locales: lo que algo hubiera escrito entre medias tampoco se queda.
 * `localDataCleared: false` si el almacenamiento falló en los dos intentos (quedan datos huérfanos de
 * una cuenta que ya no existe; nunca se muestran a otra).
 */
export async function finishAccountDeletion(deps: FinishDeletionDeps): Promise<{ localDataCleared: boolean }> {
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (const engine of deps.engines) {
    try {
      engine.stop();
    } catch {
      // Un motor que no para no impide el resto.
    }
  }
  await Promise.race([Promise.allSettled(deps.engines.map((engine) => engine.idle())), wait(deps.idleTimeoutMs)]);

  const clear = async () => {
    try {
      await deps.clearLocalData();
      return true;
    } catch {
      return false;
    }
  };
  const first = await clear();
  await deps.cancelNotifications().catch(() => undefined);
  await deps.signOut().catch(() => undefined);
  const second = await clear();
  return { localDataCleared: first || second };
}
