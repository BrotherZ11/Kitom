import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FormMessage } from '@/components/ui/form-message';
import { Mail } from '@/components/ui/icons';
import { EmptyState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { useToast } from '@/components/ui/toast';
import { TopBar } from '@/components/ui/top-bar';
import { useAuth } from '@/features/auth/auth-context';
import { authErrorField, type AuthField } from '@/features/auth/auth-error-field';
import { authErrorMessage, type AuthErrorCode } from '@/features/auth/auth-errors';
import { accountHasPassword, type ChangePasswordResult } from '@/features/auth/change-password';
import { ResendButton } from '@/features/auth/components/resend-button';
import { validatePasswordChange } from '@/features/auth/validation';
import { t, tf } from '@/i18n';
import { createSubmitGuard } from '@/lib/submit-guard';
import { spacing } from '@/theme/tokens';

/**
 * Cambiar contraseña (tablero 10.3, SEC-17). Con contraseña: la actual (se comprueba antes de cambiar
 * nada, `features/auth/change-password.ts`), la nueva con la regla de longitud visible y su repetición;
 * si Supabase pide reautenticación, un código enviado por email. Cuenta solo con Google (sin identidad
 * `email`): «Crear contraseña» con el enlace de recuperación, que abre `/update-password`.
 */
export default function ChangePasswordScreen() {
  const { user } = useAuth();
  return accountHasPassword(user?.identities) ? <ChangePasswordForm /> : <CreatePasswordByEmail />;
}

function useBack() {
  const router = useRouter();
  return () => (router.canGoBack() ? router.back() : router.replace('/settings/security'));
}

function ChangePasswordForm() {
  const toast = useToast();
  const back = useBack();
  const { user, changePassword, requestPasswordChangeCode, canUseServer } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [code, setCode] = useState('');
  /** Instante en que se envió el código de verificación (`null`: no se ha pedido). */
  const [codeSentAt, setCodeSentAt] = useState<number | null>(null);
  const [error, setError] = useState<AuthErrorCode | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [guard] = useState(createSubmitGuard);

  const finish = (result: ChangePasswordResult) => {
    if (result.status === 'needs_code') {
      setCodeSentAt(Date.now());
      return;
    }
    if (result.status === 'error') {
      setError(result.error);
      return;
    }
    toast({ message: t('settings.password.saved') });
    back();
  };

  const submit = () => {
    void guard.run(async () => {
      setError(null);
      const validationError =
        codeSentAt === null
          ? validatePasswordChange({ currentPassword, password, confirmation: repeat })
          : code.trim() === ''
            ? 'missing_fields'
            : null;
      if (validationError) {
        setError(validationError);
        return;
      }
      if (!canUseServer) {
        setError('network');
        return;
      }
      setSubmitting(true);
      const result = await changePassword({
        currentPassword,
        newPassword: password,
        ...(codeSentAt === null ? {} : { nonce: code }),
      });
      setSubmitting(false);
      finish(result);
    });
  };

  const field = error ? authErrorField(error) : null;
  const fieldError = (name: AuthField) => (error && field === name ? authErrorMessage(error) : null);
  const shownFields: AuthField[] = codeSentAt === null ? ['currentPassword', 'password', 'confirmPassword'] : ['code'];
  const formError = error && (field === null || !shownFields.includes(field)) ? authErrorMessage(error) : null;
  const clearError = () => setError(null);

  return (
    <Screen
      align="top"
      footer={
        <>
          <FormMessage message={formError} />
          <Button
            label={codeSentAt === null ? t('settings.password.save') : t('settings.password.confirm')}
            loading={submitting}
            loadingLabel={t('settings.password.saving')}
            onPress={submit}
          />
        </>
      }>
      <TopBar onBack={submitting ? undefined : back} title={t('settings.password.title')} />
      {codeSentAt === null ? (
        <>
          <Text color="inkMuted">{t('settings.password.text')}</Text>
          <TextField
            label={t('settings.password.current')}
            value={currentPassword}
            onChangeText={(value) => {
              setCurrentPassword(value);
              clearError();
            }}
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
            autoCapitalize="none"
            error={fieldError('currentPassword')}
          />
          <TextField
            label={t('settings.password.new')}
            value={password}
            onChangeText={(value) => {
              setPassword(value);
              clearError();
            }}
            hint={t('auth.passwordRule')}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            autoCapitalize="none"
            error={fieldError('password')}
          />
          <TextField
            label={t('settings.password.repeat')}
            value={repeat}
            onChangeText={(value) => {
              setRepeat(value);
              clearError();
            }}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            autoCapitalize="none"
            returnKeyType="done"
            onSubmitEditing={submit}
            error={fieldError('confirmPassword')}
          />
        </>
      ) : (
        <>
          <Text variant="bodyStrong" accessibilityRole="header">
            {t('settings.password.codeTitle')}
          </Text>
          <Text color="inkMuted">{tf('settings.password.codeText', { email: user?.email ?? '' })}</Text>
          <TextField
            label={t('settings.password.code')}
            value={code}
            onChangeText={(value) => {
              setCode(value);
              clearError();
            }}
            inputMode="numeric"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={submit}
            error={fieldError('code')}
          />
          <ResendButton
            sentAt={codeSentAt}
            onResend={async () => {
              const result = await requestPasswordChangeCode();
              return result.status === 'error' ? result.error : null;
            }}
            label={t('settings.password.resendCode')}
            loadingLabel={t('auth.resend.sending')}
            waitLabel={(seconds) => tf('settings.password.resendCodeWait', { seconds })}
            sentMessage={t('settings.password.codeSent')}
          />
        </>
      )}
    </Screen>
  );
}

/** Cuenta solo con Google: la contraseña se crea con el enlace de recuperación (vuelve a `/update-password`). */
function CreatePasswordByEmail() {
  const back = useBack();
  const { user, resetPassword, canUseServer } = useAuth();
  const email = user?.email ?? '';
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [error, setError] = useState<AuthErrorCode | null>(null);
  const [sending, setSending] = useState(false);
  const [guard] = useState(createSubmitGuard);

  const send = () => {
    void guard.run(async () => {
      setError(null);
      if (!canUseServer) {
        setError('network');
        return;
      }
      setSending(true);
      const result = await resetPassword(email);
      setSending(false);
      if (result.error) setError(result.error);
      else setSentAt(Date.now());
    });
  };

  if (sentAt !== null) {
    return (
      <Screen align="top">
        <TopBar onBack={back} title={t('settings.password.createTitle')} />
        <EmptyState
          prominent
          icon={Mail}
          title={t('settings.password.createSentTitle')}
          description={t('settings.password.createSent')}
        />
        <Card variant="flat" style={styles.card}>
          <ResendButton
            sentAt={sentAt}
            onResend={async () => (await resetPassword(email)).error}
            label={t('auth.resend.action')}
            loadingLabel={t('auth.resend.sending')}
            waitLabel={(seconds) => tf('auth.resend.wait', { seconds })}
            sentMessage={t('auth.resend.sent')}
          />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen
      align="top"
      footer={
        <>
          <FormMessage message={error ? authErrorMessage(error) : null} />
          <Button
            label={t('settings.password.createSend')}
            loading={sending}
            loadingLabel={t('settings.password.createSending')}
            disabled={email === ''}
            onPress={send}
          />
        </>
      }>
      <TopBar onBack={sending ? undefined : back} title={t('settings.password.createTitle')} />
      <Text color="inkMuted">{tf('settings.password.createText', { email })}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing['2'],
  },
});
