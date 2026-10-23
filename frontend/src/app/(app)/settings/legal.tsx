import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { StyleSheet } from 'react-native';

import { Card } from '@/components/ui/card';
import { ListItem } from '@/components/ui/list-item';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { TopBar } from '@/components/ui/top-bar';
import { DISCLAIMER_VERSION } from '@/features/profile/onboarding';
import { t } from '@/i18n';
import { spacing } from '@/theme/tokens';

/**
 * Información legal y de la app (tablero 10.8): versión, aviso veterinario y cómo se tratan los datos.
 * Los términos y la política de privacidad completos los redacta asesoría legal (PRD §13): hasta
 * entonces se dice, sin enlaces a páginas que no existen.
 */
export default function LegalScreen() {
  const router = useRouter();
  const version = Constants.expoConfig?.version ?? '—';
  return (
    <Screen align="top">
      <TopBar onBack={() => (router.canGoBack() ? router.back() : router.replace('/settings'))} title={t('settings.legalScreen.title')} />
      <Card flush>
        <ListItem plain title={t('settings.legalScreen.version')} value={version} />
      </Card>
      <Card variant="flat" style={styles.block}>
        <Text variant="bodyStrong">{`${t('settings.legalScreen.disclaimerTitle')} · ${DISCLAIMER_VERSION}`}</Text>
        <Text color="inkMuted">{t('settings.legalScreen.disclaimerText')}</Text>
      </Card>
      <Card variant="flat" style={styles.block}>
        <Text variant="bodyStrong">{t('settings.legalScreen.dataTitle')}</Text>
        <Text color="inkMuted">{t('settings.legalScreen.dataText')}</Text>
      </Card>
      <Card variant="flat" style={styles.block}>
        <Text variant="bodyStrong">{t('settings.legalScreen.termsTitle')}</Text>
        <Text color="inkMuted">{t('settings.legalScreen.termsText')}</Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: spacing['2'],
  },
});
