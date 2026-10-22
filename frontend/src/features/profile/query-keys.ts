/**
 * Query keys del perfil propio. No incluyen el usuario: AuthProvider vacía la caché al cerrar sesión
 * o cambiar de cuenta.
 */
export const profileKeys = {
  all: ['profile'] as const,
  timeZone: () => [...profileKeys.all, 'timezone'] as const,
  name: () => [...profileKeys.all, 'name'] as const,
  /** Perfil completo (configuración inicial, aviso, consentimientos). */
  detail: () => [...profileKeys.all, 'detail'] as const,
  notificationPreferences: () => [...profileKeys.all, 'notification-preferences'] as const,
  subscription: () => [...profileKeys.all, 'subscription'] as const,
  /** Marca del dispositivo «configuración inicial terminada» (por usuario). */
  onboardingLocal: (userId: string) => [...profileKeys.all, 'onboarding-local', userId] as const,
};
