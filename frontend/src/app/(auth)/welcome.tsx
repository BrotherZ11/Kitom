import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Logotype } from '@/components/ui/logotype';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { WeekRing } from '@/components/ui/week-ring';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';
import { withAlpha } from '@/theme/color';
import { spacing } from '@/theme/tokens';

/** Los seis días de la ilustración del tablero 1.1 (no son datos de nadie). */
const ILLUSTRATION_DAYS = ['on', 'on', 'on', 'on', 'on', 'on'] as const;

/**
 * Bienvenida (tablero 1.1): primera pantalla sin sesión. «Empezar» → Cómo funciona; «Ya tengo cuenta»
 * → Login. Fondo `laguna-900` con el logotipo inverso; el anillo es una ilustración fija de marca.
 */
export default function WelcomeScreen() {
  const router = useRouter();
  const theme = useTheme();

  return (
    <Screen
      background="surfaceInverse"
      footer={
        <>
          <Button variant="inverse" label={t('auth.welcome.start')} onPress={() => router.push('/onboarding')} />
          <Button
            variant="inverseOutline"
            label={t('auth.welcome.haveAccount')}
            onPress={() => router.push('/login')}
          />
          <Text variant="caption" style={[styles.center, { color: withAlpha(theme.inkInverse, 0.7) }]}>
            {t('auth.welcome.dedication')}
          </Text>
        </>
      }>
      <StatusBar style="light" />
      <View style={styles.composition}>
        <View style={styles.centerRow}>
          <Logotype width={156} inverse />
        </View>
        <View style={styles.centerRow}>
          <WeekRing days={ILLUSTRATION_DAYS} today="done" text="6/7" size={220} inverse accessibilityLabel={t('auth.welcome.ringLabel')} />
        </View>
        <View style={styles.copy}>
          <Text variant="display" color="inkInverse" style={styles.center} accessibilityRole="header">
            {t('auth.welcome.headline')}
          </Text>
          <Text variant="bodyLg" style={[styles.center, styles.description, { color: withAlpha(theme.inkInverse, 0.82) }]}>
            {t('auth.welcome.description')}
          </Text>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // El tablero reparte logotipo, anillo y texto (`justify-content: space-between`) y empieza a 84 px
  // del borde: 44 de barra de estado + 14 de `Screen` + 26.
  composition: {
    flex: 1,
    justifyContent: 'space-between',
    paddingTop: 26,
    gap: spacing['6'],
  },
  centerRow: {
    alignItems: 'center',
  },
  copy: {
    gap: spacing['3'],
    alignItems: 'center',
  },
  center: {
    textAlign: 'center',
  },
  description: {
    maxWidth: 320,
  },
});
