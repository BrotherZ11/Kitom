import { StyleSheet, View } from 'react-native';

import { Chip } from '@/components/ui/chip';
import { Text } from '@/components/ui/text';
import { DAILY_LOG_TAGS, type DailyLogTag } from '@/features/daily-logs/daily-log-form';
import { t } from '@/i18n';
import { spacing } from '@/theme/tokens';

type TagSelectorProps = {
  value: DailyLogTag[];
  onToggle: (tag: DailyLogTag) => void;
  disabled?: boolean;
};

/** Etiquetas del día (tablero 5.2): solo las del catálogo cerrado (`DAILY_LOG_TAGS`), selección múltiple. */
export function TagSelector({ value, onToggle, disabled = false }: TagSelectorProps) {
  const title = t('dailyLogs.editor.tagsTitle');

  return (
    <View style={styles.container}>
      <Text variant="title3" accessibilityRole="header">
        {title}
      </Text>
      <View style={styles.chips} accessibilityLabel={title}>
        {DAILY_LOG_TAGS.map((tag) => (
          <Chip
            key={tag}
            label={t(`dailyLogs.tags.${tag}`)}
            selected={value.includes(tag)}
            disabled={disabled}
            onPress={() => onToggle(tag)}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing['2'],
  },
});
