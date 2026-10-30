// =====================================================================
// KITOM · Lógica de delete-account (sin imports de Deno: se prueba con Node)
// =====================================================================
// Borra la cuenta del usuario del JWT. Contrato: docs/README.md §12 y
// docs/FRONTEND_ARCHITECTURE.md «DeleteAccountScreen». Decisión de producto:
// cada mascota de la que es propietario pasa a su co-tutor editor aceptado
// más antiguo (accepted_at) con transfer_pet_ownership; si no tiene, se borra
// con todo lo suyo (cascada; sus fotos las encola el trigger de pets para
// pet-storage-cleanup). Después se quitan sus objetos de `avatars` y se borra
// el usuario de Auth (el perfil y lo que cuelga de él va en cascada).
//
// Orden de seguridad (como ai-analysis-process):
//  1. JWT de la cabecera Authorization.
//  2. El usuario sale de ESE JWT (Auth lo comprueba); nunca del body.
//  3. Cuerpo validado de forma estricta.
//  4. Plan leído con el JWT del usuario: RLS y las RPC deciden qué es suyo.
//     Transferir, borrar mascotas y quitar avatares también van con su JWT.
//  5. Solo al final, la clave de servicio: auth.admin.deleteUser.
//
// Reintentos: cada llamada vuelve a planificar desde el estado actual de la
// BD, así que tras un fallo a medias la siguiente converge (lo transferido ya
// no es suyo, lo borrado ya no existe). Si el usuario ya no existe: 410.
// Los registros son códigos y recuentos: ni nombres, ni ids, ni rutas.
// =====================================================================

/** Lo que la app envía para confirmar (no es un secreto: evita un borrado por un cuerpo incompleto). */
export const CONFIRM_TOKEN = 'DELETE';
export const AVATARS_BUCKET = 'avatars';
/** Tope de mascotas propias que se planifican en una llamada (muy por encima del uso real). */
export const MAX_PETS = 200;
export const MAX_BODY_BYTES = 64 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export type OwnedPet = { id: string; name: string };
export type PetMember = {
  user_id: string;
  full_name: string | null;
  role: string;
  status: string;
  invited_at: string | null;
  accepted_at: string | null;
};

export type PlannedTransfer = { pet_id: string; pet_name: string; new_owner_id: string; new_owner_name: string | null };
export type PlannedDeletion = { pet_id: string; pet_name: string };
export type DeletionPlan = {
  transfer: PlannedTransfer[];
  delete: PlannedDeletion[];
  /** Mascotas de otras personas que comparten con el usuario: solo deja de tener acceso. */
  leave_shared: number;
};

/** Lo que el usuario vio y confirmó, por mascota. */
export type ExpectedAction =
  | { pet_id: string; action: 'transfer'; new_owner_id: string }
  | { pet_id: string; action: 'delete' };

export type DeletionRequest = { mode: 'preview' } | { mode: 'delete'; expected: ExpectedAction[] };

/** Acceso a datos con el JWT del usuario: la BD autoriza cada operación. */
export interface UserGateway {
  ownedPets(userId: string, limit: number): Promise<OwnedPet[]>;
  petMembers(petId: string): Promise<PetMember[]>;
  /** Ids de las mascotas en las que el usuario es co-tutor aceptado. */
  sharedPetIds(userId: string): Promise<string[]>;
  transferPet(petId: string, newOwnerId: string): Promise<void>;
  /** `true` si se borró la fila (con `owner_id` = el usuario); `false` si ya no estaba. */
  deletePet(petId: string, userId: string): Promise<boolean>;
  /** Rutas completas de sus objetos en `avatars` (`{user_id}/…`). */
  listAvatars(userId: string): Promise<string[]>;
  removeAvatars(names: string[]): Promise<number>;
}

/** Lo único que usa la clave de servicio. */
export interface AdminGateway {
  deleteUser(userId: string): Promise<'deleted' | 'not_found'>;
}

export type TokenCheck = { status: 'ok'; userId: string } | { status: 'not_found' } | { status: 'invalid' };

