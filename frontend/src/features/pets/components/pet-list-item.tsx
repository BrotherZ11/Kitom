import { ListItem } from '@/components/ui/list-item';
import { PetPhoto } from '@/features/pets/components/pet-photo';
import type { Pet } from '@/features/pets/types';
import { t } from '@/i18n';

type PetListItemProps = {
  pet: Pet;
  speciesName: string | null;
  /** Mascota de otro propietario a la que el usuario tiene acceso como co-tutor. */
  isShared: boolean;
  divider?: boolean;
  onPress: () => void;
};

/** Fila de «Mis mascotas»: foto, nombre, especie y si es compartida (PetCard compacta). */
export function PetListItem({ pet, speciesName, isShared, divider = false, onPress }: PetListItemProps) {
  const subtitle = [speciesName, isShared ? t('pets.list.shared') : null].filter(Boolean).join(' · ');

  return (
    <ListItem
      title={pet.name}
      subtitle={subtitle || undefined}
      leading={<PetPhoto name={pet.name} photoPath={pet.photo_path} size="md" />}
      divider={divider}
      onPress={onPress}
    />
  );
}
