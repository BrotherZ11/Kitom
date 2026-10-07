import { ActivityIndicator, Pressable, StyleSheet, type PressableProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type ButtonProps = Omit<PressableProps, 'children'> & {
  label: string;
  variant?: 'primary' | 'secondary' | 'link';
  loading?: boolean;
};

export function Button({ label, variant = 'primary', loading = false, disabled, ...rest }: ButtonProps) {
  const theme = useTheme();
  const isDisabled = disabled || loading;
  const isPrimary = variant === 'primary';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        isPrimary && [styles.boxed, { backgroundColor: theme.tint }],
        variant === 'secondary' && [styles.boxed, styles.outlined, { borderColor: theme.border }],
        (pressed || isDisabled) && styles.dimmed,
      ]}
      {...rest}>
      {loading ? (
        <ActivityIndicator color={isPrimary ? theme.onTint : theme.tint} />
      ) : (
        <ThemedText
          type={variant === 'link' ? 'small' : 'smallBold'}
          style={{
            color: isPrimary ? theme.onTint : variant === 'secondary' ? theme.text : theme.tint,
          }}>
          {label}
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
  boxed: {
    borderRadius: Spacing.two,
  },
  outlined: {
    borderWidth: 1,
  },
  dimmed: {
    opacity: 0.6,
  },
});
