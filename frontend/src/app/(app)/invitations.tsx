import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Check, Users, X } from '@/components/ui/icons';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { useToast } from '@/components/ui/toast';
import { TopBar } from '@/components/ui/top-bar';
import { useAuth } from '@/features/auth/auth-context';
import { toCoOwnerErrorCode, type Invitation } from '@/features/co-owners/co-owners-model';
import { useMyInvitations, useRespondInvitation } from '@/features/co-owners/hooks/use-co-owners';
import { useActivePet } from '@/features/pets/active-pet-context';
import { useCompleteOnboarding } from '@/features/profile/hooks/use-profile';
import { formatFullDate } from '@/features/reminders/reminder-format';
import { useIsOnline } from '@/hooks/use-is-online';
import { getLocale, t, tf } from '@/i18n';
import { spacing } from '@/theme/tokens';

/**
 * Invitaciones pendientes para cuidar mascotas de otras personas (`get_my_pet_invitations`), con
 * aceptar y rechazar. Con `?setup=1` es un paso de la configuración inicial: quien llega invitado puede
 * terminarla al aceptar, sin tener que crear una mascota propia.
 */
export default function InvitationsScreen() {
  const { setup } = useLocalSearchParams<{ setup?: string }>();
  const inSetup = setup === '1';
  const router = useRouter();
  const toast = useToast();
  const { canUseServer } = useAuth();
  const online = useIsOnline();
  const invitations = useMyInvitations();
  const respond = useRespondInvitation();
  const complete = useCompleteOnboarding();
  const { pets } = useActivePet();
  const [busy, setBusy] = useState<{ id: string; accept: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hasPets = pets.view.state === 'ready' && pets.view.pets.length > 0;
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const answer = (invitation: Invitation, accept: boolean) => {
    setError(null);
    setBusy({ id: invitation.invitationId, accept });
    respond.mutate(
      { invitationId: invitation.invitationId, accept },
      {
        onSuccess: () =>
          toast({ message: accept ? tf('coOwners.invitations.accepted', { pet: invitation.petName }) : t('coOwners.invitations.declined') }),
        onError: (cause) => setError(t(`coOwners.errors.${toCoOwnerErrorCode(cause)}`)),
        onSettled: () => setBusy(null),
      }
    );
  };

  const finishSetup = () => {
    setError(null);
    complete.mutate(undefined, {
      onSuccess: () => router.replace('/'),
      onError: () => setError(t('setup.errors.save')),
    });
  };

  const content = () => {
    if (!canUseServer || !online) {
      return <ErrorState offline message={t('coOwners.offlineTitle')} description={t('coOwners.offlineText')} />;
    }
    if (invitations.isPending) return <LoadingState />;
    if (invitations.isError) {
      return <ErrorState message={t('coOwners.invitations.loadError')} onRetry={() => void invitations.refetch()} />;
    }
    if (invitations.data.length === 0) {
      // En la configuración inicial, tras aceptar, solo queda «Continuar».
      if (inSetup && hasPets) return null;
      return <EmptyState icon={Users} title={t('coOwners.invitations.emptyTitle')} description={t('coOwners.invitations.emptyText')} />;
    }
    return invitations.data.map((invitation) => (
      <InvitationCard
        key={invitation.invitationId}
        invitation={invitation}
        busy={busy?.id === invitation.invitationId ? (busy.accept ? 'accept' : 'decline') : null}
        disabled={busy !== null}
        onAnswer={(accept) => answer(invitation, accept)}
      />
    ));
  };

  return (
    <Screen
      align="top"
      footer={
        <>
          {error ? <Alert tone="error" message={error} /> : null}
          {inSetup && hasPets ? (
            <Button label={t('coOwners.invitations.continue')} loading={complete.isPending} onPress={finishSetup} />
          ) : null}
          {inSetup ? (
            <Button
              label={t('coOwners.invitations.ownPet')}
              variant={hasPets ? 'ghost' : 'primary'}
              size={hasPets ? 'md' : 'lg'}
              onPress={() => router.push({ pathname: '/pets/new', params: { setup: '1' } })}
            />
          ) : null}
        </>
      }>
      <TopBar onBack={close} backIcon={inSetup ? undefined : X} title={inSetup ? undefined : t('coOwners.invitations.title')} />
      {inSetup ? (
        <View style={styles.heading}>
          <Text variant="title1" accessibilityRole="header">
            {t('coOwners.invitations.setupTitle')}
          </Text>
          <Text color="inkMuted">{t('coOwners.invitations.setupText')}</Text>
        </View>
      ) : null}
      {content()}
    </Screen>
  );
}

function InvitationCard({
  invitation,
  busy,
  disabled,
  onAnswer,
}: {
  invitation: Invitation;
  /** Respuesta en curso de esta invitación. */
  busy: 'accept' | 'decline' | null;
  disabled: boolean;
  onAnswer: (accept: boolean) => void;
}) {
  return (
    <Card>
      <View style={styles.card}>
        <Text variant="bodyStrong">
          {invitation.invitedByName
            ? tf('coOwners.invitations.entryOne', { by: invitation.invitedByName, pet: invitation.petName })
            : tf('coOwners.invitations.entryOneNoName', { pet: invitation.petName })}
        </Text>
        <Text variant="caption" color="inkMuted">
          {`${tf('coOwners.invitations.role', { role: t(`coOwners.roles.${invitation.role}`) })} · ${formatFullDate(new Date(invitation.invitedAt), getLocale())}`}
        </Text>
        <View style={styles.actions}>
          <View style={styles.flex}>
            <Button
              label={t('coOwners.invitations.decline')}
              variant="secondary"
              size="md"
              loading={busy === 'decline'}
              disabled={disabled && busy !== 'decline'}
              onPress={() => onAnswer(false)}
            />
          </View>
          <View style={styles.flex}>
            <Button
              label={t('coOwners.invitations.accept')}
              icon={Check}
              size="md"
              loading={busy === 'accept'}
              disabled={disabled && busy !== 'accept'}
              onPress={() => onAnswer(true)}
            />
          </View>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  heading: {
    gap: spacing['2'],
  },
  card: {
    gap: spacing['3'],
  },
  actions: {
    flexDirection: 'row',
    gap: spacing['3'],
  },
  flex: {
    flex: 1,
  },
});
