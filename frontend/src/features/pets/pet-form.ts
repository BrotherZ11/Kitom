import type { BreedStatus, Pet, PetFields, PetSex } from '@/features/pets/types';

/** Valores del formulario como texto editable; se convierten a `PetFields` al enviar. */
export type PetFormValues = {
  name: string;
  speciesId: string;
  sex: PetSex;
  /** `null` = todavía no contestado (no es lo mismo que `unknown`). */
  breedStatus: BreedStatus | null;
  /** Con `breedStatus = 'known'`: raza del catálogo o escrita a mano (no catalogada). */
  breedSource: 'catalog' | 'other';
  breedId: string;
  breedText: string;
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
export type PetFieldError =
  | 'required'
  | 'breed_required'
  | 'invalid_date'
  | 'future_date'
  | 'invalid_weight';
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
    breedStatus: pet?.breed_status ?? null,
    // Una raza conocida sin breed_id es texto libre (raza no catalogada).
    breedSource: pet?.breed_status === 'known' && !pet.breed_id ? 'other' : 'catalog',
    breedId: pet?.breed_id ?? '',
    breedText: pet?.breed ?? '',
    birthDate: pet?.birth_date ?? '',
    weightKg: pet?.weight_kg != null ? String(pet.weight_kg) : '',
    sterilized: pet?.sterilized == null ? 'unknown' : pet.sterilized ? 'yes' : 'no',
    knownConditions: (pet?.known_conditions ?? []).join(', '),
    allergies: (pet?.allergies ?? []).join(', '),
    temperamentNotes: pet?.temperament_notes ?? '',
  };
}

/**
 * Cambia la especie. Una raza concreta (del catálogo o escrita) pertenece a la especie anterior, así
 * que se descarta y la pregunta vuelve a «sin contestar»; mestizo y desconocida siguen siendo válidos.
 */
export function withSpecies(values: PetFormValues, speciesId: string): PetFormValues {
  if (speciesId === values.speciesId) return values;
  const keepsBreed = values.breedStatus === 'mixed' || values.breedStatus === 'unknown';
  return {
    ...values,
    speciesId,
    breedStatus: keepsBreed ? values.breedStatus : null,
    breedSource: 'catalog',
    breedId: '',
    breedText: '',
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

  if (values.breedStatus === 'known') {
    if (values.breedSource === 'catalog' && values.breedId === '') errors.breedId = 'breed_required';
    if (values.breedSource === 'other' && values.breedText.trim() === '') {
      errors.breedText = 'breed_required';
    }
  }

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

/**
 * Columnas de raza siempre en una combinación válida para `pets_breed_status_check`:
 * known + breed_id · known + breed · mixed · unknown · null (las tres últimas sin raza).
 */
function toBreedFields(
  values: PetFormValues
): Pick<PetFields, 'breed_status' | 'breed_id' | 'breed'> {
  if (values.breedStatus !== 'known') {
    return { breed_status: values.breedStatus, breed_id: null, breed: null };
  }
  return values.breedSource === 'catalog'
    ? { breed_status: 'known', breed_id: values.breedId, breed: null }
    : { breed_status: 'known', breed_id: null, breed: values.breedText.trim() };
}

/** Convierte valores ya validados a las columnas editables de `pets`. */
export function toPetFields(values: PetFormValues): PetFields {
  const weight = normalizeDecimal(values.weightKg);
  return {
    name: values.name.trim(),
    species_id: values.speciesId,
    sex: values.sex,
    ...toBreedFields(values),
    birth_date: toNullableText(values.birthDate),
    weight_kg: weight === '' ? null : Number(weight),
    sterilized: values.sterilized === 'unknown' ? null : values.sterilized === 'yes',
    known_conditions: toList(values.knownConditions),
    allergies: toList(values.allergies),
    temperament_notes: toNullableText(values.temperamentNotes),
  };
}
