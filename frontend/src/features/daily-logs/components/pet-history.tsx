import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { FormMessage } from '@/components/ui/form-message';
import { IconButton } from '@/components/ui/icon-button';
import { ChevronLeft, ChevronRight, WifiOff } from '@/components/ui/icons';
import { MonthCalendar } from '@/components/ui/month-calendar';
import { ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Sparkline } from '@/components/ui/sparkline';
import { Text } from '@/components/ui/text';
import { TextLink } from '@/components/ui/text-link';
import { TopBar } from '@/components/ui/top-bar';
import { TrendChart } from '@/components/ui/trend-chart';
import { WeekRing } from '@/components/ui/week-ring';
import { HistoryListItem } from '@/features/daily-logs/components/history-list-item';
import { toDailyLogError } from '@/features/daily-logs/daily-log-errors';
import {
  DEFAULT_SERIES,
  HISTORY_SERIES,
  MAX_VISIBLE_SERIES,
  dayRows,
  monthDates,
  needsOlderPages,
  seriesValues,
  toggleSeries,
  type HistorySeriesId,
} from '@/features/daily-logs/history-view';
import { useDailyLogHistory } from '@/features/daily-logs/hooks/use-daily-log';
import { useWeekOverview } from '@/features/daily-logs/hooks/use-week-overview';
import { capitalizeFirst, formatLogDateLabel, formatWeekdayInitial } from '@/features/daily-logs/log-date';
import type { HistoryItemView } from '@/features/daily-logs/offline/daily-log-view';
import { scaleValueLabel } from '@/features/daily-logs/scale-labels';
import { TREND_THRESHOLD } from '@/features/daily-logs/week-overview';
import { PetPhoto } from '@/features/pets/components/pet-photo';
import type { Pet } from '@/features/pets/types';
import { useTheme } from '@/hooks/use-theme';
import { getLocale, t, tf } from '@/i18n';
import { size, spacing } from '@/theme/tokens';

/** Lo que el historial necesita de la mascota (sin conexión puede no haber más que el id). */
export type HistoryPet = Pick<Pet, 'id' | 'name' | 'photo_path'>;

type PetHistoryProps = {
  pet: HistoryPet;
  /** `tab`: pestaña Historial (la mascota se cambia tocando su avatar). `stack`: con «Volver». */
  mode: 'tab' | 'stack';
  /** UX (`can_edit_pet`); sin comprobar (`null`), se ofrece registrar y decide el servidor. */
  canEdit: boolean | null;
  onPressAvatar?: () => void;
};

const WEEKDAY_DATES = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'];

/**
 * Historial de una mascota (tableros 6.1, 6.2, 6.5 y 12.3): semana con hasta 3 series a la vez, mes
 * con calendario y una línea por categoría, y «Día a día» con los registros cargados por páginas y
 * los cambios pendientes del dispositivo encima. Sin conexión muestra lo guardado en el dispositivo.
 * No hay interpretaciones: se muestra lo registrado, con los huecos en blanco.
 */
