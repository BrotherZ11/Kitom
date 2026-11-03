import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { authErrorMessage, type AuthErrorCode } from '@/features/auth/auth-errors';
import { useResendCooldown } from '@/features/auth/use-resend-cooldown';
import { createSubmitGuard } from '@/lib/submit-guard';
import { spacing } from '@/theme/tokens';

type ResendButtonProps = {
  /** Envía de nuevo; `null` = enviado. */
  onResend: () => Promise<AuthErrorCode | null>;
  label: string;
  loadingLabel: string;
  /** Texto mientras dura la espera (segundos que faltan). */
  waitLabel: (seconds: number) => string;
  sentMessage: string;
  /** Instante del último envío (la espera empieza ya al montar), p. ej. el registro que acaba de enviarlo. */
  sentAt?: number | null;
};

/**
 * Reenviar un email de Auth con una espera visible entre envíos (`resend-cooldown.ts`) y el resultado
 * debajo. Un `rate_limited` del servidor también reinicia la espera.
 */
export function ResendButton({ onResend, label, loadingLabel, waitLabel, sentMessage, sentAt = null }: ResendButtonProps) {
  const { remaining, start } = useResendCooldown(sentAt);
  const [guard] = useState(createSubmitGuard);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);

  const resend = () => {
    if (remaining > 0) return;
    void guard.run(async () => {
      setFeedback(null);
      setSending(true);
      const error = await onResend();
      setSending(false);
      if (error === null || error === 'rate_limited') start();
      setFeedback(error === null ? { tone: 'success', message: sentMessage } : { tone: 'error', message: authErrorMessage(error) });
    });
  };

  return (
    <View style={styles.block}>
      <FormMessage tone={feedback?.tone} message={feedback?.message ?? null} />
      <Button
        variant="ghost"
        size="md"
        label={remaining > 0 ? waitLabel(remaining) : label}
        loading={sending}
        loadingLabel={loadingLabel}
        disabled={remaining > 0}
        onPress={resend}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: spacing['2'],
  },
});
