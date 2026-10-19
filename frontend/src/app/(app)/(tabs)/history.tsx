import { useState } from 'react';

import { PetHistory } from '@/features/daily-logs/components/pet-history';
import { useActivePet } from '@/features/pets/active-pet-context';
import { ActivePetGate } from '@/features/pets/components/active-pet-gate';
import { PetSelectorSheet } from '@/features/pets/components/pet-selector-sheet';
import { useCanEditPet } from '@/features/pets/hooks/use-pets';
import type { Pet } from '@/features/pets/types';

/** Pestaña Historial (tableros 6.x): el de la mascota activa. Su avatar abre el selector. */
export default function HistoryTab() {
  return <ActivePetGate>{(pet) => <ActivePetHistory key={pet.id} pet={pet} />}</ActivePetGate>;
}

function ActivePetHistory({ pet }: { pet: Pet }) {
  const canEdit = useCanEditPet(pet.id);
  const { pets } = useActivePet();
  const [selectorOpen, setSelectorOpen] = useState(false);

  return (
    <>
      <PetHistory
        pet={pet}
        mode="tab"
        canEdit={canEdit.data ?? null}
        onPressAvatar={(pets.data?.length ?? 0) > 0 ? () => setSelectorOpen(true) : undefined}
      />
      <PetSelectorSheet visible={selectorOpen} onClose={() => setSelectorOpen(false)} />
    </>
  );
}
