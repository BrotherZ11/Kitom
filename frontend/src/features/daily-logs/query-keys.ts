/**
 * Query keys de registros diarios. Todas cuelgan de `['daily-logs']`. No incluyen el usuario:
 * AuthProvider vacía la caché al cerrar sesión o cambiar de cuenta.
 */
export const dailyLogKeys = {
  all: ['daily-logs'] as const,
  details: () => [...dailyLogKeys.all, 'detail'] as const,
  /** Registro de una mascota en un día (`YYYY-MM-DD`); `null` si no existe. */
  detail: (petId: string, logDate: string) => [...dailyLogKeys.details(), petId, logDate] as const,
};
