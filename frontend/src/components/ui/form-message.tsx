import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

type FormMessageProps = {
  message: string | null;
  tone?: 'error' | 'success';
};

/** Mensaje de resultado de un formulario; se anuncia a lectores de pantalla. */
export function FormMessage({ message, tone = 'error' }: FormMessageProps) {
  const theme = useTheme();
  if (!message) return null;

  return (
    <ThemedText
      type="small"
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{ color: tone === 'error' ? theme.danger : theme.success }}>
      {message}
    </ThemedText>
  );
}
