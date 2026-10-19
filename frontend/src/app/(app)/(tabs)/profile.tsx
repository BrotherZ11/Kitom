import { useRouter } from 'expo-router';

import { ActivePetGate } from '@/features/pets/components/active-pet-gate';
import { PetProfile } from '@/features/pets/components/pet-profile';

/** Pestaña Perfil (tablero 3.6): el perfil de la mascota activa. */
export default function ProfileTab() {
  const router = useRouter();
  return (
    <ActivePetGate>
      {(pet) => <PetProfile key={pet.id} pet={pet} mode="tab" onOpenHistory={() => router.navigate('/history')} />}
    </ActivePetGate>
  );
}
