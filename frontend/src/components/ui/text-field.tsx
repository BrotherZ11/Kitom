import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type TextFieldProps = TextInputProps & {
  label: string;
  /** Texto de ayuda bajo el campo. */
  hint?: string;
  /** Error de validación; sustituye a la ayuda y marca el campo. */
  error?: string | null;
};

export function TextField({ label, hint, error, style, multiline, ...inputProps }: TextFieldProps) {
  const theme = useTheme();
  const helper = error ?? hint;

  return (
    <View style={styles.container}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={helper ?? undefined}
        placeholderTextColor={theme.textSecondary}
        multiline={multiline}
        style={[
          styles.input,
          multiline && styles.multiline,
          {
            color: theme.text,
            backgroundColor: theme.backgroundElement,
            borderColor: error ? theme.danger : theme.border,
          },
          style,
        ]}
        {...inputProps}
      />
      {helper ? (
        <ThemedText
          type="small"
          style={{ color: error ? theme.danger : theme.textSecondary }}
          accessibilityLiveRegion={error ? 'polite' : 'none'}>
          {helper}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.one,
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
  multiline: {
    minHeight: 96,
    paddingVertical: Spacing.two,
    textAlignVertical: 'top',
  },
});
