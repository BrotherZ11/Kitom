import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Banner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
import { WifiOff } from '@/components/ui/icons';
import { ErrorState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { Skeleton } from '@/components/ui/skeleton';
import { Tag } from '@/components/ui/tag';
import { Text } from '@/components/ui/text';
import { useToast } from '@/components/ui/toast';
import { OfflineSessionNotice } from '@/features/auth/components/offline-session-notice';
import { DayCard } from '@/features/daily-logs/components/day-card';
import { UnsyncedDailyLogsEntry } from '@/features/daily-logs/components/unsynced-entry';
import { EvolutionCard, WeekSummary } from '@/features/daily-logs/components/week-summary';
import { useWeekOverview } from '@/features/daily-logs/hooks/use-week-overview';
import { formatShortDateLabel } from '@/features/daily-logs/log-date';
import type { DisplaySyncStatus } from '@/features/daily-logs/offline/daily-log-view';
import { dayCardMessage, TREND_THRESHOLD } from '@/features/daily-logs/week-overview';
import { ActivePetGate, TAB_SCREEN_EDGES } from '@/features/pets/components/active-pet-gate';
import { PetHeader } from '@/features/pets/components/pet-header';
import { PetSelectorSheet } from '@/features/pets/components/pet-selector-sheet';
import { useCanEditPet } from '@/features/pets/hooks/use-pets';
import type { Pet } from '@/features/pets/types';
import { useProfileName } from '@/features/profile/hooks/use-profile-name';
import { getLocale, t, tf } from '@/i18n';
import { radius, size, spacing } from '@/theme/tokens';

/** Hoy (tableros 4.1–4.6, 5.8, 5.10 y 12.1/12.2): la semana de la mascota activa y el registro del día. */
export default function TodayScreen() {
  return <ActivePetGate>{(pet) => <PetToday key={pet.id} pet={pet} />}</ActivePetGate>;
}

function PetToday({ pet }: { pet: Pet }) {
  const router = useRouter();
  const week = useWeekOverview(pet.id);
  const canEdit = useCanEditPet(pet.id);
  const profileName = useProfileName();
  const [selectorOpen, setSelectorOpen] = useState(false);
  useSyncedToast(week.state === 'ready' ? (week.overview.today?.syncStatus ?? null) : null);

  const openLog = () => router.push({ pathname: '/pets/[id]/daily-log', params: { id: pet.id } });
  const offline = week.state === 'ready' && week.offline;

  const content = () => {
    if (week.state === 'loading') return <TodaySkeleton />;
    if (week.state === 'error') {
      return (
        <ErrorState
          message={tf('home.loadError', { name: pet.name })}
          description={t('dailyLogs.history.errorText')}
          onRetry={week.retry}
        />
      );
    }
    const { overview } = week;
    const isFirst = dayCardMessage(overview).kind === 'first';
    return (
      <>
        {isFirst && profileName.data ? (
          <Text variant="title2" style={styles.greeting}>
            {tf('home.greeting', { name: profileName.data })}
          </Text>
        ) : null}
        <DayCard
          petName={pet.name}
          overview={overview}
          canEdit={canEdit.data ?? null}
          onOpenLog={openLog}
        />
        {overview.loggedCount < TREND_THRESHOLD ? (
          <EvolutionCard petName={pet.name} loggedCount={overview.loggedCount} />
        ) : (
          <WeekSummary overview={overview} onOpenHistory={() => router.navigate('/history')} />
        )}
      </>
    );
  };

  return (
    <Screen align="top" edges={[...TAB_SCREEN_EDGES]}>
      <PetHeader
        pet={pet}
        overline={week.state === 'ready' ? formatShortDateLabel(week.today, getLocale()) : ' '}
        onPress={() => setSelectorOpen(true)}
        right={offline ? <Tag label={t('home.offline')} icon={WifiOff} /> : null}
      />
      {offline ? <Banner icon={WifiOff} message={t('home.offlineBanner')} /> : null}
      {/* Sesión guardada sin comprobar (arranque sin conexión con el token caducado). */}
      <OfflineSessionNotice />
      {/* Registros con cambios solo en el dispositivo, también de mascotas que ya no se ven. */}
      <UnsyncedDailyLogsEntry />
      {content()}
      <PetSelectorSheet visible={selectorOpen} onClose={() => setSelectorOpen(false)} />
    </Screen>
  );
}

/**
 * «El registro de hoy ya está subido» (tablero 5.10): solo cuando, con la pantalla abierta, el de hoy
 * pasa de pendiente a sincronizado; no al abrir la app con todo ya subido.
 */
function useSyncedToast(status: DisplaySyncStatus | null) {
  const toast = useToast();
  const previous = useRef(status);

  useEffect(() => {
    const before = previous.current;
    previous.current = status;
    if (status === 'synced' && (before === 'pending' || before === 'syncing')) {
      toast({ message: t('home.syncedToast') });
    }
  }, [status, toast]);
}

/** Esqueleto de Hoy (tablero 12.1), tras 300 ms como el resto de cargas. */
function TodaySkeleton() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 300);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={t('common.loading')} style={styles.skeleton}>
      {visible ? (
        <>
          <Card style={styles.skeletonCard}>
            <View style={styles.skeletonRow}>
              <Skeleton width={104} height={104} radius={radius.full} />
              <View style={styles.skeletonText}>
                <Skeleton width="80%" height={20} />
                <Skeleton width="95%" height={12} />
                <Skeleton width="60%" height={12} />
              </View>
            </View>
            <Skeleton height={size.buttonLg} radius={radius.md} />
          </Card>
          <Skeleton height={120} radius={radius.lg} />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  greeting: {
    marginTop: -spacing['1'],
  },
  skeleton: {
    gap: spacing['5'],
  },
  skeletonCard: {
    padding: spacing['5'],
    gap: spacing['4'],
  },
  skeletonRow: {
    flexDirection: 'row',
    gap: spacing['4'],
    alignItems: 'center',
  },
  skeletonText: {
    flex: 1,
    gap: spacing['2'],
  },
});
