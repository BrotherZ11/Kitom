import { Stack } from 'expo-router';

import { t } from '@/i18n';
import { useStackScreenOptions } from '@/theme/theme-provider';

/**
 * Pantallas de acceso. Sin cabecera de navegación: cada una lleva la barra del diseño (`TopBar`); el
 * `title` se mantiene para el título de la ventana en web y la accesibilidad.
 */
export default function AuthLayout() {
  return (
    <Stack screenOptions={{ ...useStackScreenOptions(), headerShown: false }}>
      <Stack.Screen name="login" options={{ title: t('auth.login.title') }} />
      <Stack.Screen name="register" options={{ title: t('auth.register.title') }} />
      <Stack.Screen name="forgot-password" options={{ title: t('auth.forgotPassword.title') }} />
      <Stack.Screen name="auth-callback" options={{ title: t('auth.callback.processing') }} />
    </Stack>
  );
}
