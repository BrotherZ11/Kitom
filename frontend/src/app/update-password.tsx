import { useState } from 'react';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { useAuth } from '@/features/auth/auth-context';
import { authErrorMessage, type AuthErrorCode } from '@/features/auth/auth-errors';
import { t } from '@/i18n';

/** Solo accesible con una sesión de recuperación (ver protección en el layout raíz). */
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

  return (
    <Screen>
      <ThemedText type="subtitle">{t('auth.updatePassword.title')}</ThemedText>
      <ThemedText themeColor="textSecondary">{t('auth.updatePassword.description')}</ThemedText>

      <TextField
        label={t('auth.fields.newPassword')}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        onSubmitEditing={handleSubmit}
      />

      <FormMessage message={error ? authErrorMessage(error) : null} />

      <Button
        label={t('auth.updatePassword.submit')}
        loading={isSubmitting}
        onPress={handleSubmit}
      />
      <Button variant="link" label={t('auth.updatePassword.cancel')} onPress={signOut} />
    </Screen>
  );
}
