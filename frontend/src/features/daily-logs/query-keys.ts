/**
 * Query keys de registros diarios. Todas cuelgan de `['daily-logs']` y todas llevan el usuario: una
 * respuesta tardía de una sesión anterior nunca cae en las queries de la cuenta activa (además,
 * AuthProvider vacía la caché al cerrar sesión o cambiar de cuenta). La caché nunca se persiste: lo
 * persistente es `LocalStore`.
 */
export const dailyLogKeys = {
  all: ['daily-logs'] as const,
  details: () => [...dailyLogKeys.all, 'detail'] as const,
  /** Registro de una mascota en un día (`YYYY-MM-DD`) leído por `userId`; `null` si no existe. */
  detail: (userId: string, petId: string, logDate: string) =>
    [...dailyLogKeys.details(), userId, petId, logDate] as const,
  /** Historial paginado de una mascota leído por `userId` (`useInfiniteQuery`, cursor = `log_date`). */
  history: (userId: string, petId: string) => [...dailyLogKeys.all, 'history', userId, petId] as const,
  /** Registro guardado en el dispositivo (`LocalDailyLog`) o `null`. */
  local: (userId: string, petId: string, logDate: string) =>
    [...dailyLogKeys.all, 'local', userId, petId, logDate] as const,
  /** Registros guardados en el dispositivo de una mascota. */
  localList: (userId: string, petId: string) => [...dailyLogKeys.all, 'local-list', userId, petId] as const,
  /** Todos los registros del dispositivo del usuario (resumen por mascota sin conexión). */
  localAll: (userId: string) => [...dailyLogKeys.all, 'local-all', userId] as const,
  /** Registros del dispositivo con cambios sin confirmar (pendientes, fallidos o en conflicto). */
  unsynced: (userId: string) => [...dailyLogKeys.all, 'local-unsynced', userId] as const,
};

/** Queries afectadas al guardar un registro: el de ese día y el historial de la mascota. */
export function dailyLogKeysAfterSave(userId: string, log: { pet_id: string; log_date: string }) {
  return {
    detail: dailyLogKeys.detail(userId, log.pet_id, log.log_date),
    history: dailyLogKeys.history(userId, log.pet_id),
  };
}
