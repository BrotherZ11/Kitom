import { StyleSheet, View } from 'react-native';

import { Alert } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { DistributionBar } from '@/components/ui/distribution-bar';
import { ListItem } from '@/components/ui/list-item';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Tag } from '@/components/ui/tag';
import { Text } from '@/components/ui/text';
import { isDailyLogTag } from '@/features/daily-logs/daily-log-form';
import { formatSpeciesValue, speciesFieldLabel, speciesOptionLabel } from '@/features/species/species-labels';
import {
  distributionText,
  seriesColor,
  seriesLabel,
  seriesValueLabel,
  shortDate,
} from '@/features/wellness/wellness-labels';
import {
  WELLNESS_PERIODS,
  type EvolutionSeries,
  type SpeciesFieldSummary,
  type WellnessPeriod,
  type WellnessSummary,
} from '@/features/wellness/wellness-stats';
import { useTheme } from '@/hooks/use-theme';
import { t, tf } from '@/i18n';
import { spacing } from '@/theme/tokens';

type WellnessSummaryViewProps = {
  summary: WellnessSummary;
  /** Sin conexión y sin el rango completo en el dispositivo: cifras parciales, sin comparación. */
  partial: boolean;
  onPeriod: (period: WellnessPeriod) => void;
  onEvolution: () => void;
  onPatterns: () => void;
};

/**
 * Resumen (tablero propuesto en `docs/proposals/2026-11-10-wellness-reports.md` §3.2): cobertura, reparto
 * de días por escala (con su `n`), lo propio de la especie, fuera de lo habitual y etiquetas, y la
 * comparación con el periodo anterior cuando los dos tienen datos suficientes. Sin medias ni índices.
 */
