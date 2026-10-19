import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, type PropsWithChildren } from 'react';

import { useAuth } from '@/features/auth/auth-context';
import { usePets } from '@/features/pets/hooks/use-pets';
import { ACTIVE_PET_COLLECTION, ACTIVE_PET_ID, resolveActivePet } from '@/features/pets/active-pet';
import type { Pet } from '@/features/pets/types';
import { deviceStorage } from '@/lib/local-store/device-storage';
import { createLocalStore } from '@/lib/local-store/local-store';

type ActivePetValue = {
  /** Consulta de mascotas visibles (estado de carga, error, reintento). */
  pets: ReturnType<typeof usePets>;
  /** Mascota activa; `null` mientras carga, si falla o si no hay mascotas. */
  activePet: Pet | null;
  /** Cambia la mascota activa y la recuerda en este dispositivo. */
  setActivePet: (petId: string) => void;
};

const ActivePetContext = createContext<ActivePetValue | null>(null);

/**
 * Mascota activa (`docs/FRONTEND_ARCHITECTURE.md` §2: React Context, no estado global). Se recuerda
 * por usuario en el dispositivo; si ya no es visible, se usa la primera. Solo dentro de `(app)`.
 */
export function ActivePetProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const pets = usePets();
  const userId = user?.id ?? '';
  const storedKey = ['active-pet', userId] as const;

  const stored = useQuery({
    queryKey: storedKey,
    enabled: userId !== '',
    staleTime: Infinity,
    queryFn: async () => {
      const result = await createLocalStore(deviceStorage, userId).read(ACTIVE_PET_COLLECTION, ACTIVE_PET_ID);
      return result.status === 'found' ? result.value.petId : null;
    },
  });

  const setActivePet = (petId: string) => {
    queryClient.setQueryData(storedKey, petId);
    // Recordarla es una comodidad: si el dispositivo no puede guardarla, se usa igual en esta sesión.
    void createLocalStore(deviceStorage, userId)
      .write(ACTIVE_PET_COLLECTION, ACTIVE_PET_ID, { petId })
      .catch(() => undefined);
  };

  // Mientras se lee la elegida, no se muestra otra (evita un salto de mascota al arrancar).
  const activePet = pets.data && !stored.isPending ? resolveActivePet(pets.data, stored.data ?? null) : null;

  return (
    <ActivePetContext.Provider value={{ pets, activePet, setActivePet }}>{children}</ActivePetContext.Provider>
  );
}

export function useActivePet(): ActivePetValue {
  const value = useContext(ActivePetContext);
  if (!value) throw new Error('useActivePet debe usarse dentro de ActivePetProvider');
  return value;
}
