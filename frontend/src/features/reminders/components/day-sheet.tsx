import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Chip } from '@/components/ui/chip';
import { ReminderMonth, type MonthCursor } from '@/features/reminders/components/reminder-month';
import { localDateKey } from '@/features/reminders/reminder-model';
import { t } from '@/i18n';
import { spacing } from '@/theme/tokens';

type DaySheetProps = {
  visible: boolean;
  /** Día elegido (`YYYY-MM-DD`). */
  value: string;
  /** No se pueden elegir días anteriores a hoy (recordatorio nuevo). */
  allowPast: boolean;
  onClose: () => void;
  onSelect: (date: string) => void;
};

function monthOf(date: string): MonthCursor {
  const [year, month] = date.split('-').map(Number);
  return { year, index: month - 1 };
}

/** Elegir el día (tablero 8.3): «Hoy», «Mañana» o un día del calendario. Elegir cierra la hoja. */
export function DaySheet({ visible, value, allowPast, onClose, onSelect }: DaySheetProps) {
  return visible ? <DaySheetContent value={value} allowPast={allowPast} onClose={onClose} onSelect={onSelect} /> : null;
}

function DaySheetContent({ value, allowPast, onClose, onSelect }: Omit<DaySheetProps, 'visible'>) {
  const now = new Date();
  const today = localDateKey(now);
  const tomorrow = localDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const [month, setMonth] = useState(() => monthOf(value));

  return (
    <BottomSheet visible title={t('agenda.picker.dayTitle')} onClose={onClose}>
      <View style={styles.quick}>
        <Chip accessibilityRole="radio" label={t('agenda.picker.today')} selected={value === today} onPress={() => onSelect(today)} />
        <Chip
          accessibilityRole="radio"
          label={t('agenda.picker.tomorrow')}
          selected={value === tomorrow}
          onPress={() => onSelect(tomorrow)}
        />
      </View>
      <ReminderMonth
        month={month}
        onChangeMonth={setMonth}
        today={today}
        markedDates={new Set()}
        selectedDate={value}
        onSelectDate={onSelect}
        minDate={allowPast ? undefined : today}
        minMonth={allowPast ? undefined : monthOf(today)}
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  quick: {
    flexDirection: 'row',
    gap: spacing['2'],
  },
});
