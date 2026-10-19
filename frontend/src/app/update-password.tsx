import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { TopBar } from '@/components/ui/top-bar';
import { useAuth } from '@/features/auth/auth-context';
import { authErrorField } from '@/features/auth/auth-error-field';
import { authErrorMessage, type AuthErrorCode } from '@/features/auth/auth-errors';
import { t } from '@/i18n';
import { spacing } from '@/theme/tokens';

/**
 * Nueva contraseña (tablero 1.9). Solo accesible con una sesión de recuperación (ver protección en el
 * layout raíz). Salir de aquí («atrás» de la barra) cancela y cierra la sesión, como antes.
 */
export default function UpdatePasswordScreen() {
  const { updatePassword, signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<AuthErrorCode | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (password === '') {
      setError('missing_fields');
      return;
    }

    setError(null);
    setIsSubmitting(true);
    // Si va bien, termina la recuperación y la protección de rutas lleva a (app).
    const result = await updatePassword(password);
    setIsSubmitting(false);
    setError(result.error);
  };

  const passwordError = error && authErrorField(error) === 'password' ? authErrorMessage(error) : null;

  return (
    <Screen
      align="top"
      footer={
        <>
          <FormMessage message={error && !passwordError ? authErrorMessage(error) : null} />
          <Button
            label={t('auth.updatePassword.submit')}
            loading={isSubmitting}
            loadingLabel={t('auth.updatePassword.saving')}
            onPress={handleSubmit}
          />
        </>
      }>
      <TopBar onBack={isSubmitting ? undefined : signOut} backLabel={t('auth.updatePassword.cancel')} />

      <View style={styles.heading}>
        <Text variant="title1" accessibilityRole="header">
          {t('auth.updatePassword.title')}
        </Text>
        <Text color="inkMuted">{t('auth.updatePassword.description')}</Text>
      </View>

      <TextField
        label={t('auth.fields.newPassword')}
        value={password}
        onChangeText={setPassword}
        error={passwordError}
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
});
