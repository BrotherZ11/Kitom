import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { lastDays } from '@/components/ui/chart-geometry';
import { Icon } from '@/components/ui/icon';
import { Check } from '@/components/ui/icons';
import { ProgressBar } from '@/components/ui/progress-bar';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { TopBar } from '@/components/ui/top-bar';
import { WeekRing } from '@/components/ui/week-ring';
import { buildBadges, earnedCount, type Badge } from '@/features/achievements/achievements-model';
import { Medal } from '@/features/achievements/components/medal';
import { useAchievementCatalog, usePetAchievements } from '@/features/achievements/hooks/use-achievements';
import { useTodayLogDate } from '@/features/daily-logs/hooks/use-today-log-date';
import { useWeekOverview } from '@/features/daily-logs/hooks/use-week-overview';
import { formatWeekdayInitial } from '@/features/daily-logs/log-date';
import { usePet, usePetStreak } from '@/features/pets/hooks/use-pets';
import { isLocalPetId } from '@/features/pets/offline/pet-operation';
import { currentStreak } from '@/features/pets/pet-profile';
import { formatFullDate } from '@/features/reminders/reminder-format';
import { useTheme } from '@/hooks/use-theme';
import { getLocale, t, tf, type TranslationKey } from '@/i18n';
import { borderWidth, fontFamily, radius, spacing } from '@/theme/tokens';
import { useElevation } from '@/theme/use-elevation';

const KNOWN_CODES = ['first_log', 'streak_7', 'streak_30', 'first_photo_scan'] as const;
type KnownCode = (typeof KNOWN_CODES)[number];
const isKnown = (code: string): code is KnownCode => (KNOWN_CODES as readonly string[]).includes(code);

/** Logros y racha de una mascota (tablero 9.1). Insignias del servidor; retos semanales, «Próximamente». */
export default function AchievementsScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const pet = usePet(id);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/profile'));
  const name = pet.data?.name ?? '';

  return (
    <Screen align="top">
      <TopBar onBack={back} title={name ? tf('achievements.title', { name }) : undefined} />
      {isLocalPetId(id) ? (
        <EmptyState title={t('pets.sync.dailyLogsUnavailable')} description={t('pets.sync.dailyLogsUnavailableText')} />
      ) : (
        <AchievementsContent petId={id} petName={name} />
      )}
    </Screen>
  );
}

function AchievementsContent({ petId, petName }: { petId: string; petName: string }) {
  const locale = getLocale();
  const today = useTodayLogDate();
  const streak = usePetStreak(petId);
  const week = useWeekOverview(petId);
  const catalog = useAchievementCatalog();
  const earned = usePetAchievements(petId);
  const [open, setOpen] = useState<Badge | null>(null);

  if (catalog.isError || earned.isError) {
    return (
      <ErrorState
        offline={false}
        message={tf('achievements.loadError', { name: petName })}
        onRetry={() => {
          void catalog.refetch();
          void earned.refetch();
        }}
      />
    );
  }
  if (!catalog.data || !earned.data || !today) {
    // Sin conexión las consultas no se ejecutan: se dice en lugar de cargar para siempre.
    if (catalog.fetchStatus === 'idle' && !catalog.data) {
      return <ErrorState offline message={t('agenda.errors.offlineTitle')} onRetry={() => void catalog.refetch()} />;
    }
    return <LoadingState />;
  }

  const yesterday = lastDays(today, 2)[0];
  const current = streak.data ? currentStreak(streak.data, yesterday) : 0;
  const best = streak.data?.longest_streak ?? 0;
  const loggedAny = (streak.data?.last_log_date ?? null) !== null;
  const badges = buildBadges(catalog.data, earned.data, { currentStreak: current, loggedAny });
  const ready = week.state === 'ready' ? week.overview : null;

  return (
    <>
      <Card style={styles.streakCard}>
        <WeekRing
          days={ready ? ready.days : ['off', 'off', 'off', 'off', 'off', 'off']}
          today={ready ? (ready.today ? 'done' : 'pending') : 'none'}
          text={String(current)}
          caption={t('achievements.streakCaption')}
          size={132}
          accessibilityLabel={tf('achievements.streakA11y', { count: current })}
        />
        <Text color="inkMuted" style={styles.center}>
          {best === 0
            ? t('achievements.bestNone')
            : best === 1
              ? t('achievements.bestOne')
              : tf('achievements.best', { count: best })}
        </Text>
      </Card>

      {ready ? (
        <View style={styles.block}>
          <View style={styles.between}>
            <Text variant="title3" accessibilityRole="header">
              {t('achievements.week')}
            </Text>
            <Text variant="caption" color="inkMuted">
              {tf('achievements.weekCount', { count: ready.weekCount })}
            </Text>
          </View>
          <WeekDots dates={ready.dates} days={ready.days} todayDone={ready.today !== null} locale={locale} />
        </View>
      ) : null}

      <View style={styles.block}>
        <View style={styles.between}>
          <Text variant="title3" accessibilityRole="header">
            {t('achievements.badges')}
          </Text>
          <Text variant="caption" color="inkMuted">
            {tf('achievements.badgesCount', { count: earnedCount(badges), total: badges.length })}
          </Text>
        </View>
        <View style={styles.grid}>
          {badges.map((badge) => (
            <BadgeCard key={badge.id} badge={badge} locale={locale} onPress={() => setOpen(badge)} />
          ))}
        </View>
      </View>

      <Card variant="flat" style={styles.challenges}>
        <View style={styles.between}>
          <Text variant="bodyStrong">{t('achievements.challenges')}</Text>
          <SoonMark />
        </View>
        <Text variant="caption" color="inkMuted">
          {t('achievements.challengesText')}
        </Text>
      </Card>
      <Text variant="caption" color="inkMuted">
        {t('achievements.footer')}
      </Text>

      <BottomSheet
        visible={open !== null}
        title={open ? badgeTitle(open) : ''}
        onClose={() => setOpen(null)}
        footer={<Button label={t('achievements.detail.ok')} variant="secondary" onPress={() => setOpen(null)} />}>
        {open ? <BadgeDetail badge={open} petName={petName} locale={locale} /> : null}
      </BottomSheet>
    </>
  );
}