export interface AuthGateway {
  /** Usuario de un JWT según Supabase Auth (firma, caducidad y que exista). */
  userFromToken(token: string): Promise<TokenCheck>;
}

export type Log = (event: string, fields: Record<string, string | number | boolean | null>) => void;

export type DeletionDeps = { auth: AuthGateway; user: UserGateway; admin: AdminGateway; log: Log };

/** Error de una llamada con un código seguro para registrar (nunca el mensaje del servidor). */
export class GatewayError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'GatewayError';
    this.code = code;
  }
}

export const errorCodeOf = (error: unknown): string => (error instanceof GatewayError ? error.code : 'unexpected');

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseExpected(value: unknown): ExpectedAction | null {
  if (!isRecord(value)) return null;
  const { pet_id: petId, action, new_owner_id: newOwnerId } = value;
  if (!isUuid(petId)) return null;
  if (action === 'transfer') {
    if (Object.keys(value).some((key) => !['pet_id', 'action', 'new_owner_id'].includes(key))) return null;
    return isUuid(newOwnerId) ? { pet_id: petId.toLowerCase(), action, new_owner_id: newOwnerId.toLowerCase() } : null;
  }
  if (action === 'delete') {
    if (Object.keys(value).some((key) => !['pet_id', 'action'].includes(key))) return null;
    return { pet_id: petId.toLowerCase(), action };
  }
  return null;
}

/**
 * Cuerpo, estricto: `{ "mode": "preview" }` o `{ "mode": "delete", "confirm": "DELETE", "expected": [...] }`.
 * Ningún campo de más (tampoco un id de usuario: el usuario es siempre el del JWT).
 */
export function parseRequestBody(text: string): DeletionRequest | null {
  if (text.length > MAX_BODY_BYTES) return null;
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(body)) return null;
  if (body.mode === 'preview') return Object.keys(body).length === 1 ? { mode: 'preview' } : null;
  if (body.mode !== 'delete') return null;
  if (Object.keys(body).some((key) => !['mode', 'confirm', 'expected'].includes(key))) return null;
  if (body.confirm !== CONFIRM_TOKEN) return null;
  if (!Array.isArray(body.expected) || body.expected.length > MAX_PETS) return null;
  const expected: ExpectedAction[] = [];
  const seen = new Set<string>();
  for (const item of body.expected) {
    const parsed = parseExpected(item);
    if (!parsed || seen.has(parsed.pet_id)) return null;
    seen.add(parsed.pet_id);
    expected.push(parsed);
  }
  return { mode: 'delete', expected };
}

const timeOf = (value: string | null): number => {
  const time = value === null ? Number.NaN : Date.parse(value);
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
};

/**
 * Nuevo propietario: el co-tutor **editor** con la invitación **aceptada** más antigua (`accepted_at`;
 * a igualdad, la invitación más antigua y el id). Pendientes y lectores no cuentan. `null` si no hay.
 */
export function chooseNewOwner(members: readonly PetMember[], userId: string): PetMember | null {
  const candidates = members.filter(
    (member) => member.role === 'editor' && member.status === 'accepted' && isUuid(member.user_id) && member.user_id !== userId
  );
  candidates.sort(
    (a, b) =>
      timeOf(a.accepted_at) - timeOf(b.accepted_at) ||
      timeOf(a.invited_at) - timeOf(b.invited_at) ||
      (a.user_id < b.user_id ? -1 : a.user_id > b.user_id ? 1 : 0)
  );
  return candidates[0] ?? null;
}

export class TooManyPetsError extends Error {
  constructor() {
    super('too_many_pets');
    this.name = 'TooManyPetsError';
  }
}

/** El plan desde el estado actual de la BD, leído con el JWT del usuario. */
export async function buildPlan(user: UserGateway, userId: string): Promise<DeletionPlan> {
  const owned = await user.ownedPets(userId, MAX_PETS + 1);
  if (owned.length > MAX_PETS) throw new TooManyPetsError();
  const plan: DeletionPlan = { transfer: [], delete: [], leave_shared: 0 };
  for (const pet of owned) {
    const newOwner = chooseNewOwner(await user.petMembers(pet.id), userId);
    if (newOwner) {
      plan.transfer.push({
        pet_id: pet.id,
        pet_name: pet.name,
        new_owner_id: newOwner.user_id,
        new_owner_name: newOwner.full_name?.trim() ? newOwner.full_name.trim() : null,
      });
    } else {
      plan.delete.push({ pet_id: pet.id, pet_name: pet.name });
    }
  }
  const ownedIds = new Set(owned.map((pet) => pet.id));
  plan.leave_shared = new Set((await user.sharedPetIds(userId)).filter((id) => !ownedIds.has(id))).size;
  return plan;
}

