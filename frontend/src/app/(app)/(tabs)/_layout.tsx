import { Redirect, useRouter } from 'expo-router';
import type { ReactElement } from 'react';
import { Tabs, type BottomTabBarProps } from 'expo-router/js-tabs';

import { Calendar, ChartLine, House, User, type LucideIcon } from '@/components/ui/icons';
import { ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { TabBar, type TabBarAction, type TabBarItem } from '@/components/ui/tab-bar';
import { useOnboardingGate } from '@/features/profile/hooks/use-profile';
import { useWeekOverview } from '@/features/daily-logs/hooks/use-week-overview';
import { useActivePet } from '@/features/pets/active-pet-context';
import type { Pet } from '@/features/pets/types';
import { t, tf, type TranslationKey } from '@/i18n';

/** Destinos de la barra, en orden; «Registrar» (acción) va en medio. */
const TABS: Record<string, { label: TranslationKey; icon: LucideIcon }> = {
  index: { label: 'tabs.today', icon: House },
  history: { label: 'tabs.history', icon: ChartLine },
  agenda: { label: 'tabs.agenda', icon: Calendar },
  profile: { label: 'tabs.profile', icon: User },
};

/**
 * Pestañas principales (PANTALLAS.md §1). Hoy es `/` (la URL de siempre); el resto, `/history`,
 * `/agenda` y `/profile`. Las demás pantallas (`/pets/...`, `/settings`…) se abren encima, en la pila
 * de `(app)`, sin barra.
 */
export default function TabsLayout() {
  // Configuración inicial pendiente (`profiles.onboarding_completed_at`): primero, sus pasos.
  const onboarding = useOnboardingGate();
  if (onboarding.gate === 'pending') return <Redirect href="/setup/profile" />;
  if (onboarding.gate === 'loading') {
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  }
  if (onboarding.gate === 'error') {
    return (
      <Screen>
        <ErrorState message={t('setup.errors.load')} description={t('setup.errors.loadText')} onRetry={onboarding.retry} />
      </Screen>
    );
  }
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <AppTabBar {...props} />}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="history" />
      <Tabs.Screen name="agenda" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}

function AppTabBar({ state, navigation, insets }: BottomTabBarProps) {
  const { activePet } = useActivePet();

  const items: TabBarItem[] = state.routes.flatMap((route, index) => {
    const tab = TABS[route.name];
    if (!tab) return [];
    const selected = state.index === index;
    return [
      {
        key: route.key,
        label: t(tab.label),
        icon: tab.icon,
        selected,
        onPress: () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!selected && !event.defaultPrevented) navigation.navigate(route.name, route.params);
        },
      },
    ];
  });

  const bar = (action: TabBarAction) => (
    <TabBar items={items} action={action} accessibilityLabel={t('tabs.label')} bottomInset={insets.bottom} />
  );

  if (!activePet) {
    return bar({
      state: 'unavailable',
      label: t('tabs.log'),
      accessibilityLabel: t('tabs.logUnavailable'),
      onPress: () => undefined,
    });
  }
  return <PetTabBar key={activePet.id} pet={activePet} render={bar} />;
}

/** «Registrar» con el estado de hoy de la mascota activa (mismo historial combinado que Hoy). */
function PetTabBar({ pet, render }: { pet: Pet; render: (action: TabBarAction) => ReactElement }) {
  const router = useRouter();
  const week = useWeekOverview(pet.id);
  const done = week.state === 'ready' && week.overview.today !== null;

  return render({
    state: done ? 'done' : 'pending',
    label: done ? t('tabs.logDone') : t('tabs.log'),
    accessibilityLabel: tf(done ? 'tabs.logDoneLabel' : 'tabs.logPending', { name: pet.name }),
    onPress: () => router.push({ pathname: '/pets/[id]/daily-log', params: { id: pet.id } }),
  });
}
