import { useRouter } from 'expo-router';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { useAuth } from '@/features/auth/auth-context';
import { authErrorMessage, type AuthErrorCode } from '@/features/auth/auth-errors';
import { validateCredentials } from '@/features/auth/validation';
import { t } from '@/i18n';

export default function RegisterScreen() {
  const router = useRouter();
  const { signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<AuthErrorCode | null>(null);
  const [needsEmailConfirmation, setNeedsEmailConfirmation] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    const validationError = validateCredentials(email, password);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setIsSubmitting(true);
    // Si el proyecto no exige confirmar el email, llega sesión y la protección lleva a (app).
    const result = await signUp(email, password);
    setIsSubmitting(false);
    setError(result.error);
    setNeedsEmailConfirmation(result.needsEmailConfirmation);
  };

  return (
    <Screen>
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
      />
      <TextField
        label={t('auth.fields.password')}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        onSubmitEditing={handleSubmit}
      />

      <FormMessage message={error ? authErrorMessage(error) : null} />
      <FormMessage
        tone="success"
        message={needsEmailConfirmation ? t('auth.register.checkEmail') : null}
      />

      <Button label={t('auth.register.submit')} loading={isSubmitting} onPress={handleSubmit} />
      <Button
        variant="link"
        label={t('auth.register.goToLogin')}
        onPress={() => router.replace('/login')}
      />
    </Screen>
  );
}
