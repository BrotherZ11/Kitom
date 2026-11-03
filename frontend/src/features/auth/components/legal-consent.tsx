import * as WebBrowser from 'expo-web-browser';
import { StyleSheet, View } from 'react-native';

import { Checkbox } from '@/components/ui/checkbox';
import { Text } from '@/components/ui/text';
import { TextLink } from '@/components/ui/text-link';
import { t } from '@/i18n';
import { PRIVACY_POLICY_URL, TERMS_URL } from '@/lib/legal-links';
import { spacing } from '@/theme/tokens';

/** Abre una página legal en el navegador dentro de la app. Si no se puede abrir, no pasa nada más. */
function openLegalPage(url: string) {
  WebBrowser.openBrowserAsync(url).catch((error: unknown) => {
    if (__DEV__) console.warn('[auth] legal page', error);
  });
}

/** Enlaces a los Términos y a la Política de privacidad (navegador dentro de la app). */
function LegalLinks() {
  return (
    <View style={styles.links}>
      <TextLink
        label={t('auth.legal.terms')}
        accessibilityLabel={t('auth.legal.openTerms')}
        onPress={() => openLegalPage(TERMS_URL)}
      />
      <TextLink
        label={t('auth.legal.privacy')}
        accessibilityLabel={t('auth.legal.openPrivacy')}
        onPress={() => openLegalPage(PRIVACY_POLICY_URL)}
      />
    </View>
  );
}

/**
 * Casilla obligatoria del registro con email: «Acepto los Términos y la Política de privacidad» y los
 * enlaces a ambos. Sin marcarla no se envía el registro (`validateSignUp`: `terms_not_accepted`).
 */
export function TermsConsent({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <View style={styles.block}>
      <Checkbox checked={checked} onChange={onChange} label={t('auth.legal.accept')} />
      <LegalLinks />
    </View>
  );
}

/** Aviso bajo «Continuar con Google»: la primera vez crea la cuenta, así que aceptar va en el texto. */
export function GoogleTermsNotice() {
  return (
    <View style={styles.block}>
      <Text variant="caption" color="inkMuted">
        {t('auth.legal.googleNotice')}
      </Text>
      <LegalLinks />
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: spacing['2'],
  },
  links: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: spacing['5'],
    rowGap: spacing['2'],
  },
});
