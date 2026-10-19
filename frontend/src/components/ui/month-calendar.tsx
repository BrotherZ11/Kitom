import { Pressable, StyleSheet, View } from 'react-native';

import { monthGrid } from '@/components/ui/chart-geometry';
import { Text } from '@/components/ui/text';
import { useTheme } from '@/hooks/use-theme';
import { fontFamily, radius, spacing } from '@/theme/tokens';

type MonthCalendarProps = {
  year: number;
  /** 0 = enero. */
  monthIndex: number;
  /** Hoy (`YYYY-MM-DD`): se marca con fondo inverso y punto sol. */
  today: string;
  /** Días con registro (punto `primary`). */
  loggedDates: ReadonlySet<string>;
  /** Iniciales de los días de la semana, empezando en lunes. */
  weekdayLabels: readonly string[];
  /** Texto accesible de un día (fecha completa y estado). */
  dayLabel: (date: string, state: { logged: boolean; today: boolean }) => string;
  /** Solo los días con registro (u hoy) son pulsables: abren su detalle. */
  onPressDay: (date: string) => void;
};

/**
 * Calendario de un mes (MonthCalendar del tablero 6.2): días con registro, hoy y días fuera del mes.
 * Un día sin registro se queda en blanco: no se rellena nada.
 */
export function MonthCalendar({
  year,
  monthIndex,
  today,
  loggedDates,
  weekdayLabels,
  dayLabel,
  onPressDay,
}: MonthCalendarProps) {
  const theme = useTheme();
  const cells = monthGrid(year, monthIndex);

  return (
    <View style={styles.grid}>
      {weekdayLabels.map((label) => (
        <View key={label} style={styles.cell}>
          <Text variant="caption" color="inkMuted" style={styles.weekday}>
            {label}
          </Text>
        </View>
      ))}
      {cells.map((cell) => {
        const logged = cell.inMonth && loggedDates.has(cell.date);
        const isToday = cell.date === today;
        const future = cell.date > today;
        const content = (
          <View
            style={[
              styles.day,
              isToday && { backgroundColor: theme.surfaceInverse },
            ]}>
            <Text
              color={isToday ? 'inkInverse' : cell.inMonth && !future ? 'ink' : 'inkSubtle'}
              style={styles.dayNumber}>
              {String(cell.day)}
            </Text>
            <View
              style={[
                styles.dot,
                { backgroundColor: isToday ? theme.accent : logged ? theme.primary : 'transparent' },
              ]}
            />
          </View>
        );
        const pressable = cell.inMonth && (logged || isToday);
        return (
          <View key={cell.date} style={styles.cell}>
            {pressable ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={dayLabel(cell.date, { logged, today: isToday })}
                onPress={() => onPressDay(cell.date)}>
                {content}
              </Pressable>
            ) : (
              <View
                accessible={cell.inMonth}
                accessibilityLabel={cell.inMonth ? dayLabel(cell.date, { logged, today: isToday }) : undefined}
                importantForAccessibility={cell.inMonth ? 'yes' : 'no-hide-descendants'}>
                {content}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing['1'],
  },
  cell: {
    width: `${100 / 7}%`,
    paddingHorizontal: 2,
  },
  weekday: {
    textAlign: 'center',
    fontSize: 11,
    lineHeight: 14,
    paddingBottom: spacing['1'],
  },
  day: {
    height: 44,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  dayNumber: {
    fontFamily: fontFamily.mono500,
    fontSize: 14,
    lineHeight: 18,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: radius.full,
  },
});
