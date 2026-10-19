import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Calendar, ChartLine } from '@/components/ui/icons';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { TextLink } from '@/components/ui/text-link';
import { TopBar } from '@/components/ui/top-bar';
import { WeekRing } from '@/components/ui/week-ring';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';
import { spacing } from '@/theme/tokens';

/** Cómo funciona (tablero 1.2): tres ideas y a crear la cuenta. «Saltar» también lleva al registro. */
export default function HowItWorksScreen() {
  const router = useRouter();
  const goToRegister = () => router.push('/register');

  return (
    <Screen align="top" footer={<Button label={t('auth.howItWorks.createAccount')} onPress={goToRegister} />}>
      <TopBar
        onBack={router.canGoBack() ? () => router.back() : () => router.replace('/welcome')}
        backLabel={t('auth.back')}
        right={<TextLink label={t('auth.howItWorks.skip')} onPress={goToRegister} />}
      />

      <View style={styles.heading}>
        <Text variant="overline" color="inkMuted">
          {t('auth.howItWorks.overline')}
        </Text>
        <Text variant="title1" accessibilityRole="header">
          {t('auth.howItWorks.title')}
        </Text>
      </View>

      <View style={styles.cards}>
        <Idea
          icon={<WeekRing days={['on', 'on', 'on', 'off', 'off', 'off']} today="none" size={22} accessibilityLabel="" />}
          title={t('auth.howItWorks.logTitle')}
          text={t('auth.howItWorks.logText')}
        />
        <Idea
          icon={<Icon icon={ChartLine} size={22} color="primary" />}
          title={t('auth.howItWorks.understandTitle')}
          text={t('auth.howItWorks.understandText')}
        />
        <Idea
          icon={<Icon icon={Calendar} size={22} color="primary" />}
          title={t('auth.howItWorks.careTitle')}
          text={t('auth.howItWorks.careText')}
        />
      </View>

      <Text variant="caption" color="inkMuted">
        {t('auth.howItWorks.disclaimer')}
      </Text>
    </Screen>
  );
}

function Idea({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  const theme = useTheme();
  return (
    <Card style={styles.idea}>
      <View
        style={[styles.tile, { backgroundColor: theme.surfaceBrand }]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        {icon}
      </View>
      <View style={styles.ideaText}>
        <Text variant="title3" accessibilityRole="header">
          {title}
        </Text>
        <Text color="inkMuted">{text}</Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  heading: {
    gap: spacing['2'],
  },
  cards: {
    gap: spacing['4'],
  },
  idea: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing['4'],
  },
  tile: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ideaText: {
    flex: 1,
    gap: spacing['1'],
  },
});