export function PetHistory({ pet, mode, canEdit, onPressAvatar }: PetHistoryProps) {
  const router = useRouter();
  const history = useDailyLogHistory(pet.id);
  const week = useWeekOverview(pet.id);
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const locale = getLocale();

  const header =
    mode === 'tab' ? (
      <View style={styles.top}>
        <Text variant="title1" accessibilityRole="header">
          {t('dailyLogs.history.title')}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tf('home.changePet', { name: pet.name })}
          onPress={onPressAvatar}
          hitSlop={2}>
          <PetPhoto name={pet.name} photoPath={pet.photo_path} size="md" />
        </Pressable>
      </View>
    ) : (
      <TopBar
        onBack={() => (router.canGoBack() ? router.back() : router.replace({ pathname: '/pets/[id]', params: { id: pet.id } }))}
        title={t('dailyLogs.history.title')}
        subtitle={pet.name}
      />
    );

  const openDay = (date: string) =>
    router.push({ pathname: '/pets/[id]/daily-logs/[date]', params: { id: pet.id, date } });
  const logToday = () => router.push({ pathname: '/pets/[id]/daily-log', params: { id: pet.id } });

  const { view } = history;
  if (view.state === 'loading' || week.state === 'loading') {
    return (
      <Screen align="top" edges={mode === 'tab' ? ['top', 'left', 'right'] : undefined}>
        {header}
        <LoadingState />
      </Screen>
    );
  }
  // Sin datos del servidor ni del dispositivo: error (nunca una lista vacía engañosa). Con datos, el
  // error es de «cargar más» (abajo).
  if (view.state === 'error' || week.state === 'error') {
    const error = view.state === 'error' ? view.error : week.state === 'error' ? week.error : null;
    return (
      <Screen align="top" edges={mode === 'tab' ? ['top', 'left', 'right'] : undefined}>
        {header}
        <ErrorState
          message={t('dailyLogs.history.errorTitle')}
          description={t('dailyLogs.history.errorText')}
          offline={toDailyLogError(error).code === 'network'}
          onRetry={history.refetch}
        />
      </Screen>
    );
  }

  const { overview, today } = week;
  const items = view.items;
  const todayLogged = overview.today !== null;
  const offlineBanner = view.offline ? <Banner icon={WifiOff} message={t('dailyLogs.sync.offline')} /> : null;

  // Menos de 3 registros: todavía no hay evolución que mostrar (tablero 6.5).
  if (overview.loggedCount < TREND_THRESHOLD && !history.hasNextPage) {
    return (
      <Screen
        align="top"
        edges={mode === 'tab' ? ['top', 'left', 'right'] : undefined}
        footer={!todayLogged && canEdit !== false ? <Button label={t('dailyLogs.history.logToday')} onPress={logToday} /> : undefined}>
        {header}
        {offlineBanner}
        <View style={styles.empty}>
          <WeekRing
            days={overview.days}
            today={todayLogged ? 'done' : 'pending'}
            text={`${overview.loggedCount}/${TREND_THRESHOLD}`}
            size={140}
            accessibilityLabel={tf('home.evolution.progress', { count: overview.loggedCount })}
          />
          <Text variant="title2" accessibilityRole="header" style={styles.center}>
            {t('dailyLogs.history.emptyTitle')}
          </Text>
          <Text color="inkMuted" style={[styles.center, styles.emptyText]}>
            {overview.loggedCount === 0
              ? t('dailyLogs.history.emptyDescription')
              : tf('dailyLogs.history.emptyCount', { name: pet.name, count: overview.loggedCount })}
          </Text>
        </View>
        {items.length > 0 ? (
          <Card flush>
            {items.map((item, index) => (
              <HistoryListItem
                key={item.log.log_date}
                log={item.log}
                syncStatus={item.syncStatus}
                isToday={item.log.log_date === today}
                withYear={!item.log.log_date.startsWith(today.slice(0, 4))}
                subtitle={index === items.length - 1 ? tf('dailyLogs.history.firstLog', { name: pet.name }) : undefined}
                divider={index < items.length - 1}
                onPress={() => openDay(item.log.log_date)}
              />
            ))}
          </Card>
        ) : null}
      </Screen>
    );
  }

  return (
    <Screen align="top" edges={mode === 'tab' ? ['top', 'left', 'right'] : undefined}>
      {header}
      {offlineBanner}
      <SegmentedControl
        accessibilityLabel={t('dailyLogs.history.period')}
        options={[
          { value: 'week', label: t('dailyLogs.history.week') },
          { value: 'month', label: t('dailyLogs.history.month') },
        ]}
        value={period}
        onChange={setPeriod}
      />

      {period === 'week' ? (
        <WeekPanel pet={pet} items={items} dates={overview.dates} weekCount={overview.weekCount} locale={locale} />
      ) : (
        <MonthPanel history={history} items={items} today={today} locale={locale} onOpenDay={openDay} />
      )}

      <View style={styles.section}>
        <Text variant="title3" accessibilityRole="header">
          {t('dailyLogs.history.dayByDay')}
        </Text>
        <Card flush>
          {dayRows(items, today).map((row, index, rows) =>
            row.item ? (
              <HistoryListItem
                key={row.date}
                log={row.item.log}
                syncStatus={row.item.syncStatus}
                isToday={row.date === today}
                withYear={!row.date.startsWith(today.slice(0, 4))}
                divider={index < rows.length - 1}
                onPress={() => openDay(row.date)}
              />
            ) : (
              <MissingDayRow
                key={row.date}
                date={row.date}
                today={today}
                divider={index < rows.length - 1}
                onLogToday={row.date === today && canEdit !== false ? logToday : undefined}
              />
            )
          )}
        </Card>
        <FormMessage
          message={history.isFetchNextPageError ? t(`dailyLogs.errors.${toDailyLogError(history.error).code}`) : null}
        />
        {view.offline ? null : history.hasNextPage ? (
          <Button
            variant="secondary"
            size="md"
            label={t('dailyLogs.history.loadMore')}
            loading={history.isFetchingNextPage}
            onPress={() => {
              if (!history.isFetchingNextPage) void history.fetchNextPage();
            }}
          />
        ) : (
          <Text variant="caption" color="inkMuted" style={styles.center}>
            {t('dailyLogs.history.end')}
          </Text>
        )}
      </View>
    </Screen>
  );
}

