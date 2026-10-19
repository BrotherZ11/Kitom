import { StyleSheet, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { Tag } from '@/components/ui/tag';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/features/auth/auth-context';
import {
  DETAIL_SCALE_FIELDS,
  PRIMARY_SCALE_FIELDS,
  toDailyLogFormValues,
  type DailyLogContentSource,
  type ScaleValue,
} from '@/features/daily-logs/daily-log-form';
import { scaleValueLabel } from '@/features/daily-logs/scale-labels';
import type { DailyLog } from '@/features/daily-logs/types';
import { useTheme } from '@/hooks/use-theme';
import { getLocale, t, tf } from '@/i18n';
import { radius, spacing } from '@/theme/tokens';

type DayDetailProps = {
  content: DailyLogContentSource;
  /** Fila del servidor (autoría y horas); `null` si solo existe en este dispositivo. */
  serverRow: DailyLog | null;
  /** Hay cambios en el dispositivo sin subir: la autoría del servidor no describe lo que se ve. */
  hasLocalChanges: boolean;
};

/**
 * Detalle de un día (tablero 6.3), solo lectura: lo que se indicó, tal cual. Escalas principales con
 * cinco marcas (y su texto: nunca solo la barra), detalles, lo fuera de lo habitual, la nota y las
 * etiquetas. Abajo, quién lo registró y cuándo (`logged_by`, `last_edited_by`).
 */
export function DayDetail({ content, serverRow, hasLocalChanges }: DayDetailProps) {
  const theme = useTheme();
  const { user } = useAuth();
  const values = toDailyLogFormValues(content);

  const authorship = (() => {
    if (hasLocalChanges || !serverRow) return t('dailyLogs.entry.notSyncedYet');
    const created = formatTime(serverRow.created_at);
    const byYou = serverRow.logged_by !== null && serverRow.logged_by === user?.id;
    const logged = tf(byYou ? 'dailyLogs.entry.loggedByYou' : 'dailyLogs.entry.loggedByOther', { time: created });
    const edited = serverRow.updated_at !== serverRow.created_at ? formatTime(serverRow.updated_at) : null;
    return edited ? `${logged} · ${tf('dailyLogs.entry.editedAt', { time: edited })}` : logged;
  })();

  return (
    <>
      <Card style={styles.card}>
        {PRIMARY_SCALE_FIELDS.map((field) => {
          const value = values.scales[field];
          const label = t(`dailyLogs.fields.${field}`);
          const valueLabel = value === null ? t('dailyLogs.scale.notAnswered') : scaleValueLabel(field, value);
          return (
            <View key={field} style={styles.metric} accessible accessibilityLabel={`${label}: ${valueLabel}`}>
              <Text variant="label" style={styles.metricLabel}>
                {label}
              </Text>
              <Pips value={value} />
              <Text variant="caption" style={styles.metricValue}>
                {valueLabel}
              </Text>
            </View>
          );
        })}
        <View style={[styles.divider, { backgroundColor: theme.line }]} />
        <View style={styles.details}>
          {DETAIL_SCALE_FIELDS.map((field) => {
            const value = values.scales[field];
            return (
              <View key={field} style={styles.between}>
                <Text color="inkMuted" style={styles.flex}>
                  {t(`dailyLogs.fields.${field}`)}
                </Text>
                <Text>{value === null ? t('dailyLogs.scale.notAnswered') : scaleValueLabel(field, value)}</Text>
              </View>
            );
          })}
        </View>
      </Card>

      {values.unusualBehavior || values.notes.trim() !== '' || values.tags.length > 0 ? (
        <View style={styles.section}>
          {values.unusualBehavior ? (
            <>
              <Text variant="title3" accessibilityRole="header">
                {t('dailyLogs.entry.unusualTitle')}
              </Text>
              <Card variant="flat">
                <Text>{values.unusualBehaviorNotes.trim() || t('dailyLogs.entry.unusualNoNotes')}</Text>
              </Card>
            </>
          ) : null}
          {values.notes.trim() !== '' ? (
            <>
              <Text variant="title3" accessibilityRole="header">
                {t('dailyLogs.entry.noteTitle')}
              </Text>
              <Card variant="flat">
                <Text>{values.notes}</Text>
              </Card>
            </>
          ) : null}
          {values.tags.length > 0 ? (
            <>
              <Text variant="title3" accessibilityRole="header">
                {t('dailyLogs.entry.tagsTitle')}
              </Text>
              <View style={styles.tags}>
                {values.tags.map((tag) => (
                  <Tag key={tag} label={t(`dailyLogs.tags.${tag}`)} />
                ))}
              </View>
            </>
          ) : null}
        </View>
      ) : null}

      <Text variant="caption" color="inkMuted">
        {authorship}
      </Text>
    </>
  );
}

/** Cinco marcas de la escala (`.pips` del tablero 6.3); decorativas: el texto va al lado. */
function Pips({ value }: { value: ScaleValue | null }) {
  const theme = useTheme();
  return (
    <View style={styles.pips} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {[1, 2, 3, 4, 5].map((step) => (
        <View
          key={step}
          style={[styles.pip, { backgroundColor: value !== null && step <= value ? theme.primary : theme.surfaceSunken }]}
        />
      ))}
    </View>
  );
}

/** Hora local del dispositivo («21:04»). */
function formatTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat(getLocale(), { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

const styles = StyleSheet.create({
  card: {
    gap: 14,
  },
  metric: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing['3'],
  },
  metricLabel: {
    width: 84,
  },
  metricValue: {
    width: 96,
    textAlign: 'right',
  },
  pips: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing['1'],
  },
  pip: {
    flex: 1,
    height: 8,
    borderRadius: radius.full,
  },
  divider: {
    height: 1,
  },
  details: {
    gap: 6,
  },
  between: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing['3'],
  },
  flex: {
    flex: 1,
  },
  section: {
    gap: 10,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing['2'],
  },
});
