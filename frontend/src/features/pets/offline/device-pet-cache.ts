import { createPetCacheRepository, type PetCacheRepository } from '@/features/pets/offline/pet-cache-repository';
import { deviceStorage } from '@/lib/local-store/device-storage';
import { createLocalStore } from '@/lib/local-store/local-store';

/**
 * Copia de mascotas del dispositivo de cada usuario: una instancia por usuario y proceso (sus marcas
 * de lectura están en memoria; ver `pet-cache-repository.ts`). Cambiar de cuenta no borra nada: las
 * copias de otras cuentas siguen en el dispositivo, aisladas por su clave de usuario.
 */
const repositories = new Map<string, PetCacheRepository>();

export function petCacheFor(userId: string): PetCacheRepository {
  let repository = repositories.get(userId);
  if (!repository) {
    repository = createPetCacheRepository(createLocalStore(deviceStorage, userId));
    repositories.set(userId, repository);
  }
  return repository;
}
