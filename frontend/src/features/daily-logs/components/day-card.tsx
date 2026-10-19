import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { WeekRing } from '@/components/ui/week-ring';
import { SyncStatusTag } from '@/features/daily-logs/components/sync-status';
import { PRIMARY_SCALE_FIELDS, type ScaleValue } from '@/features/daily-logs/daily-log-form';
import { scaleValueLabel } from '@/features/daily-logs/scale-labels';
import { dayCardMessage, type WeekOverview } from '@/features/daily-logs/week-overview';
import { useTheme } from '@/hooks/use-theme';
import { t, tf } from '@/i18n';
import { radius, spacing } from '@/theme/tokens';

type DayCardProps = {
  petName: string;
  overview: WeekOverview;
  /** UX (`can_edit_pet`); `null` = sin comprobar (sin conexión): se ofrece y decide el servidor. */
  canEdit: boolean | null;
  /** Abre el registro de hoy (crear, editar o ver). */
  onOpenLog: () => void;
};

const PRIMARY_COLUMNS = {
  energy: 'energy_level',
  appetite: 'appetite_level',
  mood: 'mood_level',
  activity: 'activity_level',
} as const;

/**
 * Tarjeta del día de Hoy (tableros 4.1, 4.2, 4.3, 4.6 y 5.8): anillo de la semana, mensaje y acción.
 * Las cifras salen de los registros (servidor + dispositivo); la racha solo se dice si se puede
 * afirmar con lo cargado.
 */
export function DayCard({ petName, overview, canEdit, onOpenLog }: DayCardProps) {
  const theme = useTheme();
  const message = dayCardMessage(overview);
  const done = message.kind === 'done';
  const ringText = `${overview.weekCount}/7`;

  const title =
    message.kind === 'first'
      ? tf('home.day.firstTitle', { name: petName })
      : done
        ? t('home.day.doneTitle')
        : t('home.day.pendingTitle');

  const text =
    message.kind === 'first'
      ? t('home.day.firstText')
      : message.kind === 'restart'
        ? t('home.day.restartText')
        : message.kind === 'pending'
          ? message.weekCount > 0
            ? tf('home.day.pendingText', { name: petName, count: message.weekCount })
            : t('home.day.pendingTextNoWeek')
          : message.streak !== null && message.streak >= 2
            ? tf('home.day.doneStreakText', { name: petName, count: message.weekCount, streak: message.streak })
            : tf('home.day.doneText', { name: petName, count: message.weekCount });

  const syncStatus = overview.today?.syncStatus;

  return (
    <Card style={styles.card}>
      <View style={styles.row}>
        <WeekRing
          days={overview.days}
          today={done ? 'done' : 'pending'}
          text={ringText}
          animateToday
          accessibilityLabel={tf(done ? 'home.day.ringDone' : 'home.day.ringPending', { count: overview.weekCount })}
        />
        <View style={styles.text}>
          <Text variant="title2" accessibilityRole="header">
            {title}
          </Text>
          {done && syncStatus && syncStatus !== 'synced' ? <SyncStatusTag status={syncStatus} /> : null}
          <Text color="inkMuted">{text}</Text>
        </View>
      </View>

      {done && overview.today ? (
        <View style={styles.kv}>
          {PRIMARY_SCALE_FIELDS.map((field) => {
            const value = overview.today?.log[PRIMARY_COLUMNS[field]] ?? null;
            return (
              <View key={field} style={[styles.kvCell, { backgroundColor: theme.surfaceSunken }]}>
                <Text variant="caption" color="inkMuted" numberOfLines={1}>
                  {t(`dailyLogs.fields.${field}`)}
                </Text>
                <Text variant="label" numberOfLines={2}>
                  {value === null ? t('dailyLogs.scale.notAnswered') : scaleValueLabel(field, value as ScaleValue)}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}

      {done ? (
        <Button
          variant="secondary"
          size="md"
          label={canEdit === false ? t('home.day.viewToday') : t('home.day.editToday')}
          onPress={onOpenLog}
        />
      ) : canEdit === false ? (
        <Text variant="caption" color="inkMuted">
          {tf('home.day.readOnly', { name: petName })}
        </Text>
      ) : (
        <Button
          label={message.kind === 'first' ? t('home.day.firstAction') : t('home.day.pendingAction')}
          onPress={onOpenLog}
        />
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing['5'],
    gap: spacing['4'],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing['4'],
  },
  text: {
    flex: 1,
    gap: spacing['1'],
  },
  kv: {
    flexDirection: 'row',
    gap: spacing['2'],
  },
  kvCell: {
    flex: 1,
    minWidth: 0,
    gap: 2,
    paddingVertical: spacing['2'],
    paddingHorizontal: 10,
    borderRadius: radius.sm,
  },
});