/**
 * ¿Lo que se va a hacer es lo que el usuario confirmó? Cada mascota que sigue siendo suya debe estar en
 * lo confirmado con la misma acción (y el mismo nuevo propietario). Lo confirmado que ya no aparece no
 * importa: ya se transfirió o se borró (un reintento tras un fallo a medias) o dejó de ser suya.
 */
export function planMatches(plan: DeletionPlan, expected: readonly ExpectedAction[]): boolean {
  const byPet = new Map(expected.map((item) => [item.pet_id, item]));
  const transfersMatch = plan.transfer.every((item) => {
    const confirmed = byPet.get(item.pet_id.toLowerCase());
    return confirmed?.action === 'transfer' && confirmed.new_owner_id === item.new_owner_id.toLowerCase();
  });
  return transfersMatch && plan.delete.every((item) => byPet.get(item.pet_id.toLowerCase())?.action === 'delete');
}

/** Lo que la app envía como confirmación de un plan (lo mismo que `planMatches` comprueba). */
export function expectedFromPlan(plan: DeletionPlan): ExpectedAction[] {
  return [
    ...plan.transfer.map((item): ExpectedAction => ({ pet_id: item.pet_id, action: 'transfer', new_owner_id: item.new_owner_id })),
    ...plan.delete.map((item): ExpectedAction => ({ pet_id: item.pet_id, action: 'delete' })),
  ];
}

export type DeletionStep = 'transfer' | 'delete_pet' | 'avatars' | 'delete_user';
export type DeletionProgress = { transferred: number; deleted: number; avatars_removed: number };

export type DeletionOutcome =
  | ({ status: 'deleted' } & DeletionProgress)
  | { status: 'plan_changed'; plan: DeletionPlan }
  | ({ status: 'failed'; step: DeletionStep; code: string } & DeletionProgress);

/**
 * Ejecuta un plan ya confirmado: primero lo menos destructivo (transferencias), luego las mascotas sin
 * editor, los avatares y, si ya no queda ninguna mascota suya, el usuario de Auth. Se para en el primer
 * fallo (lo hecho no se deshace: el siguiente intento vuelve a planificar).
 */
export async function executePlan(
  deps: Pick<DeletionDeps, 'user' | 'admin'>,
  userId: string,
  plan: DeletionPlan
): Promise<DeletionOutcome> {
  const progress: DeletionProgress = { transferred: 0, deleted: 0, avatars_removed: 0 };
  const failed = (step: DeletionStep, error: unknown): DeletionOutcome => ({ status: 'failed', step, code: errorCodeOf(error), ...progress });

  for (const item of plan.transfer) {
    try {
      await deps.user.transferPet(item.pet_id, item.new_owner_id);
      progress.transferred++;
    } catch (error) {
      return failed('transfer', error);
    }
  }
  for (const item of plan.delete) {
    try {
      if (await deps.user.deletePet(item.pet_id, userId)) progress.deleted++;
    } catch (error) {
      return failed('delete_pet', error);
    }
  }
  try {
    const names = await deps.user.listAvatars(userId);
    if (names.length > 0) progress.avatars_removed = await deps.user.removeAvatars(names);
  } catch (error) {
    return failed('avatars', error);
  }

  // Una mascota creada mientras tanto (otro dispositivo) no se borra sin que el usuario la vea.
  let remaining: OwnedPet[];
  try {
    remaining = await deps.user.ownedPets(userId, 1);
  } catch (error) {
    return failed('delete_pet', error);
  }
  if (remaining.length > 0) {
    try {
      return { status: 'plan_changed', plan: await buildPlan(deps.user, userId) };
    } catch (error) {
      return failed('delete_pet', error);
    }
  }

  try {
    // Ya no existe (otra llamada lo borró entre medias): el resultado es el mismo.
    await deps.admin.deleteUser(userId);
  } catch (error) {
    return failed('delete_user', error);
  }
  return { status: 'deleted', ...progress };
}

