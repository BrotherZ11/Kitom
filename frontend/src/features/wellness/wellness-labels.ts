import { HISTORY_SERIES } from '@/features/daily-logs/history-view';
import { formatLogDateLabel } from '@/features/daily-logs/log-date';
import { scaleValueLabel } from '@/features/daily-logs/scale-labels';
import type { CoreScale } from '@/features/species/species-fields';
import { speciesFieldLabel } from '@/features/species/species-labels';
import type { Distribution, EvolutionSeries, ScaleGroup } from '@/features/wellness/wellness-stats';
import type { ThemeColor } from '@/hooks/use-theme';
import { getLocale, t, tf } from '@/i18n';

/** Ánimo y sueño son de calidad (peor/mejor); el resto, relativas a lo habitual (menos/más). */
function isQuality(series: EvolutionSeries): boolean {
  return series.kind === 'core' && (series.field === 'mood' || series.field === 'sleep');
}

export function seriesKey(series: EvolutionSeries): string {
  return series.kind === 'core' ? `core:${series.field}` : `species:${series.code}`;
}

export function seriesLabel(series: EvolutionSeries): string {
  return series.kind === 'core' ? t(`dailyLogs.fields.${series.field}`) : speciesFieldLabel(series.code);
}

export function groupLabel(series: EvolutionSeries, group: ScaleGroup): string {
  return t(`wellness.groups.${isQuality(series) ? 'quality' : 'relative'}.${group}`);
}

/** «2 menos · 10 como siempre · 1 más» (o peor/normal/mejor en las de calidad). */
export function distributionText(series: EvolutionSeries, distribution: Distribution): string {
  return tf(`wellness.distribution.${isQuality(series) ? 'quality' : 'relative'}`, {
    below: distribution.below,
    usual: distribution.usual,
    above: distribution.above,
  });
}

const EXTRA_COLORS: ThemeColor[] = ['chartEnergy', 'chartAppetite', 'chartMood', 'chartActivity', 'chartSleep'];

/** Color de una serie: el del historial para las escalas que ya tienen; las demás, por turno. */
export function seriesColor(series: EvolutionSeries, index: number): ThemeColor {
  if (series.kind === 'core') {
    const known = HISTORY_SERIES.find((item) => item.id === series.field);
    if (known) return known.color;
  }
  return EXTRA_COLORS[index % EXTRA_COLORS.length];
}

/** Trazo propio de cada serie (no depende solo del color). */
export function seriesDash(series: EvolutionSeries, index: number): string | undefined {
  if (series.kind === 'core') {
    const known = HISTORY_SERIES.find((item) => item.id === series.field);
    if (known) return known.dash;
  }
  return ['3 3', '8 3', '1 3', '6 2 1 2', '4 4'][index % 5];
}

/** Texto de un valor guardado de una serie (como en el historial). */
export function seriesValueLabel(series: EvolutionSeries, value: number): string {
  if (series.kind === 'core') return scaleValueLabel(series.field as CoreScale, value as 1 | 2 | 3 | 4 | 5);
  return t(`speciesFields.scale3.${String(value) as '2' | '3' | '4'}`);
}

export function shortDate(date: string): string {
  return formatLogDateLabel(date, getLocale());
}

/** «11 nov»: etiquetas de los ejes (las fechas son días naturales, sin zona). */
export function compactDate(date: string): string {
  return new Intl.DateTimeFormat(getLocale(), { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${date}T12:00:00Z`)
  );
}