/** Semana (tablero 6.1): series activables (máx. 3) y gráfico de los 7 últimos días. */
function WeekPanel({
  pet,
  items,
  dates,
  weekCount,
  locale,
}: {
  pet: HistoryPet;
  items: readonly HistoryItemView[];
  dates: readonly string[];
  weekCount: number;
  locale: string;
}) {
  const [selected, setSelected] = useState<HistorySeriesId[]>([...DEFAULT_SERIES]);
  const logs = items.map((item) => item.log);
  const visible = HISTORY_SERIES.filter((series) => selected.includes(series.id));
  const full = selected.length >= MAX_VISIBLE_SERIES;

  const description = visible
    .map((series) => {
      const values = seriesValues(logs, dates, series.column);
      const parts = dates.flatMap((date, index) => {
        const value = values[index];
        if (value === null) return [];
        return [`${formatLogDateLabel(date, locale)} ${scaleValueLabel(series.id, value as 1 | 2 | 3 | 4 | 5)}`];
      });
      return `${t(`dailyLogs.fields.${series.id}`)}: ${parts.length ? parts.join(', ') : t('dailyLogs.history.noLog')}`;
    })
    .join('. ');

  return (
    <Card style={styles.weekCard}>
      <View style={styles.chips} accessibilityLabel={t('dailyLogs.history.categories')}>
        {HISTORY_SERIES.map((series) => {
          const on = selected.includes(series.id);
          return (
            <SeriesChip
              key={series.id}
              label={t(`dailyLogs.fields.${series.id}`)}
              color={series.color}
              selected={on}
              disabled={!on && full}
              onPress={() => setSelected((current) => toggleSeries(current, series.id))}
            />
          );
        })}
      </View>
      <TrendChart
        series={visible.map((series) => ({
          id: series.id,
          color: series.color,
          dash: series.dash,
          values: seriesValues(logs, dates, series.column),
        }))}
        xLabels={dates.map((date) => formatWeekdayInitial(date, locale))}
        yLabels={[t('dailyLogs.history.high'), t('dailyLogs.history.mid'), t('dailyLogs.history.low')]}
        accessibilityLabel={tf('dailyLogs.history.chartLabel', { name: pet.name, series: description })}
      />
      {full ? (
        <Text variant="caption" color="inkMuted">
          {t('dailyLogs.history.seriesLimit')}
        </Text>
      ) : null}
      <Text variant="caption" color="inkMuted">
        {tf('dailyLogs.history.weekCount', { count: weekCount })}
      </Text>
    </Card>
  );
}

function SeriesChip({
  label,
  color,
  selected,
  disabled,
  onPress,
}: {
  label: string;
  color: (typeof HISTORY_SERIES)[number]['color'];
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Chip
      label={label}
      selected={selected}
      disabled={disabled}
      onPress={onPress}
      marker={<View style={[styles.legendDot, { backgroundColor: theme[color] }]} />}
    />
  );
}

