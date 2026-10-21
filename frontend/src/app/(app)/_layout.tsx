import { Stack } from 'expo-router';

import { SignOutFlowProvider } from '@/features/auth/sign-out-provider';
import { DailyLogSyncProvider } from '@/features/daily-logs/sync/daily-log-sync-provider';
import { ActivePetProvider } from '@/features/pets/active-pet-context';
import { PetSyncProvider } from '@/features/pets/sync/pet-sync-provider';
import { useProfileTimeZoneSync } from '@/features/profile/hooks/use-profile-timezone-sync';
import { useStackScreenOptions } from '@/theme/theme-provider';

/** Un enlace directo (p. ej. a `/pets/…`) deja las pestañas debajo: «atrás» vuelve a Hoy. */
export const unstable_settings = { initialRouteName: '(tabs)' };

/**
 * Zona con sesión. Las pantallas llevan su propia cabecera (`TopBar`, como en el diseño), así que la
 * del navegador está oculta. Las URL son las de siempre: las pestañas (`(tabs)`) no añaden segmento.
 */
export default function AppLayout() {
  // Solo se monta con sesión activa (Stack.Protected en el layout raíz).
  useProfileTimeZoneSync();
  const screenOptions = useStackScreenOptions();

  return (
    <DailyLogSyncProvider>
      <PetSyncProvider>
        <SignOutFlowProvider>
          <ActivePetProvider>
            <Stack screenOptions={{ ...screenOptions, headerShown: false }}>
              <Stack.Screen name="(tabs)" />
              {/* «Registrar» abre el registro a pantalla completa, desde abajo (PANTALLAS.md §1). */}
              <Stack.Screen
                name="pets/[id]/daily-log"
                options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
              />
            </Stack>
          </ActivePetProvider>
        </SignOutFlowProvider>
      </PetSyncProvider>
    </DailyLogSyncProvider>
  );
}
