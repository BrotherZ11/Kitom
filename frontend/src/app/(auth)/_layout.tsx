import { Stack } from 'expo-router';

import { t } from '@/i18n';
import { useStackScreenOptions } from '@/theme/theme-provider';

/**
 * Sin sesión, la protección del layout raíz trae aquí y se empieza por la bienvenida (tablero 1.1).
 * `/login`, `/register` y `/forgot-password` siguen siendo accesibles directamente. `/auth-callback` no
 * está aquí sino en el layout raíz: los enlaces de recuperación también se abren con la sesión iniciada.
 */
export const unstable_settings = {
  initialRouteName: 'welcome',
};

/**
 * Pantallas de acceso. Sin cabecera de navegación: cada una lleva la barra del diseño (`TopBar`); el
 * `title` se mantiene para el título de la ventana en web y la accesibilidad.
 */
export default function AuthLayout() {
  return (
    <Stack screenOptions={{ ...useStackScreenOptions(), headerShown: false }}>
      <Stack.Screen name="welcome" options={{ title: 'Kitom' }} />
      <Stack.Screen name="onboarding" options={{ title: t('auth.howItWorks.overline') }} />
      <Stack.Screen name="login" options={{ title: t('auth.login.title') }} />
      <Stack.Screen name="register" options={{ title: t('auth.register.title') }} />
      <Stack.Screen name="forgot-password" options={{ title: t('auth.forgotPassword.title') }} />
    </Stack>
  );
}
