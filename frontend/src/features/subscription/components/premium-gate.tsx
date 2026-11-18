import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Crown } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import type { PaywallReason } from '@/features/subscription/plan-model';
import { t } from '@/i18n';
import { spacing } from '@/theme/tokens';

/**
 * Aviso de una función de Kitom Premium con el botón a la pantalla de Premium. Solo es UX: el servidor
 * ya rechaza lo que el plan no permite (`pet_limit_reached`, `premium_required`, `ai_quota_exceeded`).
 */
export function PremiumGate({
  reason,
  title,
  text,
  compact = false,
}: {
  reason: PaywallReason;
  title: string;
  text: string;
  compact?: boolean;
}) {
  const router = useRouter();
  return (
    <Card variant="brand">
      <View style={styles.body}>
        <View style={styles.header}>
          <Icon icon={Crown} color="primary" />
          <Text variant="title3" accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
        </View>
        <Text color="inkMuted">{text}</Text>
        <Button
          label={t('premium.gate.cta')}
          variant={compact ? 'secondary' : 'primary'}
          size="md"
          onPress={() => router.push({ pathname: '/premium', params: { reason } })}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing['3'],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing['2'],
  },
  title: {
    flexShrink: 1,
  },
});
