import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FormMessage } from '@/components/ui/form-message';
import { Mail } from '@/components/ui/icons';
import { EmptyState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { TopBar } from '@/components/ui/top-bar';
import { useAuth } from '@/features/auth/auth-context';
import { authErrorField } from '@/features/auth/auth-error-field';
import { authErrorMessage, type AuthErrorCode } from '@/features/auth/auth-errors';
import { AuthDivider } from '@/features/auth/components/auth-divider';
import { GoogleLogo } from '@/features/auth/components/google-logo';
import { validateCredentials } from '@/features/auth/validation';
import { t } from '@/i18n';
import { fontFamily, spacing } from '@/theme/tokens';

/** Crear cuenta (tablero 1.3) y, si hay que confirmar el email, «Revisa tu correo» (tablero 1.4). */
export default function RegisterScreen() {
  const router = useRouter();
  const { signUp, signInWithGoogle } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<AuthErrorCode | null>(null);
  const [needsEmailConfirmation, setNeedsEmailConfirmation] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);

  // Con Google no hay registro aparte: la primera vez crea la cuenta.
  const handleGoogle = async () => {
    setError(null);
    setNeedsEmailConfirmation(false);
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
    // Si el proyecto no exige confirmar el email, llega sesión y la protección lleva a (app).
    const result = await signUp(email, password);
    setIsSubmitting(false);
    setError(result.error);
    setNeedsEmailConfirmation(result.needsEmailConfirmation);
  };

  const goToLogin = () => router.replace('/login');
  const back = router.canGoBack() ? () => router.back() : undefined;

  if (needsEmailConfirmation) {
    // Tablero 1.4: sin barra superior, bloque arriba (no centrado) y 24 hasta la tarjeta.
    return (
      <Screen
        align="top"
        gap={spacing['6']}
        footer={
          <>
            <Button label={t('auth.callback.goToLogin')} onPress={goToLogin} />
            <Button
              variant="ghost"
              size="md"
              label={t('auth.verifyEmail.changeEmail')}
              onPress={() => setNeedsEmailConfirmation(false)}
            />
          </>
        }>
        <EmptyState
          prominent
          icon={Mail}
          style={styles.verifyOffset}
          title={t('auth.verifyEmail.title')}
          description={
            <>
              {`${t('auth.verifyEmail.sentTo')} `}
              <Text variant="bodyLg" style={styles.strong}>
                {email.trim()}
              </Text>
              {`. ${t('auth.verifyEmail.openOnDevice')}`}
            </>
          }
        />
        <Card variant="flat" style={styles.hint}>
          <Text variant="bodyStrong">{t('auth.verifyEmail.notArrivingTitle')}</Text>
          <Text variant="caption" color="inkMuted">
            {t('auth.verifyEmail.notArrivingHint')}
          </Text>
        </Card>
      </Screen>
    );
  }

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
            label={t('auth.register.submit')}
            loading={isSubmitting}
            loadingLabel={t('auth.register.submitting')}
            disabled={isGoogleSubmitting}
            onPress={handleSubmit}
          />
          <Button variant="ghost" size="md" label={t('auth.register.goToLogin')} onPress={goToLogin} />
        </>
      }>
      <TopBar onBack={back} backLabel={t('auth.back')} />

      <View style={styles.heading}>
        <Text variant="title1" accessibilityRole="header">
          {t('auth.register.title')}
        </Text>
        <Text color="inkMuted">{t('auth.register.description')}</Text>
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
        autoComplete="new-password"
        textContentType="newPassword"
        onSubmitEditing={handleSubmit}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: {
    gap: spacing['2'],
  },
  strong: {
    fontFamily: fontFamily.sans600,
  },
  hint: {
    gap: 6,
  },
  // El bloque del tablero 1.4 empieza a 120 del borde: 44 de barra de estado + 14 de `Screen` + 74
  // (incluye los 12 de relleno de `.empty`).
  verifyOffset: {
    paddingTop: 74,
  },
});