/** Mes (tablero 6.2): calendario con los días registrados y una línea por categoría. */
function MonthPanel({
  history,
  items,
  today,
  locale,
  onOpenDay,
}: {
  history: ReturnType<typeof useDailyLogHistory>;
  items: readonly HistoryItemView[];
  today: string;
  locale: string;
  onOpenDay: (date: string) => void;
}) {
  const theme = useTheme();
  const [month, setMonth] = useState(() => ({ year: Number(today.slice(0, 4)), index: Number(today.slice(5, 7)) - 1 }));
  const dates = monthDates(month.year, month.index).filter((date) => date <= today);
  const monthStart = monthDates(month.year, month.index)[0];
  const logs = items.map((item) => item.log);
  const loggedDates = new Set(logs.map((log) => log.log_date));
  const loggedInMonth = dates.filter((date) => loggedDates.has(date)).length;
  const isCurrentMonth = today.startsWith(monthStart.slice(0, 7));
  const loadingOlder = needsOlderPages(logs, monthStart, history.hasNextPage);

  // Para ver el mes completo se cargan las páginas que falten (sin conexión, solo lo del dispositivo).
  const { fetchNextPage, isFetchingNextPage, isFetchNextPageError } = history;
  useEffect(() => {
    if (loadingOlder && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage();
  }, [loadingOlder, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);

  const monthTitle = capitalizeFirst(
    new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
      new Date(Date.UTC(month.year, month.index, 15))
    ),
    locale
  );
  const shift = (delta: number) =>
    setMonth((current) => {
      const total = current.year * 12 + current.index + delta;
      return { year: Math.floor(total / 12), index: total % 12 };
    });

  return (
    <>
      <Card>
        <View style={styles.monthHeader}>
          <IconButton icon={ChevronLeft} accessibilityLabel={t('dailyLogs.history.prevMonth')} onPress={() => shift(-1)} />
          <Text variant="bodyStrong" accessibilityRole="header">
            {monthTitle}
          </Text>
          <IconButton
            icon={ChevronRight}
            accessibilityLabel={t('dailyLogs.history.nextMonth')}
            disabled={isCurrentMonth}
            onPress={() => shift(1)}
          />
        </View>
        <MonthCalendar
          year={month.year}
          monthIndex={month.index}
          today={today}
          loggedDates={loggedDates}
          weekdayLabels={WEEKDAY_DATES.map((date) => formatWeekdayInitial(date, locale))}
          dayLabel={(date, state) =>
            tf(state.today ? 'dailyLogs.history.todayA11y' : 'dailyLogs.history.dayA11y', {
              date: formatLogDateLabel(date, locale),
            })
          }
          onPressDay={onOpenDay}
        />
        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: theme.primary }]} />
            <Text variant="caption" color="inkMuted">
              {t('dailyLogs.history.legendLogged')}
            </Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: theme.accent }]} />
            <Text variant="caption" color="inkMuted">
              {t('dailyLogs.history.legendToday')}
            </Text>
          </View>
        </View>
      </Card>

      <View style={styles.section}>
        <View style={styles.between}>
          <Text variant="title3" accessibilityRole="header">
            {t('dailyLogs.history.monthSeries')}
          </Text>
          <Text variant="caption" color="inkMuted">
            {t('dailyLogs.history.monthSeriesHint')}
          </Text>
        </View>
        {loadingOlder ? (
          <Text variant="caption" color="inkMuted" accessibilityLiveRegion="polite">
            {t('dailyLogs.history.monthLoading')}
          </Text>
        ) : null}
        <Card flush>
          {HISTORY_SERIES.map((series, index) => {
            const values = seriesValues(logs, dates, series.column);
            const last = [...values].reverse().find((value) => value !== null) ?? null;
            const caption =
              last === null
                ? t('home.week.none')
                : tf('home.week.last', { value: scaleValueLabel(series.id, last as 1 | 2 | 3 | 4 | 5) });
            return (
              <View
                key={series.id}
                accessible
                accessibilityLabel={`${t(`dailyLogs.fields.${series.id}`)}. ${caption}`}
                style={[
                  styles.smRow,
                  index < HISTORY_SERIES.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.line },
                ]}>
                <View style={[styles.legendDot, { backgroundColor: theme[series.color] }]} />
                <View style={styles.flex}>
                  <Text variant="label">{t(`dailyLogs.fields.${series.id}`)}</Text>
                  <Text variant="caption" color="inkMuted">
                    {caption}
                  </Text>
                </View>
                <Sparkline values={values} color={series.color} dash={series.dash} width={132} height={32} />
              </View>
            );
          })}
        </Card>
        <Text variant="caption" color="inkMuted">
          {tf('dailyLogs.history.monthCount', { count: loggedInMonth, days: dates.length })}
        </Text>
      </View>
    </>
  );
}

function dayTitle(date: string, today: string, locale: string, withYear: boolean): string {
  const label = formatLogDateLabel(date, locale, { withYear });
  if (date === today) return `${t('dailyLogs.today')}, ${label}`;
  return capitalizeFirst(label, locale);
}

function MissingDayRow({
  date,
  today,
  divider,
  onLogToday,
}: {
  date: string;
  today: string;
  divider: boolean;
  onLogToday?: () => void;
}) {
  const theme = useTheme();
  const locale = getLocale();
  return (
    <View style={[styles.missingRow, divider && { borderBottomWidth: 1, borderBottomColor: theme.line }]}>
      <View style={styles.flex}>
        <Text variant="bodyStrong" color="inkMuted">
          {dayTitle(date, today, locale, false)}
        </Text>
        <Text variant="caption" color="inkMuted">
          {t('dailyLogs.history.noLog')}
        </Text>
      </View>
      {onLogToday ? <TextLink label={t('dailyLogs.history.logToday')} onPress={onLogToday} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  top: {
    minHeight: size.touchMin,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  empty: {
    alignItems: 'center',
    gap: spacing['3'],
    paddingTop: spacing['10'],
  },
  emptyText: {
    maxWidth: 300,
  },
  center: {
    textAlign: 'center',
  },
  section: {
    gap: 10,
  },
  weekCard: {
    gap: 14,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  monthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing['4'],
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  between: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing['3'],
  },
  smRow: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing['3'],
    paddingVertical: spacing['2'],
    paddingHorizontal: spacing['4'],
  },
  missingRow: {
    minHeight: size.listRow,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing['3'],
    paddingVertical: 10,
    paddingHorizontal: spacing['4'],
  },
  flex: {
    flex: 1,
  },
});
