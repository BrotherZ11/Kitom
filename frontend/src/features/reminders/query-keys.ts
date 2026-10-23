/**
 * Query keys de la agenda. Llevan el usuario (como Pets y Daily Logs): una respuesta tardía de otra
 * sesión nunca cae en las de la cuenta activa (además, AuthProvider vacía la caché al cambiar).
 */
export const reminderKeys = {
  all: ['reminders'] as const,
  user: (userId: string) => [...reminderKeys.all, userId] as const,
  pet: (userId: string, petId: string) => [...reminderKeys.user(userId), 'pet', petId] as const,
  detail: (userId: string, reminderId: string) => [...reminderKeys.user(userId), 'detail', reminderId] as const,
  /** Pendientes de todas las mascotas (avisos del dispositivo). */
  pending: (userId: string) => [...reminderKeys.user(userId), 'pending'] as const,
};
