import { StyleSheet, View } from 'react-native';

import { Alert } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { isDailyLogTag } from '@/features/daily-logs/daily-log-form';
import type { HistoryItemView } from '@/features/daily-logs/offline/daily-log-view';
import { speciesFieldLabel } from '@/features/species/species-labels';
import { computeObservations, type Observation } from '@/features/wellness/wellness-observations';
import { groupLabel, seriesLabel, shortDate } from '@/features/wellness/wellness-labels';
import type { WellnessPeriod } from '@/features/wellness/wellness-stats';
import { t, tf } from '@/i18n';
import { spacing } from '@/theme/tokens';

function observationText(observation: Observation): string {
  switch (observation.kind) {
    case 'run':
      return tf(observation.group === 'below' ? 'wellness.patterns.runBelow' : 'wellness.patterns.runAbove', {
        field: seriesLabel(observation.series),
        group: groupLabel(observation.series, observation.group).toLocaleLowerCase(),
        days: observation.days,
        start: shortDate(observation.start),
        end: shortDate(observation.end),
      });
    case 'yes_run':
      return tf('wellness.patterns.yesRun', {
        field: speciesFieldLabel(observation.code),
        days: observation.days,
        start: shortDate(observation.start),
        end: shortDate(observation.end),
      });
    case 'unusual':
      return tf('wellness.patterns.unusual', { count: observation.dates.length, dates: observation.dates.map(shortDate).join(', ') });
    case 'tag':
      return tf('wellness.patterns.tag', {
        tag: isDailyLogTag(observation.tag) ? t(`dailyLogs.tags.${observation.tag}`) : observation.tag,
        dates: observation.dates.map(shortDate).join(', '),
      });
    case 'low_coverage':
      return tf('wellness.patterns.lowCoverage', { logged: observation.logged, total: observation.total });
  }
}

/**
 * Observaciones (D-9): reglas descriptivas con umbral (`wellness-observations.ts`), siempre como `info`
 * (nunca aviso ni alarma) y con los días que las producen. Sin causas ni correlaciones.
 */
export function WellnessPatterns({
  items,
  today,
  period,
  speciesCode,
}: {
  items: readonly HistoryItemView[];
  today: string;
  period: WellnessPeriod;
  speciesCode: string | null;
}) {
  const observations = computeObservations({ items, today, period, speciesCode });
  return (
    <View style={styles.container}>
      <Text color="inkMuted">{t('wellness.patternsIntro')}</Text>
      {observations.length === 0 ? (
        <Card>
          <Text>{t('wellness.patterns.none')}</Text>
        </Card>
      ) : (
        observations.map((observation, index) => (
          <Alert key={`${observation.kind}-${index}`} tone="info" message={observationText(observation)} />
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing['3'],
  },
});
