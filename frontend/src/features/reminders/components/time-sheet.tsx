import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { IconButton } from '@/components/ui/icon-button';
import { Minus, Plus } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { formatTimeOfDay, type TimeOfDay } from '@/features/notifications/notification-plan';
import { useTheme } from '@/hooks/use-theme';
import { t, tf } from '@/i18n';
import { radius, spacing } from '@/theme/tokens';

const MINUTE_STEP = 5;
const PRESETS: TimeOfDay[] = [
  { hour: 9, minute: 0 },
  { hour: 14, minute: 0 },
  { hour: 20, minute: 0 },
];

type TimeSheetProps = {
  visible: boolean;
  title: string;
  value: TimeOfDay;
  onClose: () => void;
  onConfirm: (value: TimeOfDay) => void;
};

/**
 * Elegir una hora (24 h): horas y minutos con «más» y «menos» (los minutos de 5 en 5) y tres horas
 * habituales. Sin dependencias nativas: funciona igual en Android, iOS y web.
 */
export function TimeSheet({ visible, title, value, onClose, onConfirm }: TimeSheetProps) {
  return visible ? <TimeSheetContent title={title} value={value} onClose={onClose} onConfirm={onConfirm} /> : null;
}

function TimeSheetContent({ title, value, onClose, onConfirm }: Omit<TimeSheetProps, 'visible'>) {
  // Se monta al abrir: empieza siempre en el valor actual.
  const [draft, setDraft] = useState(value);
  const shift = (unit: 'hour' | 'minute', delta: number) =>
    setDraft((current) =>
      unit === 'hour'
        ? { ...current, hour: (current.hour + delta + 24) % 24 }
        : { ...current, minute: (Math.round(current.minute / MINUTE_STEP) * MINUTE_STEP + delta * MINUTE_STEP + 60) % 60 }
    );

  return (
    <BottomSheet
      visible
      title={title}
      onClose={onClose}
      footer={<Button label={t('agenda.picker.done')} onPress={() => onConfirm(draft)} />}>
      <View style={styles.steppers}>
        <Stepper
          label={t('agenda.picker.hours')}
          value={String(draft.hour).padStart(2, '0')}
          onMore={() => shift('hour', 1)}
          onLess={() => shift('hour', -1)}
        />
        <Text variant="dataLg" accessibilityElementsHidden importantForAccessibility="no">
          :
        </Text>
        <Stepper
          label={t('agenda.picker.minutes')}
          value={String(draft.minute).padStart(2, '0')}
          onMore={() => shift('minute', 1)}
          onLess={() => shift('minute', -1)}
        />
      </View>
      <View style={styles.presets}>
        {PRESETS.map((preset) => (
          <Chip
            key={formatTimeOfDay(preset)}
            accessibilityRole="radio"
            label={formatTimeOfDay(preset)}
            selected={preset.hour === draft.hour && preset.minute === draft.minute}
            onPress={() => setDraft(preset)}
          />
        ))}
      </View>
    </BottomSheet>
  );
}

function Stepper({ label, value, onMore, onLess }: { label: string; value: string; onMore: () => void; onLess: () => void }) {
  const theme = useTheme();
  const unit = label.toLowerCase();
  return (
    <View style={styles.stepper}>
      <IconButton icon={Plus} variant="soft" accessibilityLabel={tf('agenda.picker.more', { unit })} onPress={onMore} />
      <View
        style={[styles.value, { backgroundColor: theme.surfaceSunken }]}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={`${label}: ${value}`}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) => (event.nativeEvent.actionName === 'increment' ? onMore() : onLess())}>
        <Text variant="dataLg">{value}</Text>
      </View>
      <IconButton icon={Minus} variant="soft" accessibilityLabel={tf('agenda.picker.less', { unit })} onPress={onLess} />
      <Text variant="caption" color="inkMuted">
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  steppers: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing['4'],
    paddingVertical: spacing['2'],
  },
  stepper: {
    alignItems: 'center',
    gap: spacing['2'],
  },
  value: {
    minWidth: 88,
    paddingVertical: spacing['3'],
    borderRadius: radius.md,
    alignItems: 'center',
  },
  presets: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing['2'],
  },
});
