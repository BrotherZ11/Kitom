import { createReminderCacheRepository, type ReminderCacheRepository } from '@/features/reminders/offline/reminder-cache-repository';
import { deviceStorage } from '@/lib/local-store/device-storage';
import { createLocalStore } from '@/lib/local-store/local-store';

/**
 * Copia de la agenda del dispositivo de cada usuario: una instancia por usuario y proceso (sus marcas de lectura
 * están en memoria). Cambiar de cuenta no borra nada: cada copia sigue aislada por su clave de usuario.
 */
const repositories = new Map<string, ReminderCacheRepository>();

export function reminderCacheFor(userId: string): ReminderCacheRepository {
  let repository = repositories.get(userId);
  if (!repository) {
    repository = createReminderCacheRepository(createLocalStore(deviceStorage, userId));
    repositories.set(userId, repository);
  }
  return repository;
}
