import Constants from 'expo-constants';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Check, Crown, InfinityIcon, PawPrint, ChartLine, Users } from '@/components/ui/icons';
import { ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { Tag } from '@/components/ui/tag';
import { Text } from '@/components/ui/text';
import { TextLink } from '@/components/ui/text-link';
import { useToast } from '@/components/ui/toast';
import { TopBar } from '@/components/ui/top-bar';
import { useAuth } from '@/features/auth/auth-context';
import { formatFullDate } from '@/features/reminders/reminder-format';
import { usePlan, usePlanOptions, usePurchasePremium, useRestorePurchases } from '@/features/subscription/hooks/use-plan';
import {
  parsePaywallReason,
  purchaseErrorCode,
  summarizePlan,
  type Plan,
  type PlanOption,
  type PurchaseErrorCode,
} from '@/features/subscription/plan-model';
import { managementUrl, purchasesUnavailableReason } from '@/features/subscription/purchases';
import { useTheme } from '@/hooks/use-theme';
import { getLocale, t, tf } from '@/i18n';
import { radius, spacing } from '@/theme/tokens';
import type { LucideIcon } from '@/components/ui/icons';

/**
 * Kitom Premium (PaywallScreen): ventajas, precios de la tienda, comprar, restaurar y, si ya lo
 * tiene, el estado y «Gestionar la suscripción». El plan lo dice siempre el servidor (`get_my_plan`);
 * tras comprar se pide `subscription-sync` y se vuelve a leer. Contrato:
 * `docs/FRONTEND_ARCHITECTURE.md` «PaywallScreen».
 */
export default function PremiumScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ reason?: string }>();
  const reason = parsePaywallReason(params.reason);
  const { canUseServer } = useAuth();
  const plan = usePlan();
  const close = () => (router.canGoBack() ? router.back() : router.replace('/settings'));

  if (plan.isPending && canUseServer) {
    return (
      <Screen>
        <TopBar onBack={close} />
        <LoadingState />
      </Screen>
    );
  }
  if (plan.isError) {
    return (
      <Screen>
        <TopBar onBack={close} />
        <ErrorState message={t('premium.optionsError')} onRetry={() => void plan.refetch()} />
      </Screen>
    );
  }
  if (plan.data?.isPremium) return <PremiumActive plan={plan.data} onClose={close} />;
  return <Paywall reasonText={t(`premium.reasons.${reason}`)} offline={!canUseServer} onClose={close} />;
}

/** Ventajas. Con Premium activo, sin la comparación con el plan gratuito (QA-12). */
function Benefits({ compare = true }: { compare?: boolean }) {
  const items: { icon: LucideIcon; title: string; text: string | null }[] = [
    { icon: InfinityIcon, title: t('premium.benefits.ai'), text: compare ? t('premium.benefits.aiText') : null },
    { icon: PawPrint, title: t('premium.benefits.pets'), text: compare ? t('premium.benefits.petsText') : null },
    { icon: ChartLine, title: t('premium.benefits.history'), text: compare ? t('premium.benefits.historyText') : null },
    { icon: Users, title: t('premium.benefits.coOwners'), text: t('premium.benefits.coOwnersText') },
  ];
  return (
    <View style={styles.benefits} accessibilityLabel={t('premium.benefits.title')}>
      {items.map((item) => (
        <View key={item.title} style={styles.benefit}>
          <Icon icon={item.icon} color="primary" />
          <View style={styles.benefitText}>
            <Text variant="bodyStrong">{item.title}</Text>
            {item.text ? (
              <Text variant="label" color="inkMuted">
                {item.text}
              </Text>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

function Heading({ text }: { text?: string }) {
  return (
    <View style={styles.heading}>
      <View style={styles.headingRow}>
        <Icon icon={Crown} color="primary" />
        <Text variant="overline" color="primary">
          {t('premium.overline')}
        </Text>
      </View>
      <Text variant="title1" accessibilityRole="header">
        {t('premium.headline')}
      </Text>
      <Text color="inkMuted">{text ? text : t('premium.text')}</Text>
    </View>
  );
}

function LegalLinks() {
  const router = useRouter();
  return (
    <View style={styles.legal}>
      <Text variant="caption" color="inkMuted">
        {t('premium.legal')}
      </Text>
      <View style={styles.legalLinks}>
        <TextLink label={t('premium.terms')} onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'terms' } })} />
        <TextLink
          label={t('premium.privacy')}
          onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'privacy' } })}
        />
      </View>
    </View>
  );
}