function badgeTitle(badge: Badge): string {
  return badge.title ?? (isKnown(badge.code) ? t(`achievements.fallbackTitles.${badge.code}`) : badge.code);
}

function badgeStatus(badge: Badge, locale: string): string {
  if (badge.state === 'earned' && badge.earnedAt) {
    return tf('achievements.earned', { date: formatFullDate(new Date(badge.earnedAt), locale) });
  }
  if (badge.state === 'soon') return t('achievements.soon');
  if (badge.progress && badge.progress.count > 0) {
    return tf('achievements.progress', { count: badge.progress.count, total: badge.progress.total });
  }
  return t('achievements.locked');
}

function BadgeCard({ badge, locale, onPress }: { badge: Badge; locale: string; onPress: () => void }) {
  const theme = useTheme();
  const raised = useElevation('1');
  const title = badgeTitle(badge);
  const status = badgeStatus(badge, locale);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}: ${status}`}
      onPress={onPress}
      style={({ pressed }) => [styles.badge, { backgroundColor: theme.surface }, raised, pressed && styles.pressed]}>
      <Medal badge={badge} />
      <Text variant="label" style={styles.center}>
        {title}
      </Text>
      <Text variant="caption" color="inkMuted" style={styles.center}>
        {status}
      </Text>
    </Pressable>
  );
}

function BadgeDetail({ badge, petName, locale }: { badge: Badge; petName: string; locale: string }) {
  const hintKey: TranslationKey = isKnown(badge.code) ? `achievements.hints.${badge.code}` : 'achievements.hints.unknown';
  return (
    <View style={styles.detail}>
      <Medal badge={badge} big />
      <Text color="inkMuted" style={styles.center}>
        {badge.description && badge.state === 'earned' ? badge.description : tf(hintKey, { name: petName })}
      </Text>
      {badge.progress && badge.state !== 'earned' ? (
        <>
          <ProgressBar value={badge.progress.count / badge.progress.total} />
          <Text variant="caption" color="inkMuted">
            {tf('achievements.detail.progressText', {
              count: badge.progress.count,
              left: badge.progress.total - badge.progress.count,
            })}
          </Text>
        </>
      ) : null}
      {badge.state === 'earned' && badge.earnedAt ? (
        <Text variant="caption" color="inkMuted">
          {tf('achievements.detail.gotText', { date: formatFullDate(new Date(badge.earnedAt), locale) })}
        </Text>
      ) : null}
    </View>
  );
}

/** Los 7 días que terminan hoy (`.week` del prototipo). Registrado: relleno con check; hoy: contorno sol. */
function WeekDots({
  dates,
  days,
  todayDone,
  locale,
}: {
  dates: string[];
  days: readonly string[];
  todayDone: boolean;
  locale: string;
}) {
  const theme = useTheme();
  return (
    <View style={styles.week} accessibilityRole="list">
      {dates.map((date, index) => {
        const isToday = index === dates.length - 1;
        const on = isToday ? todayDone : days[index] === 'on';
        const day = formatWeekdayInitial(date, locale);
        const label = isToday
          ? tf(todayDone ? 'achievements.weekDayTodayDone' : 'achievements.weekDayToday', { day: dateDay(date, locale) })
          : tf(on ? 'achievements.weekDayDone' : 'achievements.weekDayEmpty', { day: dateDay(date, locale) });
        return (
          <View key={date} style={styles.weekDay} accessible accessibilityLabel={label}>
            <View
              style={[
                styles.weekDot,
                on
                  ? { backgroundColor: isToday ? theme.accent : theme.primary }
                  : { borderWidth: borderWidth.focus, borderColor: isToday ? theme.accent : theme.line },
              ]}>
              {on ? <Icon icon={Check} size={14} color={isToday ? 'onAccent' : 'onPrimary'} /> : null}
            </View>
            <Text variant="caption" color="inkMuted" style={styles.weekLabel}>
              {day}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function dateDay(date: string, locale: string): string {
  try {
    const [year, month, day] = date.split('-').map(Number);
    return new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric' }).format(new Date(year, month - 1, day));
  } catch {
    return date;
  }
}

function SoonMark() {
  const theme = useTheme();
  return (
    <View style={[styles.soon, { backgroundColor: theme.surfaceSunken }]}>
      <Text color="inkMuted" style={styles.soonText}>
        {t('common.soon')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  streakCard: {
    alignItems: 'center',
    gap: 10,
    padding: spacing['5'],
  },
  center: {
    textAlign: 'center',
  },
  block: {
    gap: 10,
  },
  between: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing['3'],
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  badge: {
    flexBasis: '47%',
    flexGrow: 1,
    borderRadius: radius.lg,
    paddingVertical: spacing['4'],
    paddingHorizontal: spacing['3'],
    alignItems: 'center',
    gap: 6,
  },
  pressed: {
    opacity: 0.85,
  },
  challenges: {
    gap: 6,
  },
  detail: {
    alignItems: 'center',
    gap: spacing['3'],
  },
  week: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  weekDay: {
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  weekDot: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekLabel: {
    fontSize: 11,
    lineHeight: 14,
  },
  soon: {
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
  },
  soonText: {
    fontFamily: fontFamily.sans600,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.3,
  },
});
