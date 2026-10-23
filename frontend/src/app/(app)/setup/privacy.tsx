import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Camera, Mail, Shield } from '@/components/ui/icons';
import { ListItem } from '@/components/ui/list-item';
import { Switch } from '@/components/ui/switch';
import { Tag } from '@/components/ui/tag';
import { Text } from '@/components/ui/text';
import { useMyInvitations } from '@/features/co-owners/hooks/use-co-owners';
import { useActivePet } from '@/features/pets/active-pet-context';
import { SetupFrame } from '@/features/profile/components/setup-frame';
import { useCompleteOnboarding, useProfile, useUpdateProfile } from '@/features/profile/hooks/use-profile';
import { t } from '@/i18n';
import { createSubmitGuard } from '@/lib/submit-guard';
import { spacing } from '@/theme/tokens';

/**
 * Datos y privacidad (tablero 2.4, paso 3): qué se usa y comunicaciones opcionales (desactivadas por
 * defecto, `marketing_opt_in`). Después, la primera mascota; quien ya tiene mascotas termina aquí y
 * quien no tiene pero sí invitaciones pasa a «Te han invitado» (puede aceptar en vez de crear una).
 */
export default function SetupPrivacyScreen() {
  const router = useRouter();
  const profile = useProfile();
  const update = useUpdateProfile();
  const complete = useCompleteOnboarding();
  const { pets } = useActivePet();
  const invitations = useMyInvitations();
  const [marketing, setMarketing] = useState(profile.data?.marketing_opt_in ?? false);
  const [error, setError] = useState<string | null>(null);
  const [guard] = useState(createSubmitGuard);
  const petsKnown = pets.view.state === 'ready';
  const hasPets = pets.view.state === 'ready' && (pets.view.pets.length > 0 || pets.drafts.length > 0);
  const busy = update.isPending || complete.isPending;

  const submit = () => {
    void guard.run(async () => {
      setError(null);
      try {
        if (marketing !== (profile.data?.marketing_opt_in ?? false)) await update.mutateAsync({ marketing_opt_in: marketing });
        if (hasPets) {
          await complete.mutateAsync();
          router.replace('/');
        } else if ((invitations.data?.length ?? 0) > 0) {
          router.push({ pathname: '/invitations', params: { setup: '1' } });
        } else {
          router.push({ pathname: '/pets/new', params: { setup: '1' } });
        }
      } catch {
        setError(t('setup.errors.save'));
      }
    });
  };

  return (
    <SetupFrame
      step={3}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/setup/disclaimer'))}
      title={t('setup.privacy.title')}
      text={t('setup.privacy.text')}
      footer={
        <>
          {error ? <Alert tone="error" message={error} /> : null}
          <Button
            label={t('setup.continue')}
            loading={busy || !petsKnown}
            loadingLabel={busy ? t('setup.saving') : t('common.loading')}
            onPress={submit}
          />
        </>
      }>
      <Card flush>
        <ListItem
          icon={Shield}
          title={t('setup.privacy.dataTitle')}
          subtitle={t('setup.privacy.dataText')}
          trailing={<Tag label={t('setup.privacy.required')} />}
          divider
        />
        <ListItem icon={Camera} title={t('setup.privacy.photosTitle')} subtitle={t('setup.privacy.photosText')} divider />
        <ListItem
          icon={Mail}
          title={t('setup.privacy.marketingTitle')}
          subtitle={t('setup.privacy.marketingText')}
          trailing={
            <View style={styles.switch}>
              <Switch value={marketing} onValueChange={setMarketing} accessibilityLabel={t('setup.privacy.marketingTitle')} />
            </View>
          }
        />
      </Card>
      <Text variant="caption" color="inkMuted">
        {t('setup.privacy.footer')}
      </Text>
    </SetupFrame>
  );
}

const styles = StyleSheet.create({
  switch: {
    paddingLeft: spacing['2'],
  },
});
