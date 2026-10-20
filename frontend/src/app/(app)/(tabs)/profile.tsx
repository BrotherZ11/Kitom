import { useRouter } from 'expo-router';

import { useActivePet } from '@/features/pets/active-pet-context';
import { ActivePetGate } from '@/features/pets/components/active-pet-gate';
import { PetProfile } from '@/features/pets/components/pet-profile';

/** Pestaña Perfil (tablero 3.6): el perfil de la mascota activa. */
export default function ProfileTab() {
  const router = useRouter();
  const { pets } = useActivePet();
  // La mascota activa sale de la lista: su origen (servidor o copia del dispositivo) es el de la lista.
  const freshness = pets.view.state === 'ready' ? pets.view : undefined;
  return (
    <ActivePetGate>
      {(pet) => (
        <PetProfile key={pet.id} pet={pet} mode="tab" freshness={freshness} onOpenHistory={() => router.navigate('/history')} />
      )}
    </ActivePetGate>
  );
}
