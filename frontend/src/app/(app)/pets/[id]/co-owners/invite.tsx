import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Mail, X } from '@/components/ui/icons';
import { EmptyState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { useToast } from '@/components/ui/toast';
import { TopBar } from '@/components/ui/top-bar';
import {
  CO_OWNER_ROLES,
  isPlausibleEmail,
  normalizeEmail,
  toCoOwnerErrorCode,
  type CoOwnerRole,
} from '@/features/co-owners/co-owners-model';
import { CoOwnersGate } from '@/features/co-owners/components/co-owners-gate';
import { useInviteMember } from '@/features/co-owners/hooks/use-co-owners';
import type { Pet } from '@/features/pets/types';
import { t, tf } from '@/i18n';
import { createSubmitGuard } from '@/lib/submit-guard';

/** Invitar a un co-tutor por email (`invite_pet_member_by_email`). Solo para quien es titular. */
export default function InviteCoOwnerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CoOwnersGate petId={id}>{(pet, isHolder) => <InviteForm pet={pet} isHolder={isHolder} />}</CoOwnersGate>;
}

function InviteForm({ pet, isHolder }: { pet: Pet; isHolder: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const invite = useInviteMember(pet.id);
  const [guard] = useState(createSubmitGuard);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<CoOwnerRole>('viewer');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const close = () => (router.canGoBack() ? router.back() : router.replace({ pathname: '/pets/[id]/co-owners', params: { id: pet.id } }));

  if (!isHolder) {
    return (
      <Screen align="top">
        <TopBar onBack={close} backIcon={X} />
        <EmptyState title={t('coOwners.errors.not_owner')} actionLabel={t('common.back')} onAction={close} />
      </Screen>
    );
  }

  const submit = () => {
    void guard.run(async () => {
      setError(null);
      if (!isPlausibleEmail(email)) {
        setEmailError(t('coOwners.errors.invalid_email'));
        return;
      }
      setEmailError(null);
      try {
        await invite.mutateAsync({ email, role });
        toast({ message: tf('coOwners.inviteScreen.sent', { email: normalizeEmail(email) }) });
        close();
      } catch (cause) {
        const code = toCoOwnerErrorCode(cause);
        if (code === 'invalid_email') setEmailError(t('coOwners.errors.invalid_email'));
        else setError(t(`coOwners.errors.${code}`));
      }
    });
  };

  return (
    <Screen
      align="top"
      footer={
        <>
          {error ? <Alert tone="error" message={error} /> : null}
          <Button
            label={t('coOwners.inviteScreen.send')}
            loadingLabel={t('coOwners.inviteScreen.sending')}
            icon={Mail}
            loading={invite.isPending}
            onPress={submit}
          />
        </>
      }>
      <TopBar onBack={close} backIcon={X} />
      <Text variant="title1" accessibilityRole="header">
        {tf('coOwners.inviteScreen.title', { name: pet.name })}
      </Text>
      <TextField
        label={t('coOwners.inviteScreen.email')}
        hint={t('coOwners.inviteScreen.emailHint')}
        value={email}
        onChangeText={(value) => {
          setEmail(value);
          if (emailError) setEmailError(null);
        }}
        error={emailError}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="send"
        onSubmitEditing={submit}
      />
      <SegmentedControl
        label={t('coOwners.inviteScreen.role')}
        options={CO_OWNER_ROLES.map((value) => ({ value, label: t(`coOwners.roles.${value}`) }))}
        value={role}
        onChange={setRole}
      />
      <Text variant="caption" color="inkMuted">
        {t(`coOwners.roleHelp.${role}`)}
      </Text>
      <Alert tone="info" message={t('coOwners.inviteScreen.privacy')} />
    </Screen>
  );
}
