import { createOwnerScopedClient } from '@/features/auth/owner-client';
import { createPetPhotoRemote } from '@/features/pets/api/pet-photos-remote';
import { createPetPhotoJournal } from '@/features/pets/offline/pet-photo-journal';
import type { PhotoOpsDeps } from '@/features/pets/pet-photo-ops';
import { createOperationId } from '@/lib/device-operation-id';
import { deviceStorage } from '@/lib/local-store/device-storage';
import { createLocalStore } from '@/lib/local-store/local-store';

/**
 * Dependencias de las operaciones de foto de cada usuario: su diario en el dispositivo y un cliente
 * autorizado solo como ese usuario (`createOwnerScopedClient`). Una instancia por usuario y proceso (los
 * objetos en curso viven en memoria).
 */
const instances = new Map<string, PhotoOpsDeps>();

export function petPhotoOpsFor(userId: string): PhotoOpsDeps {
  let deps = instances.get(userId);
  if (!deps) {
    deps = {
      // Cada petición, con el token de este usuario o no sale: el diario nunca se envía con otra cuenta.
      remote: createPetPhotoRemote(createOwnerScopedClient(userId)),
      journal: createPetPhotoJournal(createLocalStore(deviceStorage, userId)),
      now: Date.now,
      createId: createOperationId,
      active: new Set(),
    };
    instances.set(userId, deps);
  }
  return deps;
}
