import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ToastProvider } from '@/components/ui/toast';
import { AuthProvider, useAuth } from '@/features/auth/auth-context';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';
import { queryClient } from '@/lib/query-client';
import { brandFonts } from '@/theme/fonts';
import { AppThemeProvider } from '@/theme/theme-provider';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppThemeProvider>
          <ToastProvider>
            <RootNavigator />
          </ToastProvider>
        </AppThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

/**
 * Único punto de protección de rutas. Mientras Supabase resuelve la sesión no se monta el
 * navegador: así no se muestra login por error ni se redirige antes de tiempo (y un deep link
 * inicial se evalúa ya con la sesión correcta). En móvil el splash nativo sigue visible.
 */
function RootNavigator() {
  const theme = useTheme();
  const { user, isLoading, isRecoveringPassword } = useAuth();
  // Si las fuentes de marca no cargan, la app sigue con las del sistema (no se bloquea el arranque).
  const [fontsLoaded, fontsError] = useFonts(brandFonts);
  const isReady = !isLoading && (fontsLoaded || fontsError !== null);
  // Con sesión utilizable o, sin conexión, con la sesión guardada de un usuario identificado
  // (`status: 'offline'`): en ese caso solo se ven sus datos locales y no se envía nada.
  const isSignedIn = user !== null;

  useEffect(() => {
    if (isReady) SplashScreen.hideAsync();
  }, [isReady]);

  if (!isReady) {
    return (
      <View
        style={[styles.loading, { backgroundColor: theme.bg }]}
        accessibilityLabel={t('common.loading')}>
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  }

  return (
    // Si un guard deja de cumplirse, Expo Router redirige a la primera pantalla disponible en este
    // orden: (app) → update-password (sesión de recuperación) → (auth) (incluye /auth-callback).
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={isSignedIn && !isRecoveringPassword}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={isSignedIn && isRecoveringPassword}>
        <Stack.Screen name="update-password" />
      </Stack.Protected>
      <Stack.Protected guard={!isSignedIn}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      {/* Galería del sistema de diseño: solo en desarrollo, con o sin sesión. */}
      <Stack.Protected guard={__DEV__}>
        <Stack.Screen name="dev-components" options={{ headerShown: true }} />
      </Stack.Protected>
    </Stack>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
