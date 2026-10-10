/**
 * Query keys de registros diarios. Todas cuelgan de `['daily-logs']`. No incluyen el usuario:
 * AuthProvider vacía la caché al cerrar sesión o cambiar de cuenta.
 */
export const dailyLogKeys = {
  all: ['daily-logs'] as const,
  details: () => [...dailyLogKeys.all, 'detail'] as const,
  /** Registro de una mascota en un día (`YYYY-MM-DD`); `null` si no existe. */
  detail: (petId: string, logDate: string) => [...dailyLogKeys.details(), petId, logDate] as const,
  /** Historial paginado de una mascota (`useInfiniteQuery`, cursor = `log_date`). */
  history: (petId: string) => [...dailyLogKeys.all, 'history', petId] as const,
};

/** Queries afectadas al guardar un registro: el de ese día y el historial de la mascota. */
export function dailyLogKeysAfterSave(log: { pet_id: string; log_date: string }) {
  return {
    detail: dailyLogKeys.detail(log.pet_id, log.log_date),
    history: dailyLogKeys.history(log.pet_id),
  };
}
