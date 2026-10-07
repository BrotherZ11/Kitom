import { useRouter } from 'expo-router';
import { useState } from 'react';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { useAuth } from '@/features/auth/auth-context';
import { authErrorMessage, type AuthErrorCode } from '@/features/auth/auth-errors';
import { validateCredentials } from '@/features/auth/validation';
import { t } from '@/i18n';

export default function LoginScreen() {
  const router = useRouter();
  const { signIn, signInWithGoogle } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<AuthErrorCode | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);

  const handleGoogle = async () => {
    setError(null);
    setIsGoogleSubmitting(true);
    const result = await signInWithGoogle();
    setIsGoogleSubmitting(false);
    setError(result.error);
  };

  const handleSubmit = async () => {
    const validationError = validateCredentials(email, password);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setIsSubmitting(true);
    // Si va bien, la protección de rutas lleva a (app) al recibir la nueva sesión.
    const result = await signIn(email, password);
    setIsSubmitting(false);
    setError(result.error);
  };

  return (
    <Screen>
      <ThemedText type="subtitle">{t('auth.login.title')}</ThemedText>

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
        autoComplete="current-password"
        textContentType="password"
        onSubmitEditing={handleSubmit}
      />

      <FormMessage message={error ? authErrorMessage(error) : null} />

      <Button
        label={t('auth.login.submit')}
        loading={isSubmitting}
        disabled={isGoogleSubmitting}
        onPress={handleSubmit}
      />
      <Button
        variant="secondary"
        label={t('auth.google.continue')}
        loading={isGoogleSubmitting}
        disabled={isSubmitting}
        onPress={handleGoogle}
      />
      <Button
        variant="link"
        label={t('auth.login.goToForgotPassword')}
        onPress={() => router.push('/forgot-password')}
      />
      <Button
        variant="link"
        label={t('auth.login.goToRegister')}
        onPress={() => router.push('/register')}
      />
    </Screen>
  );
}
