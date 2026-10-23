import {
  normalizeEmail,
  toInvitations,
  toMembers,
  type CoOwnerRole,
  type Invitation,
  type Member,
} from '@/features/co-owners/co-owners-model';
import { supabase } from '@/lib/supabase';

/**
 * Co-tutores, solo con RPC (el cliente nunca escribe en `pet_co_owners`). El servidor decide quién puede
 * invitar, revocar o cambiar el rol (solo el propietario) y quién ve a los miembros (sus miembros).
 */

export async function fetchPetMembers(petId: string): Promise<Member[]> {
  const { data, error } = await supabase.rpc('get_pet_members', { target_pet_id: petId });
  if (error) throw error;
  return toMembers(data);
}

export async function fetchMyInvitations(): Promise<Invitation[]> {
  const { data, error } = await supabase.rpc('get_my_pet_invitations');
  if (error) throw error;
  return toInvitations(data);
}

/** Responde igual tenga o no cuenta ese email: no se puede confirmar que la invitación llegue. */
export async function inviteByEmail(petId: string, email: string, role: CoOwnerRole): Promise<void> {
  const { error } = await supabase.rpc('invite_pet_member_by_email', {
    target_pet_id: petId,
    invitee_email: normalizeEmail(email),
    initial_role: role,
  });
  if (error) throw error;
}

export async function revokeMember(invitationId: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_pet_invitation', { invitation_id: invitationId });
  if (error) throw error;
}

export async function changeMemberRole(invitationId: string, role: CoOwnerRole): Promise<void> {
  const { error } = await supabase.rpc('change_pet_member_role', { invitation_id: invitationId, new_role: role });
  if (error) throw error;
}

export async function acceptInvitation(invitationId: string): Promise<void> {
  const { error } = await supabase.rpc('accept_pet_invitation', { invitation_id: invitationId });
  if (error) throw error;
}

export async function declineInvitation(invitationId: string): Promise<void> {
  const { error } = await supabase.rpc('decline_pet_invitation', { invitation_id: invitationId });
  if (error) throw error;
}
