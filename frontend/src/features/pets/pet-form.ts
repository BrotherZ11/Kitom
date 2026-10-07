import type { Pet, PetFields, PetSex } from '@/features/pets/types';

/** Valores del formulario como texto editable; se convierten a `PetFields` al enviar. */
export type PetFormValues = {
  name: string;
  speciesId: string;
  sex: PetSex;
  breed: string;
  /** AAAA-MM-DD */
  birthDate: string;
  weightKg: string;
  sterilized: 'yes' | 'no' | 'unknown';
  /** Lista separada por comas. */
  knownConditions: string;
  allergies: string;
  temperamentNotes: string;
};

export type PetFormField = keyof PetFormValues;
export type PetFieldError = 'required' | 'invalid_date' | 'future_date' | 'invalid_weight';
export type PetFormErrors = Partial<Record<PetFormField, PetFieldError>>;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEIGHT_PATTERN = /^\d+(\.\d{1,3})?$/; // numeric(9,3)
const MAX_WEIGHT_KG = 1_000_000; // numeric(9,3): hasta 999999.999

export function toPetFormValues(pet?: Pet): PetFormValues {
  return {
    name: pet?.name ?? '',
    speciesId: pet?.species_id ?? '',
    // Mismo valor por defecto que la columna (`'unknown'`).
    sex: pet?.sex ?? 'unknown',
    breed: pet?.breed ?? '',
    birthDate: pet?.birth_date ?? '',
    weightKg: pet?.weight_kg != null ? String(pet.weight_kg) : '',
    sterilized: pet?.sterilized == null ? 'unknown' : pet.sterilized ? 'yes' : 'no',
    knownConditions: (pet?.known_conditions ?? []).join(', '),
    allergies: (pet?.allergies ?? []).join(', '),
    temperamentNotes: pet?.temperament_notes ?? '',
  };
}

/** Fecha local de hoy en AAAA-MM-DD, comparable como texto con `birthDate`. */
function todayIsoDate(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function isRealDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function normalizeDecimal(value: string): string {
  return value.trim().replace(',', '.');
}

function toList(value: string): string[] {
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
  return [...new Set(items)];
}

function toNullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Validación de formulario respaldada por el esquema: `name` y `species_id` NOT NULL,
 * `weight_kg` numeric(9,3) > 0, `birth_date` fecha real no futura (trigger validate_pet_birth_date).
 */
export function validatePetForm(values: PetFormValues): PetFormErrors {
  const errors: PetFormErrors = {};

  if (values.name.trim() === '') errors.name = 'required';
  if (values.speciesId === '') errors.speciesId = 'required';

  const birthDate = values.birthDate.trim();
  if (birthDate !== '') {
    if (!isRealDate(birthDate)) errors.birthDate = 'invalid_date';
    else if (birthDate > todayIsoDate()) errors.birthDate = 'future_date';
  }

  const weight = normalizeDecimal(values.weightKg);
  if (weight !== '') {
    const parsed = Number(weight);
    if (!WEIGHT_PATTERN.test(weight) || parsed <= 0 || parsed >= MAX_WEIGHT_KG) {
      errors.weightKg = 'invalid_weight';
    }
  }

  return errors;
}

export function hasPetFormErrors(errors: PetFormErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** Convierte valores ya validados a las columnas editables de `pets`. */
export function toPetFields(values: PetFormValues): PetFields {
  const weight = normalizeDecimal(values.weightKg);
  return {
    name: values.name.trim(),
    species_id: values.speciesId,
    sex: values.sex,
    breed: toNullableText(values.breed),
    birth_date: toNullableText(values.birthDate),
    weight_kg: weight === '' ? null : Number(weight),
    sterilized: values.sterilized === 'unknown' ? null : values.sterilized === 'yes',
    known_conditions: toList(values.knownConditions),
    allergies: toList(values.allergies),
    temperament_notes: toNullableText(values.temperamentNotes),
  };
}
