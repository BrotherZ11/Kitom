import { useLocalSearchParams, useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Banner } from '@/components/ui/banner';
import { WifiOff } from '@/components/ui/icons';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Text } from '@/components/ui/text';
import { TextLink } from '@/components/ui/text-link';
import { TopBar } from '@/components/ui/top-bar';
import { WeekRing } from '@/components/ui/week-ring';
import { toDailyLogError } from '@/features/daily-logs/daily-log-errors';
import { usePet } from '@/features/pets/hooks/use-pets';
import { usePetSpecies } from '@/features/species/hooks/use-pet-species';
import { usePlan } from '@/features/subscription/hooks/use-plan';
import { allowedRangeDays } from '@/features/subscription/plan-model';
import { WellnessEvolution } from '@/features/wellness/components/wellness-evolution';
import { WellnessPatterns } from '@/features/wellness/components/wellness-patterns';
import { WellnessSummaryView } from '@/features/wellness/components/wellness-summary';
import { useWellnessData } from '@/features/wellness/hooks/use-wellness';
import { SUMMARY_MIN_LOGGED, WELLNESS_PERIODS, summarizeWellness, type WellnessPeriod } from '@/features/wellness/wellness-stats';
import { getLocale, t, tf } from '@/i18n';
import { spacing } from '@/theme/tokens';

export type WellnessVariant = 'summary' | 'evolution' | 'patterns';

const TITLES = {
  summary: 'wellness.title',
  evolution: 'wellness.evolutionTitle',
  patterns: 'wellness.patternsTitle',
} as const;

/** Periodo de la ruta (`?period=7|30|90`); por defecto, 30 días. */
export function parsePeriod(value: unknown): WellnessPeriod {
  const number = Number(value);
  return (WELLNESS_PERIODS as readonly number[]).includes(number) ? (number as WellnessPeriod) : 30;
}

/**
 * Pantallas del resumen de bienestar de una mascota (`(app)/pets/[id]/wellness/*`): cabecera, periodo
 * (7 · 30 · 90, en la ruta), avisos (sin conexión, datos parciales, cambios sin sincronizar) y los
 * estados comunes. Una mascota sin acceso se dice («no disponible»), nunca «0 registros».
 * Kitom Premium: con el plan gratuito solo los periodos dentro de `history_days` (7 y 30); 90 lleva a
 * la pantalla de Premium.
 * Diseño: `docs/proposals/2026-11-10-wellness-reports.md` §3.
 */
export function WellnessScreen({ petId, variant }: { petId: string; variant: WellnessVariant }) {
  const router = useRouter();
  const params = useLocalSearchParams<{ period?: string }>();
  const plan = usePlan();
  const allowedPeriods = allowedRangeDays(plan.data, WELLNESS_PERIODS);
  const requested = parsePeriod(params.period);
  const period = allowedPeriods.includes(requested) ? requested : allowedPeriods[allowedPeriods.length - 1];
  const lockedPeriods = WELLNESS_PERIODS.filter((value) => !allowedPeriods.includes(value));
  const pet = usePet(petId);
  const { code: speciesCode } = usePetSpecies(petId);
  const data = useWellnessData(petId);
  const name = pet.view.state === 'ready' ? pet.view.pet.name : null;

  const back = () => (router.canGoBack() ? router.back() : router.replace({ pathname: '/pets/[id]', params: { id: petId } }));
  const header = <TopBar onBack={back} title={t(TITLES[variant])} subtitle={name ?? undefined} />;
  const frame = (content: ReactNode) => (
    <Screen align="top">
      {header}
      {content}
    </Screen>
  );

  if (pet.view.state === 'not_found') {
    return frame(<EmptyState title={t('pets.detail.notFound')} actionLabel={t('common.back')} onAction={back} />);
  }
  if (data.state === 'loading') return frame(<LoadingState />);
  if (data.state === 'error') {
    return frame(
      <ErrorState
        message={t('wellness.loadError')}
        offline={toDailyLogError(data.error).code === 'network'}
        onRetry={data.retry}
      />
    );
  }

  const summary = summarizeWellness({ items: data.items, today: data.today, period, speciesCode });
  const coverage = data.coverageFor(period);
  const partial = data.offline && coverage === null;
  const setPeriod = (value: WellnessPeriod) => router.setParams({ period: String(value) });

  const notices = (
    <>
      {data.offline ? (
        <Banner
          tone="warning"
          icon={WifiOff}
          message={
            coverage
              ? tf('wellness.offlineUpdated', {
                  date: new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(
                    new Date(coverage.fetchedAt)
                  ),
                })
              : t('wellness.offlinePartial')
          }
        />
      ) : null}
      {summary.unsyncedDays > 0 ? (
        <Text variant="caption" color="inkMuted">
          {tf('wellness.unsynced', { count: summary.unsyncedDays })}
        </Text>
      ) : null}
    </>
  );

  // Menos de 3 registros en todo lo leído: todavía no hay resumen (como el historial, tablero 6.5).
  if (summary.totalLogged < SUMMARY_MIN_LOGGED) {
    return frame(
      <>
        {notices}
        <View style={styles.empty}>
          <WeekRing
            days={summary.window.dates.slice(-7, -1).map((date) => (data.items.some((item) => item.log.log_date === date) ? 'on' : 'off'))}
            today={summary.todayLogged ? 'done' : 'pending'}
            text={`${summary.totalLogged}/${SUMMARY_MIN_LOGGED}`}
            size={140}
            accessibilityLabel={tf('wellness.emptyCount', { count: summary.totalLogged })}
          />
          <Text variant="title2" accessibilityRole="header" style={styles.center}>
            {t('wellness.emptyTitle')}
          </Text>
          <Text color="inkMuted" style={styles.center}>
            {summary.totalLogged === 0 ? t('wellness.emptyText') : tf('wellness.emptyCount', { count: summary.totalLogged })}
          </Text>
        </View>
      </>
    );
  }

  const openRoute = (route: 'evolution' | 'patterns') =>
    router.push({ pathname: `/pets/[id]/wellness/${route}`, params: { id: petId, period: String(period) } });

  return (
    <Screen align="top">
      {header}
      <SegmentedControl
        accessibilityLabel={t('wellness.period')}
        options={allowedPeriods.map((value) => ({ value: String(value) as `${WellnessPeriod}`, label: t(`wellness.periods.p${value}`) }))}
        value={String(period) as `${WellnessPeriod}`}
        onChange={(value) => setPeriod(Number(value) as WellnessPeriod)}
      />
      {lockedPeriods.map((days) => (
        <TextLink
          key={days}
          label={tf('premium.gate.rangeLocked', { days })}
          onPress={() => router.push({ pathname: '/premium', params: { reason: 'history' } })}
        />
      ))}
      {notices}
      {variant === 'summary' ? (
        <WellnessSummaryView
          summary={summary}
          partial={partial}
          onPeriod={setPeriod}
          onEvolution={() => openRoute('evolution')}
          onPatterns={() => openRoute('patterns')}
        />
      ) : variant === 'evolution' ? (
        <WellnessEvolution items={data.items} summary={summary} petName={name} speciesCode={speciesCode} />
      ) : (
        <WellnessPatterns items={data.items} today={data.today} period={period} speciesCode={speciesCode} />
      )}
      <Text variant="caption" color="inkMuted" style={styles.disclaimer}>
        {t('wellness.disclaimer')}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  empty: {
    alignItems: 'center',
    gap: spacing['3'],
    paddingTop: spacing['10'],
  },
  center: {
    textAlign: 'center',
    maxWidth: 300,
  },
  disclaimer: {
    marginTop: spacing['2'],
  },
});