function OptionCard({ option, selected, onPress }: { option: PlanOption; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  const title = option.period === 'year' ? t('premium.options.year') : t('premium.options.month');
  const price =
    option.period === 'year'
      ? tf('premium.options.perYear', { price: option.priceString })
      : tf('premium.options.perMonth', { price: option.priceString });
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={[title, price, option.trialDays ? tf('premium.options.trial', { days: option.trialDays }) : '']
        .filter(Boolean)
        .join('. ')}
      onPress={onPress}
      style={[
        styles.option,
        { borderColor: selected ? theme.primary : theme.lineControl, backgroundColor: selected ? theme.surfaceBrand : theme.surface },
      ]}>
      <View style={styles.optionHeader}>
        <Text variant="bodyStrong">{title}</Text>
        {option.period === 'year' ? <Tag label={t('premium.options.recommended')} tone="brand" /> : null}
        {selected ? (
          <View style={styles.optionCheck}>
            <Icon icon={Check} color="primary" />
          </View>
        ) : null}
      </View>
      <Text variant="title3">{price}</Text>
      {option.pricePerMonthString ? (
        <Text variant="label" color="inkMuted">
          {tf('premium.options.yearPerMonth', { price: option.pricePerMonthString })}
        </Text>
      ) : null}
      {option.trialDays ? <Tag label={tf('premium.options.trial', { days: option.trialDays })} tone="success" /> : null}
    </Pressable>
  );
}

function purchaseMessage(code: PurchaseErrorCode): string | null {
  if (code === 'cancelled') return null;
  return t(`premium.errors.${code}`);
}

function Paywall({ reasonText, offline, onClose }: { reasonText: string; offline: boolean; onClose: () => void }) {
  const toast = useToast();
  const options = usePlanOptions();
  const purchase = usePurchasePremium();
  const restore = useRestorePurchases();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'error' | 'warning' | 'info'; text: string } | null>(null);

  const available = options.data?.options ?? [];
  const selected = available.find((o) => o.id === selectedId) ?? available.find((o) => o.period === 'year') ?? available[0] ?? null;
  const busy = purchase.isPending || restore.isPending;

  const afterRefresh = (plan: Plan | null, successText: string, noneText: string | null) => {
    if (plan?.isPremium) {
      toast({ message: successText });
      onClose();
    } else if (noneText) {
      setMessage({ tone: 'info', text: noneText });
    } else {
      setMessage({ tone: 'warning', text: t('premium.notYetActive') });
    }
  };

  const buy = () => {
    if (!selected || !options.data || busy) return;
    setMessage(null);
    purchase.mutate(
      { packages: options.data.packages, optionId: selected.id },
      {
        onSuccess: (plan) => afterRefresh(plan, t('premium.activated'), null),
        onError: (error) => {
          const text = purchaseMessage(purchaseErrorCode(error));
          if (text) setMessage({ tone: purchaseErrorCode(error) === 'pending' ? 'info' : 'error', text });
        },
      },
    );
  };

  const restoreAll = () => {
    if (busy) return;
    setMessage(null);
    restore.mutate(undefined, {
      onSuccess: (plan) => afterRefresh(plan, t('premium.restored'), t('premium.restoredNone')),
      onError: (error) => {
        const text = purchaseMessage(purchaseErrorCode(error));
        if (text) setMessage({ tone: 'error', text });
      },
    });
  };

  const canBuy = purchasesUnavailableReason === null && !offline;
  const footer = canBuy ? (
    <View style={styles.footer}>
      {message ? <Alert tone={message.tone} message={message.text} /> : null}
      <Button
        label={selected?.trialDays ? tf('premium.subscribeTrial', { days: selected.trialDays }) : t('premium.subscribe')}
        loading={purchase.isPending}
        loadingLabel={t('premium.subscribing')}
        disabled={!selected || restore.isPending}
        onPress={buy}
      />
      <Button
        label={t('premium.restore')}
        variant="ghost"
        size="md"
        loading={restore.isPending}
        loadingLabel={t('premium.restoring')}
        disabled={purchase.isPending}
        onPress={restoreAll}
      />
    </View>
  ) : undefined;

  return (
    <Screen align="top" footer={footer}>
      <TopBar onBack={onClose} />
      <Heading text={reasonText} />
      <Card>
        <Benefits />
      </Card>
      {purchasesUnavailableReason !== null ? (
        <Alert tone="info" message={t(`premium.unavailable.${purchasesUnavailableReason}`)} />
      ) : offline ? (
        <Alert tone="warning" message={t('premium.offline')} />
      ) : options.isPending ? (
        <Text color="inkMuted">{t('premium.loadingOptions')}</Text>
      ) : options.isError ? (
        <Alert
          tone="error"
          message={t('premium.optionsError')}
          action={{ label: t('common.retry'), onPress: () => void options.refetch() }}
        />
      ) : available.length === 0 ? (
        <Alert tone="info" message={t('premium.noOptions')} />
      ) : (
        <View style={styles.options} accessibilityRole="radiogroup" accessibilityLabel={t('premium.options.title')}>
          <Text variant="title3">{t('premium.options.title')}</Text>
          {available.map((option) => (
            <OptionCard key={option.id} option={option} selected={option.id === selected?.id} onPress={() => setSelectedId(option.id)} />
          ))}
        </View>
      )}
      <LegalLinks />
    </Screen>
  );
}

