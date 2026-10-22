import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { ChevronDown } from '@/components/ui/icons';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { TopBar } from '@/components/ui/top-bar';
import { useTheme } from '@/hooks/use-theme';
import { t, type TranslationKey } from '@/i18n';
import { borderWidth, size, spacing } from '@/theme/tokens';

const FAQ = ['vet', 'streak', 'offline', 'photos', 'reminders', 'pets'] as const;
type Faq = (typeof FAQ)[number];

/** Ayuda (tablero 10.7): preguntas frecuentes desplegables, una abierta a la vez. */
export default function HelpScreen() {
  const router = useRouter();
  const [open, setOpen] = useState<Faq | null>('vet');
  return (
    <Screen align="top">
      <TopBar onBack={() => (router.canGoBack() ? router.back() : router.replace('/settings'))} title={t('settings.helpScreen.title')} />
      <Text color="inkMuted">{t('settings.helpScreen.intro')}</Text>
      <Card flush>
        {FAQ.map((item, index) => (
          <FaqItem
            key={item}
            question={t(`settings.helpScreen.${item}Q` as TranslationKey)}
            answer={t(`settings.helpScreen.${item}A` as TranslationKey)}
            open={open === item}
            divider={index < FAQ.length - 1}
            onToggle={() => setOpen((current) => (current === item ? null : item))}
          />
        ))}
      </Card>
    </Screen>
  );
}

function FaqItem({
  question,
  answer,
  open,
  divider,
  onToggle,
}: {
  question: string;
  answer: string;
  open: boolean;
  divider: boolean;
  onToggle: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={divider && { borderBottomWidth: borderWidth.hairline, borderBottomColor: theme.line }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={question}
        onPress={onToggle}
        style={({ pressed }) => [styles.question, pressed && { backgroundColor: theme.surfaceSunken }]}>
        <Text variant="bodyStrong" style={styles.flex}>
          {question}
        </Text>
        <View style={open && styles.rotated}>
          <Icon icon={ChevronDown} size="sm" color="inkMuted" />
        </View>
      </Pressable>
      {open ? (
        <Text color="inkMuted" style={styles.answer}>
          {answer}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  question: {
    minHeight: size.listRow,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing['3'],
    paddingHorizontal: spacing['4'],
    paddingVertical: spacing['3'],
  },
  flex: {
    flex: 1,
  },
  rotated: {
    transform: [{ rotate: '180deg' }],
  },
  answer: {
    paddingHorizontal: spacing['4'],
    paddingBottom: spacing['4'],
  },
});
