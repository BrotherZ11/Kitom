import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useTheme } from '@/hooks/use-theme';
import { borderWidth, spacing } from '@/theme/tokens';

/** Separador entre el acceso con Google y el formulario de email («o con tu email»). */
export function AuthDivider({ label }: { label: string }) {
  const theme = useTheme();
  const line = [styles.line, { backgroundColor: theme.line }];

  return (
    <View style={styles.row}>
      <View style={line} />
      <Text variant="caption" color="inkMuted">
        {label}
      </Text>
      <View style={line} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing['3'],
  },
  line: {
    flex: 1,
    height: borderWidth.hairline,
  },
});
