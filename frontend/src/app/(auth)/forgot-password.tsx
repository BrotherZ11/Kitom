import { useRouter } from 'expo-router';
import { useState } from 'react';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { useAuth } from '@/features/auth/auth-context';
import { authErrorMessage, type AuthErrorCode } from '@/features/auth/auth-errors';
import { validateEmail } from '@/features/auth/validation';
import { t } from '@/i18n';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<AuthErrorCode | null>(null);
  const [isSent, setIsSent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    const validationError = validateEmail(email);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setIsSubmitting(true);
    const result = await resetPassword(email);
    setIsSubmitting(false);
    setError(result.error);
    // Mensaje neutro: no se revela si el email tiene cuenta.
    setIsSent(result.error === null);
  };

  return (
    <Screen>
      <ThemedText themeColor="textSecondary">{t('auth.forgotPassword.description')}</ThemedText>

      <TextField
        label={t('auth.fields.email')}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        inputMode="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        onSubmitEditing={handleSubmit}
      />

      <FormMessage message={error ? authErrorMessage(error) : null} />
      <FormMessage tone="success" message={isSent ? t('auth.forgotPassword.sent') : null} />

      <Button
        label={t('auth.forgotPassword.submit')}
        loading={isSubmitting}
        onPress={handleSubmit}
      />
      <Button
        variant="link"
        label={t('auth.forgotPassword.backToLogin')}
        onPress={() => router.replace('/login')}
      />
    </Screen>
  );
}
