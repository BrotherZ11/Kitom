import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Icon } from '@/components/ui/icon';
import { Check, Stethoscope, TriangleAlert, type LucideIcon } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { SetupFrame } from '@/features/profile/components/setup-frame';
import { useProfile, useUpdateProfile } from '@/features/profile/hooks/use-profile';
import { DISCLAIMER_VERSION } from '@/features/profile/onboarding';
import { formatFullDate } from '@/features/reminders/reminder-format';
import { useTheme, type ThemeColor } from '@/hooks/use-theme';
import { getLocale, t, tf } from '@/i18n';
import { createSubmitGuard } from '@/lib/submit-guard';
import { borderWidth, radius, spacing } from '@/theme/tokens';

/**
 * Aviso veterinario (tablero 2.3, paso 2): aceptación explícita, obligatoria. Guarda
 * `disclaimer_accepted_at` y `disclaimer_version`. Con `?review=1` (desde Tu cuenta) solo se lee; si
 * la versión aceptada es otra, se vuelve a pedir.
 */
export default function SetupDisclaimerScreen() {
  const router = useRouter();
  const { review } = useLocalSearchParams<{ review?: string }>();
  const profile = useProfile();
  const update = useUpdateProfile();
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guard] = useState(createSubmitGuard);
  const isReview = review === '1';
  const acceptedAt = profile.data?.disclaimer_version === DISCLAIMER_VERSION ? profile.data.disclaimer_accepted_at : null;
  const back = () => (router.canGoBack() ? router.back() : router.replace(isReview ? '/settings' : '/setup/profile'));

  const submit = () => {
    void guard.run(async () => {
      if (!accepted) return;
      setError(null);
      try {
        await update.mutateAsync({ disclaimer_accepted_at: new Date().toISOString(), disclaimer_version: DISCLAIMER_VERSION });
        if (isReview) back();
        else router.push('/setup/privacy');
      } catch {
        setError(t('setup.errors.save'));
      }
    });
  };

  const footer =
    isReview && acceptedAt ? (
      <Button label={t('common.back')} variant="secondary" onPress={back} />
    ) : (
      <>
        {error ? <Alert tone="error" message={error} /> : null}
        <Button
          label={t('setup.disclaimer.submit')}
          disabled={!accepted}
          loading={update.isPending}
          loadingLabel={t('setup.saving')}
          onPress={submit}
        />
        <Text variant="caption" color="inkMuted" style={styles.center}>
          {t('setup.disclaimer.hint')}
        </Text>
      </>
    );

  return (
    <SetupFrame
      step={isReview ? undefined : 2}
      onBack={back}
      hero={<HeroIcon />}
      title={t('setup.disclaimer.title')}
      text={t('setup.disclaimer.intro')}
      footer={footer}>
      <Card flush>
        <Point icon={Check} color="primary" text={t('setup.disclaimer.guidance')} divider />
        <Point icon={Check} color="primary" text={t('setup.disclaimer.notMedical')} divider />
        <Point icon={TriangleAlert} color="urgent" text={t('setup.disclaimer.emergency')} strong />
      </Card>
      {isReview && acceptedAt ? (
        <Text variant="caption" color="inkMuted">
          {tf('setup.disclaimer.accepted', {
            date: formatFullDate(new Date(acceptedAt), getLocale()),
            version: DISCLAIMER_VERSION,
          })}
        </Text>
      ) : (
        <Checkbox checked={accepted} onChange={setAccepted} label={t('setup.disclaimer.accept')} />
      )}
    </SetupFrame>
  );
}

function HeroIcon() {
  const theme = useTheme();
  return (
    <View style={[styles.hero, { backgroundColor: theme.surfaceBrand }]}>
      <Icon icon={Stethoscope} size={32} color="primary" />
    </View>
  );
}

function Point({
  icon,
  color,
  text,
  divider = false,
  strong = false,
}: {
  icon: LucideIcon;
  color: ThemeColor;
  text: string;
  divider?: boolean;
  strong?: boolean;
}) {
  const theme = useTheme();
  return (
    <View
      accessible
      style={[styles.point, divider && { borderBottomWidth: borderWidth.hairline, borderBottomColor: theme.line }]}>
      <Icon icon={icon} size={20} color={color} />
      <Text variant={strong ? 'bodyStrong' : 'body'} style={styles.flex}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing['1'],
  },
  point: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing['3'],
    paddingVertical: 14,
    paddingHorizontal: spacing['4'],
  },
  flex: {
    flex: 1,
  },
  center: {
    textAlign: 'center',
  },
});
