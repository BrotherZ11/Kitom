import type { Pet } from '@/features/pets/types';
import { getLocale, t } from '@/i18n';

/** `birth_date` (AAAA-MM-DD) como fecha local; sin pasar por UTC para no cambiar de día. */
export function formatBirthDate(value: string | null): string | null {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(getLocale(), {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function formatWeight(value: number | null): string | null {
  if (value == null) return null;
  return `${new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 3 }).format(value)} kg`;
}

export function formatSterilized(value: boolean | null): string {
  if (value == null) return t('common.unknown');
  return value ? t('common.yes') : t('common.no');
}

export function formatList(values: string[] | null): string | null {
  return values && values.length > 0 ? values.join(', ') : null;
}

/**
 * Raza para mostrar. `catalogName` es el nombre traducido de `breed_id` (ya resuelto por quien llama).
 * `null` = sin contestar (la UI muestra el estado neutro «Sin indicar»).
 */
export function formatBreed(
  pet: Pick<Pet, 'breed_status' | 'breed_id' | 'breed'>,
  catalogName: string | null
): string | null {
  switch (pet.breed_status) {
    case 'known':
      return pet.breed_id ? catalogName : pet.breed;
    case 'mixed':
      return t('pets.breedDisplay.mixed');
    case 'unknown':
      return t('pets.breedDisplay.unknown');
    default:
      return null;
  }
}

export function formatSex(pet: Pick<Pet, 'sex'>): string {
  return t(`pets.sex.${pet.sex ?? 'unknown'}`);
}
