/**
 * Query keys de la agenda. Llevan el usuario (como Pets y Daily Logs): una respuesta tardía de otra
 * sesión nunca cae en las de la cuenta activa (además, AuthProvider vacía la caché al cambiar).
 */
export const reminderKeys = {
  all: ['reminders'] as const,
  user: (userId: string) => [...reminderKeys.all, userId] as const,
  pet: (userId: string, petId: string) => [...reminderKeys.user(userId), 'pet', petId] as const,
  detail: (userId: string, reminderId: string) => [...reminderKeys.user(userId), 'detail', reminderId] as const,
  /** Pendientes de todas las mascotas, vencidos incluidos (listado general). */
  pending: (userId: string) => [...reminderKeys.user(userId), 'pending'] as const,
  /** Pendientes que aún tienen que sonar (avisos del dispositivo). */
  upcoming: (userId: string) => [...reminderKeys.user(userId), 'upcoming'] as const,
  /** Operaciones guardadas en el dispositivo (lectura local). */
  operations: (userId: string) => [...reminderKeys.user(userId), 'operations'] as const,
  /** Copia del dispositivo (lecturas locales). */
  local: (userId: string) => [...reminderKeys.user(userId), 'local'] as const,
  localScope: (userId: string, scope: string) => [...reminderKeys.local(userId), 'scope', scope] as const,
  localDetail: (userId: string, reminderId: string) => [...reminderKeys.local(userId), 'detail', reminderId] as const,
  localPermission: (userId: string, petId: string) => [...reminderKeys.local(userId), 'permission', petId] as const,
};
