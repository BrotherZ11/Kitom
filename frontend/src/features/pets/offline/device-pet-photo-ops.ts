import { createPetPhotoRemote } from '@/features/pets/api/pet-photos-remote';
import { createPetPhotoJournal } from '@/features/pets/offline/pet-photo-journal';
import type { PhotoOpsDeps } from '@/features/pets/pet-photo-ops';
import { createOperationId } from '@/lib/device-operation-id';
import { deviceStorage } from '@/lib/local-store/device-storage';
import { createLocalStore } from '@/lib/local-store/local-store';
import { supabase } from '@/lib/supabase';

/**
 * Dependencias de las operaciones de foto de cada usuario: su diario en el dispositivo y el cliente de
 * la app. Una instancia por usuario y proceso (los objetos en curso viven en memoria).
 */
const instances = new Map<string, PhotoOpsDeps>();

export function petPhotoOpsFor(userId: string): PhotoOpsDeps {
  let deps = instances.get(userId);
  if (!deps) {
    deps = {
      remote: createPetPhotoRemote(supabase),
      journal: createPetPhotoJournal(createLocalStore(deviceStorage, userId)),
      now: Date.now,
      createId: createOperationId,
      active: new Set(),
    };
    instances.set(userId, deps);
  }
  return deps;
}
