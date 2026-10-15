import { focusManager, onlineManager, QueryClient } from '@tanstack/react-query';
import * as Network from 'expo-network';
import { AppState, Platform } from 'react-native';

import { createConnectivityListener } from '@/lib/connectivity';
import { queryDefaultOptions } from '@/lib/query-defaults';

/**
 * QueryClient único (estado servidor/caché). La sesión NO vive aquí: la gestiona AuthProvider.
 * AuthProvider vacía esta caché al cerrar sesión o cambiar de usuario.
 */
export const queryClient = new QueryClient({
  defaultOptions: queryDefaultOptions(Platform.OS === 'web' ? 'web' : 'native'),
});

// En móvil no hay eventos de foco de ventana: se usa AppState para revalidar al volver a la app.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    focusManager.setFocused(state === 'active');
  });
}

// Conectividad: `expo-network` en móvil y web (en web, `navigator.onLine` y sus eventos). TanStack
// Query llama a la limpieza al sustituir el listener o quedarse sin suscriptores. Durante el
// renderizado estático de web no hay `window` ni red que observar.
if (typeof window !== 'undefined') {
  onlineManager.setEventListener(
    createConnectivityListener({
      getState: Network.getNetworkStateAsync,
      addListener: Network.addNetworkStateListener,
    })
  );
}
