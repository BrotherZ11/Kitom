import {
  createBreedCatalogRepository,
  type BreedCatalogRepository,
} from '@/features/pets/offline/breed-catalog-repository';
import { deviceStorage } from '@/lib/local-store/device-storage';
import { createLocalStore } from '@/lib/local-store/local-store';

/**
 * Copia del catálogo de razas del dispositivo de cada usuario: una instancia por usuario y proceso (sus
 * marcas de lectura están en memoria), como `device-pet-cache.ts`. Los problemas de la copia se
 * registran solo en desarrollo y solo con su motivo (nunca el contenido).
 */
const repositories = new Map<string, BreedCatalogRepository>();

export function breedCatalogFor(userId: string): BreedCatalogRepository {
  let repository = repositories.get(userId);
  if (!repository) {
    repository = createBreedCatalogRepository(createLocalStore(deviceStorage, userId), {
      onProblem: (problem) => {
        if (__DEV__) console.warn('[breeds] local catalog:', problem);
      },
    });
    repositories.set(userId, repository);
  }
  return repository;
}
