import { useRouter } from 'expo-router';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { useToast } from '@/components/ui/toast';
import { TopBar } from '@/components/ui/top-bar';
import { useAuth } from '@/features/auth/auth-context';
import { authErrorField } from '@/features/auth/auth-error-field';
import { authErrorMessage, type AuthErrorCode } from '@/features/auth/auth-errors';
import { t } from '@/i18n';
import { createSubmitGuard } from '@/lib/submit-guard';

/**
 * Cambiar contraseña (tablero 10.3) con la sesión normal (`updateUser`). La longitud mínima y la
 * fortaleza las decide Supabase Auth (el error llega mapeado); aquí solo se comprueba que las dos
 * coinciden.
 */
export default function ChangePasswordScreen() {
  const router = useRouter();
  const toast = useToast();
  const { updatePassword, canUseServer } = useAuth();
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [mismatch, setMismatch] = useState(false);
  const [error, setError] = useState<AuthErrorCode | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [guard] = useState(createSubmitGuard);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/settings/security'));

  const submit = () => {
    void guard.run(async () => {
      setError(null);
      setMismatch(false);
      if (password === '' || repeat === '') {
        setError('missing_fields');
        return;
      }
      if (password !== repeat) {
        setMismatch(true);
        return;
      }
      if (!canUseServer) {
        setError('network');
        return;
      }
      setSubmitting(true);
      const result = await updatePassword(password);
      setSubmitting(false);
      if (result.error) {
        setError(result.error);
        return;
      }
      toast({ message: t('settings.password.saved') });
      back();
    });
  };

  const fieldError = error && authErrorField(error) === 'password' ? authErrorMessage(error) : null;

  return (
    <Screen
      align="top"
      footer={
        <>
          <FormMessage message={error && !fieldError ? authErrorMessage(error) : null} />
          <Button
            label={t('settings.password.save')}
            loading={submitting}
            loadingLabel={t('settings.password.saving')}
            onPress={submit}
          />
        </>
      }>
      <TopBar onBack={submitting ? undefined : back} title={t('settings.password.title')} />
      <Text color="inkMuted">{t('settings.password.text')}</Text>
      <TextField
        label={t('settings.password.new')}
        value={password}
        onChangeText={(value) => {
          setPassword(value);
          setError(null);
        }}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        autoCapitalize="none"
        error={fieldError}
      />
      <TextField
        label={t('settings.password.repeat')}
        value={repeat}
        onChangeText={(value) => {
          setRepeat(value);
          setMismatch(false);
        }}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        autoCapitalize="none"
        returnKeyType="done"
        onSubmitEditing={submit}
        error={mismatch ? t('settings.password.mismatch') : null}
      />
    </Screen>
  );
}
