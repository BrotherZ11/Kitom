import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { useAuth } from '@/features/auth/auth-context';
import { authErrorField } from '@/features/auth/auth-error-field';
import { authErrorMessage, type AuthErrorCode } from '@/features/auth/auth-errors';
import { AuthDivider } from '@/features/auth/components/auth-divider';
import { GoogleLogo } from '@/features/auth/components/google-logo';
import { validateCredentials } from '@/features/auth/validation';
import { t } from '@/i18n';
import { spacing } from '@/theme/tokens';

/** Iniciar sesión (tablero 1.5): Google o email y contraseña. */
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

  // El error va en su campo cuando es de un campo; si no, en la alerta sobre el botón.
  const errorField = error ? authErrorField(error) : null;
  const fieldError = (field: 'email' | 'password') =>
    error && errorField === field ? authErrorMessage(error) : null;

  return (
    <Screen
      align="top"
      footer={
        <>
          <FormMessage message={error && errorField === null ? authErrorMessage(error) : null} />
          <Button
            label={t('auth.login.submit')}
            loading={isSubmitting}
            loadingLabel={t('auth.login.submitting')}
            disabled={isGoogleSubmitting}
            onPress={handleSubmit}
          />
          <Button
            variant="ghost"
            size="md"
            label={t('auth.login.goToRegister')}
            onPress={() => router.push('/register')}
          />
        </>
      }>
      <View style={styles.heading}>
        <Text variant="title1" accessibilityRole="header">
          {t('auth.login.title')}
        </Text>
        <Text color="inkMuted">{t('auth.login.description')}</Text>
      </View>

      <Button
        variant="secondary"
        label={t('auth.google.continue')}
        leading={<GoogleLogo />}
        loading={isGoogleSubmitting}
        loadingLabel={t('auth.google.connecting')}
        disabled={isSubmitting}
        onPress={handleGoogle}
      />

      <AuthDivider label={t('auth.emailDivider')} />

      <TextField
        label={t('auth.fields.email')}
        value={email}
        onChangeText={setEmail}
        error={fieldError('email')}
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
        error={fieldError('password')}
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
        onSubmitEditing={handleSubmit}
      />

      <Button
        variant="ghost"
        size="sm"
        label={t('auth.login.goToForgotPassword')}
        onPress={() => router.push('/forgot-password')}
        style={styles.inlineLink}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: {
    gap: spacing['2'],
  },
  inlineLink: {
    // Enlace alineado con el texto (el botón `sm` tiene 14 de relleno lateral).
    marginLeft: -14,
  },
});
