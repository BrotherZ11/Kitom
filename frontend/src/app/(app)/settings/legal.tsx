import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Alert } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { FileText, Shield } from '@/components/ui/icons';
import { ListItem } from '@/components/ui/list-item';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { TextLink } from '@/components/ui/text-link';
import { TopBar } from '@/components/ui/top-bar';
import { DISCLAIMER_VERSION } from '@/features/profile/onboarding';
import { formatFullDate } from '@/features/reminders/reminder-format';
import { getLocale, t, tf } from '@/i18n';
import { PRIVACY_POLICY_URL, SUPPORT_EMAIL, TERMS_URL } from '@/lib/legal-links';
import { openSupportEmail, openWebPage } from '@/lib/open-link';
import { spacing } from '@/theme/tokens';

/** Fecha «En vigor desde» de la política de privacidad y los términos publicados en `site/`. */
const LEGAL_EFFECTIVE_DATE = new Date(2026, 9, 30);

/**
 * Información legal y de la app (tablero 10.8): versión, política de privacidad y términos (páginas
 * públicas de `site/`, abiertas en el navegador integrado), resumen, aviso veterinario y contacto del
 * responsable.
 */
export default function LegalScreen() {
  const router = useRouter();
  const version = Constants.expoConfig?.version ?? '—';
  const [error, setError] = useState<string | null>(null);

  const open = async (url: string) => {
    setError(null);
    if (!(await openWebPage(url))) setError(tf('settings.legalScreen.openError', { url }));
  };
  const write = async () => {
    setError(null);
    if (!(await openSupportEmail())) setError(tf('settings.helpScreen.mailError', { email: SUPPORT_EMAIL }));
  };

  return (
    <Screen align="top">
      <TopBar onBack={() => (router.canGoBack() ? router.back() : router.replace('/settings'))} title={t('settings.legalScreen.title')} />
      <Card flush>
        <ListItem plain title={t('settings.legalScreen.version')} value={version} />
      </Card>

      <View style={styles.group}>
        <Text variant="overline" color="inkMuted" accessibilityRole="header">
          {t('settings.legalScreen.documents')}
        </Text>
        <Card flush>
          <ListItem
            plain
            icon={Shield}
            title={t('settings.legalScreen.privacyPolicy')}
            subtitle={t('settings.legalScreen.privacyPolicyText')}
            onPress={() => void open(PRIVACY_POLICY_URL)}
            divider
          />
          <ListItem
            plain
            icon={FileText}
            title={t('settings.legalScreen.terms')}
            subtitle={t('settings.legalScreen.termsText')}
            onPress={() => void open(TERMS_URL)}
          />
        </Card>
        <Text variant="caption" color="inkMuted">
          {tf('settings.legalScreen.effective', { date: formatFullDate(LEGAL_EFFECTIVE_DATE, getLocale()) })}
        </Text>
      </View>
      {error ? <Alert tone="error" message={error} /> : null}

      <Card variant="flat" style={styles.block}>
        <Text variant="bodyStrong">{t('settings.legalScreen.summaryTitle')}</Text>
        <Text color="inkMuted">{t('settings.legalScreen.summaryText')}</Text>
      </Card>
      <Card variant="flat" style={styles.block}>
        <Text variant="bodyStrong">{`${t('settings.legalScreen.disclaimerTitle')} · ${DISCLAIMER_VERSION}`}</Text>
        <Text color="inkMuted">{t('settings.legalScreen.disclaimerText')}</Text>
      </Card>
      <Card variant="flat" style={styles.block}>
        <Text variant="bodyStrong">{t('settings.legalScreen.contactTitle')}</Text>
        <Text color="inkMuted">{t('settings.legalScreen.controller')}</Text>
        <TextLink label={SUPPORT_EMAIL} onPress={() => void write()} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: {
    gap: spacing['2'],
  },
  block: {
    gap: spacing['2'],
  },
});
