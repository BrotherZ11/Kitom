import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { DAILY_LOG_TAGS, type DailyLogTag } from '@/features/daily-logs/daily-log-form';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

type TagSelectorProps = {
  value: DailyLogTag[];
  onToggle: (tag: DailyLogTag) => void;
  disabled?: boolean;
};

/** Etiquetas del día: solo las del catálogo cerrado (`DAILY_LOG_TAGS`), selección múltiple. */
export function TagSelector({ value, onToggle, disabled = false }: TagSelectorProps) {
  const theme = useTheme();
  const title = t('dailyLogs.tags.title');

  return (
    <View style={styles.container}>
      <ThemedText type="smallBold">{title}</ThemedText>
      <View style={styles.options} accessibilityLabel={title}>
        {DAILY_LOG_TAGS.map((tag) => {
          const isSelected = value.includes(tag);
          return (
            <Pressable
              key={tag}
              accessibilityRole="checkbox"
              accessibilityLabel={t(`dailyLogs.tags.${tag}`)}
              accessibilityState={{ checked: isSelected, disabled }}
              disabled={disabled}
              onPress={() => onToggle(tag)}
              style={[
                styles.option,
                {
                  borderColor: isSelected ? theme.tint : theme.border,
                  backgroundColor: isSelected ? theme.backgroundSelected : theme.backgroundElement,
                },
                disabled && styles.disabled,
              ]}>
              <ThemedText type={isSelected ? 'smallBold' : 'small'}>
                {isSelected ? '✓ ' : ''}
                {t(`dailyLogs.tags.${tag}`)}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.one,
  },
  options: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  option: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.four,
  },
  disabled: {
    opacity: 0.6,
  },
});
