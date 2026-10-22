import { useActivePet } from '@/features/pets/active-pet-context';
import { ActivePetGate } from '@/features/pets/components/active-pet-gate';
import { PetAgenda } from '@/features/reminders/components/pet-agenda';

/** Pestaña Agenda (tableros 8.1–8.6): los recordatorios de la mascota activa. */
export default function AgendaScreen() {
  const { pets } = useActivePet();
  return (
    <ActivePetGate>{(pet) => <PetAgenda key={pet.id} pet={pet} petCount={pets.data?.length ?? 1} />}</ActivePetGate>
  );
}
