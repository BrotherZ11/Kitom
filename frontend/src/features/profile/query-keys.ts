/**
 * Query keys del perfil propio. No incluyen el usuario: AuthProvider vacía la caché al cerrar sesión
 * o cambiar de cuenta.
 */
export const profileKeys = {
  all: ['profile'] as const,
  timeZone: () => [...profileKeys.all, 'timezone'] as const,
};
