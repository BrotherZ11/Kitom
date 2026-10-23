/**
 * Co-tutores (`pet_co_owners`) sin dependencias: filas de las RPC a tipos de la app y códigos de error.
 * Módulo puro: se prueba con `npm test`. Las reglas (quién invita, revoca o cambia el rol) las decide el
 * servidor; aquí solo se ordena y se traduce.
 */

export type CoOwnerRole = 'editor' | 'viewer';

export const CO_OWNER_ROLES: readonly CoOwnerRole[] = ['viewer', 'editor'];

/** Co-tutor de una mascota (`get_pet_members`): invitación pendiente o aceptada. */
export type Member = {
  invitationId: string;
  userId: string;
  /** `null` si la persona no ha puesto nombre en su perfil. */
  fullName: string | null;
  role: CoOwnerRole;
  status: 'pending' | 'accepted';
  invitedAt: string;
  acceptedAt: string | null;
};

/** Invitación pendiente del usuario (`get_my_pet_invitations`). */
export type Invitation = {
  invitationId: string;
  petId: string;
  petName: string;
  role: CoOwnerRole;
  invitedByName: string | null;
  invitedAt: string;
};

type MemberRow = {
  invitation_id: string;
  user_id: string;
  full_name: string | null;
  role: CoOwnerRole;
  status: string;
  invited_at: string;
  accepted_at: string | null;
};

type InvitationRow = {
  invitation_id: string;
  pet_id: string;
  pet_name: string;
  role: CoOwnerRole;
  invited_by_name: string | null;
  invited_at: string;
};

function cleanName(name: string | null | undefined): string | null {
  const value = name?.trim();
  return value ? value : null;
}

/** Aceptados primero y después pendientes, cada grupo por fecha de invitación. */
export function toMembers(rows: readonly MemberRow[] | null | undefined): Member[] {
  return (rows ?? [])
    .filter((row) => row.status === 'pending' || row.status === 'accepted')
    .map((row) => ({
      invitationId: row.invitation_id,
      userId: row.user_id,
      fullName: cleanName(row.full_name),
      role: row.role,
      status: row.status as Member['status'],
      invitedAt: row.invited_at,
      acceptedAt: row.accepted_at ?? null,
    }))
    .sort((a, b) =>
      a.status === b.status ? a.invitedAt.localeCompare(b.invitedAt) : a.status === 'accepted' ? -1 : 1
    );
}

export function toInvitations(rows: readonly InvitationRow[] | null | undefined): Invitation[] {
  return (rows ?? []).map((row) => ({
    invitationId: row.invitation_id,
    petId: row.pet_id,
    petName: row.pet_name,
    role: row.role,
    invitedByName: cleanName(row.invited_by_name),
    invitedAt: row.invited_at,
  }));
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Email tal y como lo compara el servidor (sin espacios y en minúsculas). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Comprobación previa para avisar al momento; la regla real la aplica `invite_pet_member_by_email`. */
export function isPlausibleEmail(email: string): boolean {
  const value = normalizeEmail(email);
  return value.length <= 320 && EMAIL_PATTERN.test(value);
}

export type CoOwnerErrorCode = 'invalid_email' | 'not_owner' | 'not_member' | 'changed' | 'network' | 'unknown';

type ErrorLike = { hint?: unknown; message?: unknown; name?: unknown };

const NETWORK = /network request failed|failed to fetch|fetch failed|load failed|session_unavailable|networkerror/i;
/** Las RPC anteriores a la migración de 2026-10-23 no llevan `hint`: se reconocen por el mensaje. */
const CHANGED = /ya no est|no encontrada|no se puede revocar|miembro activo/i;
const NOT_OWNER = /solo el propietario/i;

export function toCoOwnerErrorCode(error: unknown): CoOwnerErrorCode {
  if (error instanceof TypeError) return 'network';
  const { hint, message, name } = (error ?? {}) as ErrorLike;
  if (name === 'SessionUnavailableError') return 'network';
  const text = typeof message === 'string' ? message : '';
  if (NETWORK.test(text)) return 'network';
  if (hint === 'invalid_email') return 'invalid_email';
  if (hint === 'not_pet_owner' || NOT_OWNER.test(text)) return 'not_owner';
  if (hint === 'not_pet_member') return 'not_member';
  if (CHANGED.test(text)) return 'changed';
  return 'unknown';
}