const PLAY_SUBSCRIPTIONS = 'https://play.google.com/store/account/subscriptions';

async function openManagement() {
  const url = await managementUrl();
  if (url) {
    await Linking.openURL(url).catch(() => undefined);
    return;
  }
  const pkg = Constants.expoConfig?.android?.package;
  const fallback = Platform.OS === 'ios' ? 'https://apps.apple.com/account/subscriptions' : pkg ? `${PLAY_SUBSCRIPTIONS}?package=${pkg}` : PLAY_SUBSCRIPTIONS;
  await Linking.openURL(fallback).catch(() => undefined);
}

function PremiumActive({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  const summary = summarizePlan(plan);
  const date = (iso: string | null) => (iso ? formatFullDate(new Date(iso), getLocale()) : null);
  let status: string;
  switch (summary.kind) {
    case 'renews':
      status = summary.on ? tf('premium.current.renews', { date: date(summary.on)! }) : t('premium.current.noDate');
      break;
    case 'ends':
      status = summary.on ? tf('premium.current.ends', { date: date(summary.on)! }) : t('premium.current.noDate');
      break;
    case 'trial':
      status = summary.until
        ? tf(summary.renews ? 'premium.current.trial' : 'premium.current.trialEnds', { date: date(summary.until)! })
        : t('premium.current.noDate');
      break;
    case 'billing_issue':
      status = tf('premium.current.billingIssue', { date: date(summary.until) ?? '—' });
      break;
    default:
      status = t('premium.current.noDate');
  }

  return (
    <Screen
      align="top"
      footer={<Button label={t('premium.current.manage')} variant="secondary" onPress={() => void openManagement()} />}>
      <TopBar onBack={onClose} />
      <View style={styles.heading}>
        <View style={styles.headingRow}>
          <Icon icon={Crown} color="primary" />
          <Text variant="overline" color="primary">
            {t('premium.overline')}
          </Text>
        </View>
        <Text variant="title1" accessibilityRole="header">
          {t('premium.current.title')}
        </Text>
      </View>
      {summary.kind === 'billing_issue' ? <Alert tone="warning" message={status} /> : <Text color="inkMuted">{status}</Text>}
      <Card>
        <Benefits compare={false} />
      </Card>
      <Text variant="caption" color="inkMuted">
        {t('premium.current.manageText')}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: {
    gap: spacing['2'],
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing['2'],
  },
  benefits: {
    gap: spacing['4'],
  },
  benefit: {
    flexDirection: 'row',
    gap: spacing['3'],
    alignItems: 'flex-start',
  },
  benefitText: {
    flex: 1,
    gap: spacing['1'],
  },
  options: {
    gap: spacing['3'],
  },
  option: {
    borderWidth: 2,
    borderRadius: radius.lg,
    padding: spacing['4'],
    gap: spacing['2'],
  },
  optionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing['2'],
    flexWrap: 'wrap',
  },
  optionCheck: {
    marginLeft: 'auto',
  },
  footer: {
    gap: spacing['2'],
  },
  legal: {
    gap: spacing['2'],
  },
  legalLinks: {
    flexDirection: 'row',
    gap: spacing['4'],
    flexWrap: 'wrap',
  },
});