export type DeletionEnv = {
  supabaseUrl: string | undefined;
  anonKey: string | undefined;
  serviceKey: string | undefined;
};

export type DepsConfig = { url: string; anonKey: string; serviceKey: string; token: string };

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });

const planCounts = (plan: DeletionPlan) => ({ transfer: plan.transfer.length, delete: plan.delete.length, leave_shared: plan.leave_shared });

/** Token del encabezado `Authorization: Bearer …` (vacío si no lo hay). */
export function bearerToken(request: Request): string {
  const authorization = request.headers.get('Authorization') ?? '';
  return authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : '';
}

/** La petición HTTP completa; `index.ts` solo la conecta con Deno. */
export async function handleDeleteAccountRequest(
  request: Request,
  env: DeletionEnv,
  makeDeps: (config: DepsConfig) => DeletionDeps,
  log: Log
): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  // 1. JWT (de la cabecera, nunca del body).
  const token = bearerToken(request);
  if (!token) return json(401, { error: 'not_authenticated' });
  if (!env.supabaseUrl || !env.anonKey || !env.serviceKey) {
    log('delete_account.rejected', { reason: 'server_misconfigured' });
    return json(500, { error: 'server_misconfigured' });
  }
  const deps = makeDeps({ url: env.supabaseUrl, anonKey: env.anonKey, serviceKey: env.serviceKey, token });

  // 2. Usuario de ese JWT, según Auth.
  let check: TokenCheck;
  try {
    check = await deps.auth.userFromToken(token);
  } catch (error) {
    log('delete_account.auth_failed', { code: errorCodeOf(error) });
    return json(500, { error: 'server_error' });
  }
  if (check.status === 'invalid') return json(401, { error: 'not_authenticated' });
  // El JWT es válido pero su usuario ya no existe: la cuenta ya se borró (respuesta final).
  if (check.status === 'not_found') return json(410, { error: 'account_not_found' });
  const userId = check.userId;

  // 3. Cuerpo.
  let text: string;
  try {
    text = await request.text();
  } catch {
    return json(400, { error: 'invalid_request' });
  }
  const body = parseRequestBody(text);
  if (body === null) return json(400, { error: 'invalid_request' });

  // 4. Plan con el JWT del usuario.
  let plan: DeletionPlan;
  try {
    plan = await buildPlan(deps.user, userId);
  } catch (error) {
    if (error instanceof TooManyPetsError) {
      log('delete_account.rejected', { reason: 'too_many_pets' });
      return json(409, { error: 'too_many_pets' });
    }
    log('delete_account.plan_failed', { mode: body.mode, code: errorCodeOf(error) });
    return json(500, { error: 'server_error' });
  }

  if (body.mode === 'preview') {
    log('delete_account.preview', planCounts(plan));
    return json(200, { status: 'preview', plan });
  }

  if (!planMatches(plan, body.expected)) {
    log('delete_account.plan_changed', planCounts(plan));
    return json(409, { error: 'plan_changed', plan });
  }

  // 5. Ejecutar (la clave de servicio solo en el último paso).
  const outcome = await executePlan(deps, userId, plan);
  if (outcome.status === 'plan_changed') {
    log('delete_account.plan_changed', planCounts(outcome.plan));
    return json(409, { error: 'plan_changed', plan: outcome.plan });
  }
  const counts = { transferred: outcome.transferred, deleted: outcome.deleted, avatars_removed: outcome.avatars_removed };
  if (outcome.status === 'failed') {
    log('delete_account.failed', { step: outcome.step, code: outcome.code, ...counts });
    return json(500, { error: 'deletion_incomplete', step: outcome.step, ...counts });
  }
  log('delete_account.deleted', counts);
  return json(200, { status: 'deleted', ...counts });
}
