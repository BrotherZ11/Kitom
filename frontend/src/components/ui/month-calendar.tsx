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
  /** Día elegido (agenda, selector de fecha): contorno `primary`. */
  selectedDate?: string | null;
  /**
   * Qué días se pueden pulsar. Por defecto, los del mes con registro y hoy (historial). La agenda y el
   * selector de fecha pasan su propia regla.
   */
  isDayPressable?: (date: string, state: { logged: boolean; today: boolean }) => boolean;
  /** Atenuar los días posteriores a hoy (por defecto, sí: en el historial aún no tienen datos). */
  dimFuture?: boolean;
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
  selectedDate = null,
  isDayPressable,
  dimFuture = true,
}: MonthCalendarProps) {
  const theme = useTheme();
  const cells = monthGrid(year, monthIndex);

  const renderCell = (cell: (typeof cells)[number]) => {
    const logged = cell.inMonth && loggedDates.has(cell.date);
    const isToday = cell.date === today;
    const future = dimFuture && cell.date > today;
    const selected = cell.inMonth && cell.date === selectedDate;
    const state = { logged, today: isToday };
    const pressable = cell.inMonth && (isDayPressable ? isDayPressable(cell.date, state) : logged || isToday);
    const content = (
      <View
        style={[
          styles.day,
          isToday && { backgroundColor: theme.surfaceInverse },
          selected && { borderWidth: 2, borderColor: theme.primary },
        ]}>
        <Text
          color={isToday ? 'inkInverse' : cell.inMonth && !future && (pressable || !isDayPressable) ? 'ink' : 'inkSubtle'}
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
    return (
      <View key={cell.date} style={styles.cell}>
        {pressable ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={dayLabel(cell.date, state)}
            accessibilityState={selectedDate !== null ? { selected } : undefined}
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
  };
  // Filas explícitas de 7 celdas `flex: 1`: con anchos en porcentaje (100/7 %), el redondeo podía
  // pasar el séptimo día a la fila siguiente según el ancho del contenedor.
  const rows = Array.from({ length: cells.length / 7 }, (_, row) => cells.slice(row * 7, row * 7 + 7));

  return (
    <View style={styles.grid}>
      <View style={styles.row}>
        {weekdayLabels.map((label, index) => (
          // Índice como clave: en inglés las iniciales se repiten (T, T, S, S).
          <View key={index} style={styles.cell}>
            <Text variant="caption" color="inkMuted" style={styles.weekday}>
              {label}
            </Text>
          </View>
        ))}
      </View>
      {rows.map((row) => (
        <View key={row[0].date} style={styles.row}>
          {row.map(renderCell)}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    gap: spacing['1'],
  },
  row: {
    flexDirection: 'row',
  },
  cell: {
    flex: 1,
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
