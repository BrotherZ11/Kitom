import { useRouter } from 'expo-router';
import { useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Clock, Globe } from '@/components/ui/icons';
import { ListItem } from '@/components/ui/list-item';
import { ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { useAuth } from '@/features/auth/auth-context';
import { SetupFrame } from '@/features/profile/components/setup-frame';
import { useProfile, useUpdateProfile } from '@/features/profile/hooks/use-profile';
import { PROFILE_NAME_MAX_LENGTH, validateProfileName } from '@/features/profile/onboarding';
import { getDeviceTimeZone } from '@/features/profile/timezone';
import { t, tf } from '@/i18n';
import { createSubmitGuard } from '@/lib/submit-guard';

/** Configuración inicial, paso 1 (tablero 2.1): tu nombre, idioma y zona horaria. */
export default function SetupProfileScreen() {
  const profile = useProfile();
  if (profile.isPending) {
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  }
  if (profile.isError) {
    return (
      <Screen>
        <ErrorState message={t('setup.errors.load')} description={t('setup.errors.loadText')} onRetry={() => void profile.refetch()} />
      </Screen>
    );
  }
  return <SetupProfileForm initialName={profile.data?.full_name ?? ''} profileTimeZone={profile.data?.timezone ?? null} />;
}

function SetupProfileForm({ initialName, profileTimeZone }: { initialName: string; profileTimeZone: string | null }) {
  const router = useRouter();
  const { user } = useAuth();
  const update = useUpdateProfile();
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [guard] = useState(createSubmitGuard);
  const fromGoogle = initialName !== '' && user?.app_metadata?.provider === 'google';
  const timeZone = profileTimeZone ?? getDeviceTimeZone();

  const submit = () => {
    void guard.run(async () => {
      if (validateProfileName(name)) {
        setError(tf('setup.profile.nameTooLong', { max: PROFILE_NAME_MAX_LENGTH }));
        return;
      }
      setSubmitError(null);
      const trimmed = name.trim();
      try {
        // Solo se escribe si cambia; vacío no borra un nombre que ya hubiera.
        if (trimmed !== '' && trimmed !== initialName.trim()) await update.mutateAsync({ full_name: trimmed });
        router.push('/setup/disclaimer');
      } catch {
        setSubmitError(t('setup.errors.save'));
      }
    });
  };

  return (
    <SetupFrame
      step={1}
      title={t('setup.profile.title')}
      text={t('setup.profile.text')}
      footer={
        <>
          {submitError ? <Alert tone="error" message={submitError} /> : null}
          <Button label={t('setup.continue')} loading={update.isPending} loadingLabel={t('setup.saving')} onPress={submit} />
        </>
      }>
      <TextField
        label={t('setup.profile.name')}
        value={name}
        onChangeText={(value) => {
          setName(value);
          setError(null);
        }}
        autoComplete="given-name"
        textContentType="givenName"
        autoCapitalize="words"
        returnKeyType="done"
        onSubmitEditing={submit}
        maxLength={PROFILE_NAME_MAX_LENGTH + 10}
        hint={fromGoogle ? t('setup.profile.nameFromGoogle') : undefined}
        error={error}
        optional
      />
      <Card flush>
        <ListItem
          plain
          icon={Globe}
          title={t('setup.profile.language')}
          subtitle={t('setup.profile.languageText')}
          value={t('setup.profile.languageValue')}
          divider
        />
        <ListItem
          plain
          icon={Clock}
          title={t('setup.profile.timezone')}
          subtitle={t('setup.profile.timezoneText')}
          value={timeZone ? timeZone.split('/').pop()?.replace(/_/g, ' ') : t('settings.timezoneUnset')}
        />
      </Card>
    </SetupFrame>
  );
}