export function WellnessSummaryView({ summary, partial, onPeriod, onEvolution, onPatterns }: WellnessSummaryViewProps) {
  const theme = useTheme();
  const nextPeriod = WELLNESS_PERIODS.find((value) => value > summary.period) ?? null;
  const comparisons = [
    ...summary.scales.flatMap((scale) =>
      scale.comparison ? [{ series: { kind: 'core', field: scale.field } as EvolutionSeries, now: scale.distribution, before: scale.comparison.previous }] : []
    ),
    ...summary.speciesFields.flatMap((field) =>
      field.kind === 'scale3' && field.comparison
        ? [{ series: { kind: 'species', code: field.code } as EvolutionSeries, now: field.distribution, before: field.comparison.previous }]
        : []
    ),
  ];

  return (
    <View style={styles.container}>
      <Card style={styles.card}>
        <Text variant="title3" accessibilityRole="header">
          {tf('wellness.coverage', { logged: summary.loggedDays, total: summary.totalDays })}
        </Text>
        <ProgressBar value={summary.loggedDays / summary.totalDays} />
        {!summary.todayLogged ? (
          <Text variant="caption" color="inkMuted">
            {t('wellness.todayPending')}
          </Text>
        ) : null}
      </Card>

      {summary.loggedDays === 0 && summary.hasEarlierLogs ? (
        <Alert
          tone="info"
          message={tf('wellness.noLogsInPeriod', { days: summary.period })}
          action={nextPeriod ? { label: tf('wellness.tryLonger', { days: nextPeriod }), onPress: () => onPeriod(nextPeriod) } : undefined}
        />
      ) : null}

      <View style={styles.section}>
        <Text variant="title3" accessibilityRole="header">
          {t('wellness.scalesTitle')}
        </Text>
        <Text variant="caption" color="inkMuted">
          {t('wellness.scalesHint')}
        </Text>
        <Card flush>
          {summary.scales.map((scale, index) => {
            const series: EvolutionSeries = { kind: 'core', field: scale.field };
            const label = seriesLabel(series);
            const detail = scale.sufficient ? distributionText(series, scale.distribution) : tf('wellness.fewData', { n: scale.n });
            const last = scale.last
              ? tf('wellness.lastValue', { value: seriesValueLabel(series, scale.last.value), date: shortDate(scale.last.date) })
              : null;
            return (
              <View
                key={scale.field}
                accessible
                accessibilityLabel={[label, tf('wellness.indicatedIn', { n: scale.n, total: summary.totalDays }), detail, last]
                  .filter(Boolean)
                  .join('. ')}
                style={[styles.row, index < summary.scales.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.line }]}>
                <View style={styles.between}>
                  <Text variant="bodyStrong">{label}</Text>
                  <Text variant="caption" color="inkMuted">
                    {tf('wellness.indicatedIn', { n: scale.n, total: summary.totalDays })}
                  </Text>
                </View>
                {scale.sufficient ? <DistributionBar counts={scale.distribution} color={seriesColor(series, index)} /> : null}
                <Text variant="caption" color={scale.sufficient ? 'ink' : 'inkMuted'}>
                  {detail}
                </Text>
                {last ? (
                  <Text variant="caption" color="inkMuted">
                    {last}
                  </Text>
                ) : null}
              </View>
            );
          })}
        </Card>
      </View>

      {summary.speciesFields.length > 0 ? (
        <View style={styles.section}>
          <Text variant="title3" accessibilityRole="header">
            {t('wellness.speciesTitle')}
          </Text>
          <Card flush>
            {summary.speciesFields.map((field, index) => (
              <SpeciesFieldRow
                key={field.code}
                field={field}
                total={summary.totalDays}
                period={summary.period}
                index={index}
                divider={index < summary.speciesFields.length - 1}
              />
            ))}
          </Card>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text variant="title3" accessibilityRole="header">
          {t('wellness.unusualTitle')}
        </Text>
        <Card style={styles.card}>
          <Text>
            {summary.unusualDates.length > 0
              ? tf('wellness.unusualCount', { count: summary.unusualDates.length, total: summary.totalDays })
              : t('wellness.unusualNone')}
          </Text>
          {summary.unusualDates.length > 0 ? (
            <Text variant="caption" color="inkMuted">
              {summary.unusualDates.map(shortDate).join(', ')}
            </Text>
          ) : null}
        </Card>
      </View>

      {summary.tags.length > 0 ? (
        <View style={styles.section}>
          <Text variant="title3" accessibilityRole="header">
            {t('wellness.tagsTitle')}
          </Text>
          <View style={styles.tags}>
            {summary.tags.map(({ tag, dates }) => (
              <Tag
                key={tag}
                label={`${isDailyLogTag(tag) ? t(`dailyLogs.tags.${tag}`) : tag} · ${
                  dates.length === 1 ? t('wellness.tagDay') : tf('wellness.tagDays', { count: dates.length })
                }`}
              />
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text variant="title3" accessibilityRole="header">
          {tf('wellness.compareTitle', { days: summary.period })}
        </Text>
        <Card style={styles.card}>
          {!partial && comparisons.length > 0 ? (
            comparisons.map(({ series, now, before }) => (
              <Text key={series.kind === 'core' ? series.field : series.code} variant="caption">
                {tf('wellness.compareRow', {
                  label: seriesLabel(series),
                  before: distributionText(series, before),
                  now: distributionText(series, now),
                })}
              </Text>
            ))
          ) : (
            <Text variant="caption" color="inkMuted">
              {tf('wellness.compareNone', { days: summary.period })}
            </Text>
          )}
        </Card>
      </View>

      <Card flush>
        <ListItem title={t('wellness.evolutionEntry')} subtitle={t('wellness.evolutionEntryText')} onPress={onEvolution} chevron divider />
        <ListItem title={t('wellness.patternsEntry')} subtitle={t('wellness.patternsEntryText')} onPress={onPatterns} chevron />
      </Card>
    </View>
  );
}

function SpeciesFieldRow({
  field,
  total,
  period,
  index,
  divider,
}: {
  field: SpeciesFieldSummary;
  total: number;
  period: WellnessPeriod;
  index: number;
  divider: boolean;
}) {
  const theme = useTheme();
  const label = speciesFieldLabel(field.code);
  const series: EvolutionSeries = { kind: 'species', code: field.code };
  const lines: string[] = [];
  if (field.n === 0) {
    lines.push(tf('wellness.fewData', { n: 0 }));
  } else if (field.kind === 'scale3') {
    lines.push(field.sufficient ? distributionText(series, field.distribution) : tf('wellness.fewData', { n: field.n }));
  } else if (field.kind === 'boolean') {
    lines.push(tf('wellness.yesDays', { yes: field.yes, n: field.n }));
  } else if (field.kind === 'choice' || field.kind === 'multi_choice') {
    const counts = field.options
      .filter((option) => field.counts[option])
      .map((option) => `${speciesOptionLabel(field.code, option)}: ${field.counts[option]}`)
      .join(' · ');
    lines.push(tf('wellness.choiceCounts', { counts, n: field.n }));
  } else if ((field.kind === 'integer' || field.kind === 'decimal') && field.median !== null && field.min !== null && field.max !== null) {
    const format = (value: number) => formatSpeciesValue(field.code, value);
    lines.push(tf('wellness.numbers', { median: format(field.median), min: format(field.min), max: format(field.max), n: field.n }));
    if (field.previousMedian !== null) {
      lines.push(tf('wellness.previousMedian', { days: period, median: format(field.previousMedian) }));
    }
  }
  return (
    <View
      accessible
      accessibilityLabel={[label, tf('wellness.indicatedIn', { n: field.n, total }), ...lines].join('. ')}
      style={[styles.row, divider && { borderBottomWidth: 1, borderBottomColor: theme.line }]}>
      <View style={styles.between}>
        <Text variant="bodyStrong">{label}</Text>
        <Text variant="caption" color="inkMuted">
          {tf('wellness.indicatedIn', { n: field.n, total })}
        </Text>
      </View>
      {field.kind === 'scale3' && field.sufficient ? (
        <DistributionBar counts={field.distribution} color={seriesColor(series, index)} />
      ) : null}
      {lines.map((line) => (
        <Text key={line} variant="caption">
          {line}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing['5'],
  },
  section: {
    gap: 10,
  },
  card: {
    gap: spacing['2'],
  },
  row: {
    gap: 6,
    paddingVertical: spacing['3'],
    paddingHorizontal: spacing['4'],
  },
  between: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing['3'],
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing['2'],
  },
});
