import { useState } from 'react';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { Screen } from '@/components/ui/screen';
import { useAuth } from '@/features/auth/auth-context';
import { authErrorMessage, type AuthErrorCode } from '@/features/auth/auth-errors';
import { t } from '@/i18n';

/** Pantalla temporal: confirma que la sesión está activa. Se sustituirá por la Home real. */
export default function HomeScreen() {
  const { user, signOut } = useAuth();
  const [error, setError] = useState<AuthErrorCode | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    // La sesión local se borra siempre; la protección de rutas lleva a (auth).
    const result = await signOut();
    setIsSigningOut(false);
    setError(result.error);
  };

  return (
    <Screen>
      <ThemedText type="subtitle">{t('home.title')}</ThemedText>
      <ThemedText themeColor="textSecondary">{t('home.signedInAs')}</ThemedText>
      <ThemedText type="smallBold">{user?.email}</ThemedText>
      <ThemedText themeColor="textSecondary">{t('home.placeholder')}</ThemedText>

      <FormMessage message={error ? authErrorMessage(error) : null} />

      <Button label={t('home.signOut')} loading={isSigningOut} onPress={handleSignOut} />
    </Screen>
  );
}
