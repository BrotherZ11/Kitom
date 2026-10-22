import { StyleSheet, View } from 'react-native';

import { IconButton } from '@/components/ui/icon-button';
import { ChevronLeft, ChevronRight } from '@/components/ui/icons';
import { MonthCalendar } from '@/components/ui/month-calendar';
import { Text } from '@/components/ui/text';
import { formatLogDateLabel, formatWeekdayInitial } from '@/features/daily-logs/log-date';
import { formatMonthTitle } from '@/features/reminders/reminder-format';
import { getLocale, t, tf } from '@/i18n';
import { spacing } from '@/theme/tokens';

/** Una semana que empieza en lunes (para las iniciales de los días). */
const WEEKDAY_DATES = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'];

export type MonthCursor = { year: number; index: number };

export function shiftMonth(month: MonthCursor, delta: number): MonthCursor {
  const total = month.year * 12 + month.index + delta;
  return { year: Math.floor(total / 12), index: ((total % 12) + 12) % 12 };
}

type ReminderMonthProps = {
  month: MonthCursor;
  onChangeMonth: (month: MonthCursor) => void;
  /** Hoy (`YYYY-MM-DD`, hora local). */
  today: string;
  /** Días con algo apuntado (punto). */
  markedDates: ReadonlySet<string>;
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
  /** Primer día que se puede elegir (`YYYY-MM-DD`); los anteriores no se pulsan. */
  minDate?: string;
  /** No ir a meses anteriores a este. */
  minMonth?: MonthCursor;
};

/** Mes con navegación (tableros 8.2 y selector de día del 8.3). Todos los días del mes se pueden elegir. */
export function ReminderMonth({
  month,
  onChangeMonth,
  today,
  markedDates,
  selectedDate,
  onSelectDate,
  minDate,
  minMonth,
}: ReminderMonthProps) {
  const locale = getLocale();
  const atMin = minMonth ? month.year * 12 + month.index <= minMonth.year * 12 + minMonth.index : false;
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <IconButton
          icon={ChevronLeft}
          accessibilityLabel={t('agenda.month.previous')}
          disabled={atMin}
          onPress={() => onChangeMonth(shiftMonth(month, -1))}
        />
        <Text variant="bodyStrong" accessibilityRole="header">
          {formatMonthTitle(month.year, month.index, locale)}
        </Text>
        <IconButton
          icon={ChevronRight}
          accessibilityLabel={t('agenda.month.next')}
          onPress={() => onChangeMonth(shiftMonth(month, 1))}
        />
      </View>
      <MonthCalendar
        year={month.year}
        monthIndex={month.index}
        today={today}
        loggedDates={markedDates}
        weekdayLabels={WEEKDAY_DATES.map((date) => formatWeekdayInitial(date, locale))}
        selectedDate={selectedDate}
        dimFuture={false}
        isDayPressable={(date) => !minDate || date >= minDate}
        dayLabel={(date, state) =>
          tf(state.logged ? 'agenda.month.dayWithA11y' : 'agenda.month.dayA11y', {
            date: formatLogDateLabel(date, locale, { withYear: true }),
          })
        }
        onPressDay={onSelectDate}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing['3'],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
