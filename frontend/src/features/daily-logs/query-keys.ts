/**
 * Query keys de registros diarios. Todas cuelgan de `['daily-logs']`. Las del servidor no incluyen
 * el usuario: AuthProvider vacía la caché al cerrar sesión o cambiar de cuenta. Las locales sí (el
 * almacén del dispositivo es por usuario). La caché nunca se persiste: lo persistente es `LocalStore`.
 */
export const dailyLogKeys = {
  all: ['daily-logs'] as const,
  details: () => [...dailyLogKeys.all, 'detail'] as const,
  /** Registro de una mascota en un día (`YYYY-MM-DD`); `null` si no existe. */
  detail: (petId: string, logDate: string) => [...dailyLogKeys.details(), petId, logDate] as const,
  /** Historial paginado de una mascota (`useInfiniteQuery`, cursor = `log_date`). */
  history: (petId: string) => [...dailyLogKeys.all, 'history', petId] as const,
  /** Registro guardado en el dispositivo (`LocalDailyLog`) o `null`. */
  local: (userId: string, petId: string, logDate: string) =>
    [...dailyLogKeys.all, 'local', userId, petId, logDate] as const,
  /** Registros guardados en el dispositivo de una mascota. */
  localList: (userId: string, petId: string) => [...dailyLogKeys.all, 'local-list', userId, petId] as const,
  /** Registros del dispositivo con cambios sin confirmar (pendientes, fallidos o en conflicto). */
  unsynced: (userId: string) => [...dailyLogKeys.all, 'local-unsynced', userId] as const,
};

/** Queries afectadas al guardar un registro: el de ese día y el historial de la mascota. */
export function dailyLogKeysAfterSave(log: { pet_id: string; log_date: string }) {
  return {
    detail: dailyLogKeys.detail(log.pet_id, log.log_date),
    history: dailyLogKeys.history(log.pet_id),
  };
}
