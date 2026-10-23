import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/features/auth/auth-context';
import {
  acceptInvitation,
  changeMemberRole,
  declineInvitation,
  fetchMyInvitations,
  fetchPetMembers,
  inviteByEmail,
  revokeMember,
} from '@/features/co-owners/api/co-owners-api';
import type { CoOwnerRole } from '@/features/co-owners/co-owners-model';
import { isLocalPetId } from '@/features/pets/offline/pet-operation';
import { petKeys } from '@/features/pets/query-keys';

/** Query keys de co-tutores (con el usuario, como el resto de features). */
export const coOwnerKeys = {
  all: ['co-owners'] as const,
  user: (userId: string) => [...coOwnerKeys.all, userId] as const,
  members: (userId: string, petId: string) => [...coOwnerKeys.user(userId), 'members', petId] as const,
  invitations: (userId: string) => [...coOwnerKeys.user(userId), 'invitations'] as const,
};

function useCoOwnerSession() {
  const auth = useAuth();
  return { auth, userId: auth.user?.id ?? '' };
}

/** Co-tutores de una mascota. Una mascota aún sin crear en el servidor no tiene. */
export function usePetMembers(petId: string) {
  const { auth, userId } = useCoOwnerSession();
  return useQuery({
    queryKey: coOwnerKeys.members(userId, petId),
    enabled: auth.canUseServer && userId !== '' && !isLocalPetId(petId),
    queryFn: () => auth.serverCall(() => fetchPetMembers(petId)),
  });
}

/** Invitaciones pendientes del usuario (Hoy, sin mascotas, configuración inicial y su pantalla). */
export function useMyInvitations() {
  const { auth, userId } = useCoOwnerSession();
  return useQuery({
    queryKey: coOwnerKeys.invitations(userId),
    enabled: auth.canUseServer && userId !== '',
    queryFn: () => auth.serverCall(() => fetchMyInvitations()),
  });
}

/** Tras cambiar los miembros: la lista de la mascota se vuelve a pedir. */
function useMembersChanged(petId: string) {
  const queryClient = useQueryClient();
  const { userId } = useCoOwnerSession();
  return () => queryClient.invalidateQueries({ queryKey: coOwnerKeys.members(userId, petId) });
}

export function useInviteMember(petId: string) {
  const { auth } = useCoOwnerSession();
  const changed = useMembersChanged(petId);
  return useMutation({
    mutationFn: ({ email, role }: { email: string; role: CoOwnerRole }) =>
      auth.serverCall(() => inviteByEmail(petId, email, role)),
    onSettled: changed,
  });
}

export function useRevokeMember(petId: string) {
  const { auth } = useCoOwnerSession();
  const changed = useMembersChanged(petId);
  return useMutation({
    mutationFn: (invitationId: string) => auth.serverCall(() => revokeMember(invitationId)),
    onSettled: changed,
  });
}

export function useChangeMemberRole(petId: string) {
  const { auth } = useCoOwnerSession();
  const changed = useMembersChanged(petId);
  return useMutation({
    mutationFn: ({ invitationId, role }: { invitationId: string; role: CoOwnerRole }) =>
      auth.serverCall(() => changeMemberRole(invitationId, role)),
    onSettled: changed,
  });
}

/**
 * Aceptar o rechazar una invitación. Al aceptar, la mascota pasa a la lista (RLS `is_pet_member`): se
 * vuelven a pedir las mascotas del usuario.
 */
export function useRespondInvitation() {
  const queryClient = useQueryClient();
  const { auth, userId } = useCoOwnerSession();
  return useMutation({
    mutationFn: ({ invitationId, accept }: { invitationId: string; accept: boolean }) =>
      auth.serverCall(() => (accept ? acceptInvitation(invitationId) : declineInvitation(invitationId))),
    onSettled: async (_data, _error, { accept }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: coOwnerKeys.invitations(userId) }),
        accept ? queryClient.invalidateQueries({ queryKey: petKeys.lists(userId) }) : null,
      ]);
    },
  });
}
