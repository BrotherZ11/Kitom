import { useRouter } from 'expo-router';

import { Alert } from '@/components/ui/alert';
import { Users } from '@/components/ui/icons';
import { useMyInvitations } from '@/features/co-owners/hooks/use-co-owners';
import { t, tf } from '@/i18n';

/**
 * Aviso de invitaciones pendientes para cuidar mascotas de otras personas, con acceso a «Invitaciones».
 * Sin invitaciones (o sin poder preguntarlo) no ocupa sitio.
 */
export function InvitationsEntry() {
  const router = useRouter();
  const invitations = useMyInvitations();
  const items = invitations.data ?? [];
  if (items.length === 0) return null;

  const [first] = items;
  const message =
    items.length > 1
      ? tf('coOwners.invitations.entry', { count: items.length })
      : first.invitedByName
        ? tf('coOwners.invitations.entryOne', { by: first.invitedByName, pet: first.petName })
        : tf('coOwners.invitations.entryOneNoName', { pet: first.petName });
  return (
    <Alert
      tone="info"
      icon={Users}
      message={message}
      action={{ label: t('coOwners.invitations.open'), onPress: () => router.push('/invitations') }}
    />
  );
}
