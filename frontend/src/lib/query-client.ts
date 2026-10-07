import { focusManager, QueryClient } from '@tanstack/react-query';
import { AppState, Platform } from 'react-native';

/**
 * QueryClient único (estado servidor/caché). La sesión NO vive aquí: la gestiona AuthProvider.
 * AuthProvider vacía esta caché al cerrar sesión o cambiar de usuario.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
    mutations: {
      retry: 0,
    },
  },
});

// En móvil no hay eventos de foco de ventana: se usa AppState para revalidar al volver a la app.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    focusManager.setFocused(state === 'active');
  });
}
