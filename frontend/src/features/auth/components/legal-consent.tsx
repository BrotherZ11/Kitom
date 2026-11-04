import { useRouter } from 'expo-router';
import { StyleSheet } from 'react-native';

import { Text } from '@/components/ui/text';
import { t } from '@/i18n';
import type { LegalDocumentId } from '@/i18n/legal/legal-document-types';

/**
 * Aviso legal único de quien crea una cuenta: en el registro y, para quien entra por primera vez con Google
 * desde el inicio de sesión, en la configuración inicial. Abre los textos dentro de la app (`/legal/[doc]`).
 */
export function LegalNotice({ lead }: { lead: string }) {
  const router = useRouter();
  const link = (doc: LegalDocumentId, label: string, accessibilityLabel: string) => (
    <Text
      variant="caption"
      color="primary"
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel}
      onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc } })}
      style={styles.link}>
      {label}
    </Text>
  );

  return (
    <Text variant="caption" color="inkMuted">
      {`${lead} `}
      {link('terms', t('auth.legal.terms'), t('auth.legal.openTerms'))}
      {` ${t('auth.legal.and')} `}
      {link('privacy', t('auth.legal.privacy'), t('auth.legal.openPrivacy'))}
      {'.'}
    </Text>
  );
}

const styles = StyleSheet.create({
  link: {
    textDecorationLine: 'underline',
  },
});
