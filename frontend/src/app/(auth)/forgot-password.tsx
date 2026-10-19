import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
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
import { validateEmail } from '@/features/auth/validation';
import { t } from '@/i18n';
import { spacing } from '@/theme/tokens';

/** Recuperar contraseña (tablero 1.8): pedir el enlace y «Enlace enviado». */
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

  const goToLogin = () => router.replace('/login');
  const back = router.canGoBack() ? () => router.back() : goToLogin;

  if (isSent) {
    // Tablero 1.8 («Enlace enviado»): barra con «atrás» y el bloque arriba, no centrado.
    return (
      <Screen
        align="top"
        footer={<Button variant="ghost" size="md" label={t('auth.forgotPassword.backToLogin')} onPress={goToLogin} />}>
        <TopBar onBack={back} backLabel={t('auth.back')} />
        <EmptyState
          prominent
          icon={Mail}
          title={t('auth.forgotPassword.sentTitle')}
          description={t('auth.forgotPassword.sent')}
        />
      </Screen>
    );
  }

  const emailError = error && authErrorField(error) === 'email' ? authErrorMessage(error) : null;

  return (
    <Screen
      align="top"
      footer={
        <>
          <FormMessage message={error && !emailError ? authErrorMessage(error) : null} />
          <Button
            label={t('auth.forgotPassword.submit')}
            loading={isSubmitting}
            loadingLabel={t('auth.forgotPassword.submitting')}
            onPress={handleSubmit}
          />
        </>
      }>
      <TopBar onBack={back} backLabel={t('auth.back')} />

      <View style={styles.heading}>
        <Text variant="title1" accessibilityRole="header">
          {t('auth.forgotPassword.title')}
        </Text>
        <Text color="inkMuted">{t('auth.forgotPassword.description')}</Text>
      </View>

      <TextField
        label={t('auth.fields.email')}
        value={email}
        onChangeText={setEmail}
        error={emailError}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        inputMode="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        onSubmitEditing={handleSubmit}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: {
    gap: spacing['2'],
  },
});
