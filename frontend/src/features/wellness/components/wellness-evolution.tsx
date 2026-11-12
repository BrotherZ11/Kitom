import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Text } from '@/components/ui/text';
import { TrendChart } from '@/components/ui/trend-chart';
import { WeekColumns } from '@/components/ui/week-columns';
import { formatWeekdayInitial } from '@/features/daily-logs/log-date';
import type { HistoryItemView } from '@/features/daily-logs/offline/daily-log-view';
import { CORE_SCALES, dailyDefinition } from '@/features/species/species-fields';
import {
  groupLabel,
  seriesColor,
  seriesDash,
  seriesKey,
  seriesLabel,
  compactDate,
  seriesValueLabel,
  shortDate,
} from '@/features/wellness/wellness-labels';
import { dailySeries, weeklyDistributions, type EvolutionSeries, type WellnessSummary } from '@/features/wellness/wellness-stats';
import { useTheme } from '@/hooks/use-theme';
import { getLocale, t, tf } from '@/i18n';
import { spacing } from '@/theme/tokens';

const MAX_SELECTED = 3;
const WEEKS_IN_90_DAYS = 13;

/** Series que se pueden ver: las escalas que se preguntan a la especie y sus campos «menos/más». */
function availableSeries(speciesCode: string | null): EvolutionSeries[] {
  const definition = dailyDefinition(speciesCode);
  return [
    ...CORE_SCALES.filter((field) => definition.core[field] !== 'hidden').map((field): EvolutionSeries => ({ kind: 'core', field })),
    ...definition.daily.filter((field) => field.kind === 'scale3').map((field): EvolutionSeries => ({ kind: 'species', code: field.code })),
  ];
}

/**
 * Evolución (propuesta §2.3 B): hasta 3 series a la vez con color y trazo propios. 7 y 30 días: el valor
 * de cada día, con huecos donde no hay dato (`TrendChart`). 90 días: una columna por semana con el
 * reparto de sus días (`WeekColumns`), porque una línea de 90 puntos con huecos no se lee en un móvil.
 */
export function WellnessEvolution({
  items,
  summary,
  petName,
  speciesCode,
}: {
  items: readonly HistoryItemView[];
  summary: WellnessSummary;
  petName: string | null;
  speciesCode: string | null;
}) {
  const theme = useTheme();
  const locale = getLocale();
  const all = availableSeries(speciesCode);
  const [selectedKeys, setSelectedKeys] = useState<string[]>(() => all.slice(0, MAX_SELECTED).map(seriesKey));
  const selected = all.filter((series) => selectedKeys.includes(seriesKey(series)));
  const full = selected.length >= MAX_SELECTED;
  const dates = summary.window.dates;

  const toggle = (key: string) =>
    setSelectedKeys((current) =>
      current.includes(key)
        ? current.length > 1
          ? current.filter((item) => item !== key)
          : current
        : current.length >= MAX_SELECTED
          ? current
          : [...current, key]
    );

  const describe = (series: EvolutionSeries) => {
    const values = dailySeries(items, dates, series);
    const parts = dates.flatMap((date, index) => {
      const value = values[index];
      return value === null ? [] : [`${shortDate(date)} ${seriesValueLabel(series, value)}`];
    });
    return `${seriesLabel(series)}: ${parts.length > 0 ? parts.join(', ') : tf('wellness.noSeriesData', { label: seriesLabel(series) })}`;
  };

  return (
    <View style={styles.container}>
      <View style={styles.chips} accessibilityLabel={t('dailyLogs.history.categories')}>
        {all.map((series, index) => {
          const key = seriesKey(series);
          const on = selectedKeys.includes(key);
          return (
            <Chip
              key={key}
              label={seriesLabel(series)}
              selected={on}
              disabled={!on && full}
              onPress={() => toggle(key)}
              marker={<View style={[styles.dot, { backgroundColor: theme[seriesColor(series, index)] }]} />}
            />
          );
        })}
      </View>
      {full ? (
        <Text variant="caption" color="inkMuted">
          {t('wellness.seriesLimit')}
        </Text>
      ) : null}

      {summary.period === 90 ? (
        <>
          <Text variant="caption" color="inkMuted">
            {t('wellness.weeksHint')}
          </Text>
          {selected.map((series) => {
            const index = all.findIndex((item) => seriesKey(item) === seriesKey(series));
            const weeks = weeklyDistributions(items, summary.window.end, series, WEEKS_IN_90_DAYS);
            const description = weeks
              .map((week) =>
                tf('wellness.weekA11y', {
                  date: shortDate(week.end),
                  below: week.distribution.below,
                  usual: week.distribution.usual,
                  above: week.distribution.above,
                  none: week.withoutValue,
                })
              )
              .join('. ');
            return (
              <Card key={seriesKey(series)} style={styles.card}>
                <Text variant="bodyStrong">{seriesLabel(series)}</Text>
                <WeekColumns
                  weeks={weeks.map((week) => ({ counts: week.distribution, withoutValue: week.withoutValue }))}
                  color={seriesColor(series, index)}
                  xLabels={weeks.map((week, weekIndex) => (weekIndex % 4 === 0 || weekIndex === weeks.length - 1 ? compactDate(week.end) : ''))}
                  accessibilityLabel={`${seriesLabel(series)}. ${description}`}
                />
                <Text variant="caption" color="inkMuted">
                  {`${groupLabel(series, 'below')} · ${groupLabel(series, 'usual')} · ${groupLabel(series, 'above')}`}
                </Text>
              </Card>
            );
          })}
        </>
      ) : (
        <Card style={styles.card}>
          <TrendChart
            series={selected.map((series) => {
              const index = all.findIndex((item) => seriesKey(item) === seriesKey(series));
              return {
                id: seriesKey(series),
                color: seriesColor(series, index),
                dash: seriesDash(series, index),
                values: dailySeries(items, dates, series),
              };
            })}
            xLabels={dates.map((date) => (summary.period === 7 ? formatWeekdayInitial(date, locale) : date.slice(8, 10)))}
            labelEvery={summary.period === 7 ? 1 : 7}
            yLabels={[t('dailyLogs.history.high'), t('dailyLogs.history.mid'), t('dailyLogs.history.low')]}
            accessibilityLabel={tf('wellness.chartLabel', {
              name: petName ?? '',
              days: summary.period,
              series: selected.map(describe).join('. '),
            })}
          />
          <Text variant="caption" color="inkMuted">
            {t('wellness.evolutionHint')}
          </Text>
        </Card>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing['4'],
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  card: {
    gap: spacing['3'],
  },
});
