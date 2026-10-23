import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Alert } from '@/components/ui/alert';
import { Avatar } from '@/components/ui/avatar';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Pencil, Eye, UserMinus, UserPlus, Users } from '@/components/ui/icons';
import { ListItem } from '@/components/ui/list-item';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { Tag } from '@/components/ui/tag';
import { Text } from '@/components/ui/text';
import { useToast } from '@/components/ui/toast';
import { TopBar } from '@/components/ui/top-bar';
import { useAuth } from '@/features/auth/auth-context';
import { toCoOwnerErrorCode, type Member } from '@/features/co-owners/co-owners-model';
import { CoOwnersGate } from '@/features/co-owners/components/co-owners-gate';
import { useChangeMemberRole, usePetMembers, useRevokeMember } from '@/features/co-owners/hooks/use-co-owners';
import type { Pet } from '@/features/pets/types';
import { formatFullDate } from '@/features/reminders/reminder-format';
import { getLocale, t, tf } from '@/i18n';
import { spacing } from '@/theme/tokens';

/**
 * Co-tutores de una mascota (`CoOwnersScreen`). La ven todos sus miembros; solo quien es titular invita,
 * cambia el permiso y quita el acceso (lo decide el servidor en cada RPC).
 */
export default function CoOwnersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CoOwnersGate petId={id}>{(pet, isHolder) => <CoOwnersList pet={pet} isHolder={isHolder} />}</CoOwnersGate>;
}

function CoOwnersList({ pet, isHolder }: { pet: Pet; isHolder: boolean }) {
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();
  const members = usePetMembers(pet.id);
  const changeRole = useChangeMemberRole(pet.id);
  const revoke = useRevokeMember(pet.id);
  const [selected, setSelected] = useState<Member | null>(null);
  const [confirming, setConfirming] = useState<Member | null>(null);
  const [error, setError] = useState<string | null>(null);
  const close = () => (router.canGoBack() ? router.back() : router.replace('/profile'));
  const openInvite = () => router.push({ pathname: '/pets/[id]/co-owners/invite', params: { id: pet.id } });
  const locale = getLocale();
  const nameOf = (member: Member) =>
    member.userId === user?.id ? t('coOwners.you') : (member.fullName ?? t('coOwners.noName'));

  const setRole = (member: Member, role: Member['role']) => {
    setSelected(null);
    changeRole.mutate(
      { invitationId: member.invitationId, role },
      { onError: (cause) => toast({ message: t(`coOwners.errors.${toCoOwnerErrorCode(cause)}`) }) }
    );
  };

  const confirmRevoke = () => {
    if (!confirming) return;
    setError(null);
    revoke.mutate(confirming.invitationId, {
      onSuccess: () => setConfirming(null),
      onError: (cause) => {
        const code = toCoOwnerErrorCode(cause);
        if (code === 'changed') {
          // Ya no estaba activa: la lista se ha vuelto a pedir, no hay nada más que hacer.
          setConfirming(null);
          toast({ message: t('coOwners.errors.changed') });
          return;
        }
        setError(t(`coOwners.errors.${code}`));
      },
    });
  };

  const content = () => {
    if (members.isPending) return <LoadingState />;
    if (members.isError) {
      const code = toCoOwnerErrorCode(members.error);
      return (
        <ErrorState
          offline={code === 'network'}
          message={code === 'not_member' ? t('coOwners.errors.not_member') : tf('coOwners.loadError', { name: pet.name })}
          onRetry={() => void members.refetch()}
        />
      );
    }
    return (
      <>
        <Card flush>
          <ListItem
            leading={<Avatar name={isHolder ? t('coOwners.you') : t('coOwners.holder')} size="sm" />}
            title={isHolder ? t('coOwners.you') : t('coOwners.holder')}
            subtitle={isHolder ? t('coOwners.holder') : tf('coOwners.holderText', { name: pet.name })}
            divider={members.data.length > 0}
          />
          {members.data.map((member, index) => (
            <ListItem
              key={member.invitationId}
              leading={<Avatar name={member.fullName ?? '?'} size="sm" tone="warm" />}
              title={nameOf(member)}
              subtitle={
                member.status === 'pending'
                  ? tf('coOwners.invitedOn', { date: formatFullDate(new Date(member.invitedAt), locale) })
                  : t(`coOwners.roles.${member.role}`)
              }
              trailing={member.status === 'pending' ? <Tag label={t('coOwners.pending')} /> : null}
              chevron={isHolder}
              onPress={isHolder ? () => setSelected(member) : undefined}
              divider={index < members.data.length - 1}
            />
          ))}
        </Card>
        {members.data.length === 0 && isHolder ? (
          <EmptyState icon={Users} title={tf('coOwners.emptyTitle', { name: pet.name })} description={t('coOwners.emptyText')} />
        ) : null}
        {isHolder ? (
          <View style={styles.help}>
            <Text variant="caption" color="inkMuted">
              {`${t('coOwners.roles.viewer')}: ${t('coOwners.roleHelp.viewer')}`}
            </Text>
            <Text variant="caption" color="inkMuted">
              {`${t('coOwners.roles.editor')}: ${t('coOwners.roleHelp.editor')}`}
            </Text>
          </View>
        ) : (
          <Alert tone="info" message={tf('coOwners.sharedNote', { name: pet.name })} />
        )}
      </>
    );
  };

  return (
    <>
      <Screen
        align="top"
        footer={isHolder ? <Button label={t('coOwners.invite')} icon={UserPlus} onPress={openInvite} /> : undefined}>
        <TopBar onBack={close} title={tf('coOwners.title', { name: pet.name })} />
        <Text color="inkMuted">{tf('coOwners.intro', { name: pet.name })}</Text>
        {content()}
      </Screen>

      <BottomSheet visible={selected !== null} title={selected ? nameOf(selected) : ''} onClose={() => setSelected(null)}>
        {selected ? (
          <Card flush>
            {selected.status === 'accepted' ? (
              <ListItem
                plain
                icon={selected.role === 'viewer' ? Pencil : Eye}
                title={selected.role === 'viewer' ? t('coOwners.manage.makeEditor') : t('coOwners.manage.makeViewer')}
                subtitle={t(`coOwners.roleHelp.${selected.role === 'viewer' ? 'editor' : 'viewer'}`)}
                chevron={false}
                divider
                onPress={() => setRole(selected, selected.role === 'viewer' ? 'editor' : 'viewer')}
              />
            ) : null}
            <ListItem
              plain
              icon={UserMinus}
              titleColor="dangerInk"
              title={selected.status === 'pending' ? t('coOwners.manage.cancel') : t('coOwners.manage.revoke')}
              chevron={false}
              onPress={() => {
                setConfirming(selected);
                setSelected(null);
              }}
            />
          </Card>
        ) : null}
      </BottomSheet>

      <Dialog
        visible={confirming !== null}
        tone="danger"
        icon={UserMinus}
        title={
          confirming?.status === 'pending'
            ? t('coOwners.cancelDialog.title')
            : tf('coOwners.revokeDialog.title', { name: confirming ? nameOf(confirming) : '' })
        }
        message={
          confirming?.status === 'pending'
            ? tf('coOwners.cancelDialog.text', { pet: pet.name })
            : tf('coOwners.revokeDialog.text', { pet: pet.name })
        }
        confirmLabel={confirming?.status === 'pending' ? t('coOwners.cancelDialog.confirm') : t('coOwners.revokeDialog.confirm')}
        loading={revoke.isPending}
        error={error}
        onConfirm={confirmRevoke}
        onCancel={() => {
          setConfirming(null);
          setError(null);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  help: {
    gap: spacing['2'],
  },
});
