import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

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

/** Por debajo de esta altura (dp) la composición se compacta: anillo más pequeño y menos aire. */
const COMPACT_HEIGHT = 720;

/**
 * Tamaño del anillo según la altura de la pantalla: 220 como el tablero en móviles altos y menos en los
 * bajos (360×640), donde con 220 el texto quedaba bajo los botones y solo asomaba una franja.
 */
function ringSize(windowHeight: number): number {
  return Math.round(Math.min(220, Math.max(140, windowHeight * 0.26)));
}

/**
 * Bienvenida (tablero 1.1): primera pantalla sin sesión. «Empezar» → Cómo funciona; «Ya tengo cuenta»
 * → Login. Fondo `laguna-900` con el logotipo inverso; el anillo es una ilustración fija de marca.
 */
export default function WelcomeScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { height } = useWindowDimensions();
  const compact = height < COMPACT_HEIGHT;

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
        </>
      }>
      <StatusBar style="light" />
      <View style={[styles.composition, compact && styles.compositionCompact]}>
        <View style={styles.centerRow}>
          <Logotype width={156} inverse />
        </View>
        <View style={styles.centerRow}>
          <WeekRing days={ILLUSTRATION_DAYS} today="done" text="6/7" size={ringSize(height)} inverse accessibilityLabel={t('auth.welcome.ringLabel')} />
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
  // del borde: 44 de barra de estado + 14 de `Screen` + 26. `flexGrow` y no `flex: 1`: en un móvil bajo,
  // `flex: 1` encogía el texto (lo cortaba bajo los botones) en vez de dejar que la pantalla se desplace.
  composition: {
    flexGrow: 1,
    justifyContent: 'space-between',
    paddingTop: 26,
    gap: spacing['6'],
  },
  compositionCompact: {
    paddingTop: 0,
    gap: spacing['4'],
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
