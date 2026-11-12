import type { BreedStatus, Pet, PetFields, PetSex } from '@/features/pets/types';

import { fieldsFor, parseSpeciesData, weightInputUnit } from '../species/species-fields.ts';
import {
  emptySpeciesForm,
  speciesFormErrors,
  toSpeciesData,
  toSpeciesFormValues,
  type SpeciesFormValues,
} from '../species/species-form.ts';
import { isPlausibleBirthDate, isPlausibleWeight } from './pet-plausibility.ts';

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
  /** Peso en `weightUnit` (kg, o g en los animales pequeños: `weightInputUnit`). Se guarda en kg. */
  weightKg: string;
  weightUnit: 'kg' | 'g';
  sterilized: 'yes' | 'no' | 'unknown';
  /** Lista separada por comas. */
  knownConditions: string;
  allergies: string;
  temperamentNotes: string;
  /** Campos propios de la especie (`features/species/`). */
  species: SpeciesFormValues;
  /**
   * `false` si la mascota de partida no traía `species_data` (copia anterior a la columna): mientras no
   * se toque ningún campo de especie, no se envía (el servidor conserva lo suyo).
   */
  speciesIndicated: boolean;
};

export type PetFormField = keyof PetFormValues;
export type PetFieldError =
  | 'required'
  | 'breed_required'
  | 'breed_species_mismatch'
  | 'invalid_date'
  | 'future_date'
  | 'implausible_birth_date'
  | 'invalid_weight'
  | 'implausible_weight'
  | 'species_invalid';
export type PetFormErrors = Partial<Record<PetFormField, PetFieldError>>;

/**
 * Longitud máxima de los campos de texto libre. La base de datos los limita con CHECK (migración
 * `20261030090318`: raza ≤ 100, notas ≤ 2000, listas ≤ 100 elementos de ≤ 200): los de la app no
 * pueden superarlos, o un alta o edición sin conexión no se podría sincronizar nunca. Una lista de
 * 200 caracteres separada por comas da como mucho 100 elementos de 200.
 */
export const PET_BREED_TEXT_MAX_LENGTH = 60;
export const PET_LIST_MAX_LENGTH = 200;
export const PET_TEMPERAMENT_NOTES_MAX_LENGTH = 2000;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEIGHT_PATTERN = /^\d+(\.\d{1,3})?$/; // numeric(9,3)
const MAX_WEIGHT_KG = 1_000_000; // numeric(9,3): hasta 999999.999

/** Texto del peso en la unidad de entrada (kg o g) a partir de los kg guardados. */
function weightText(weightKg: number | null | undefined, unit: 'kg' | 'g'): string {
  if (weightKg == null) return '';
  return unit === 'g' ? String(Math.round(weightKg * 1000)) : String(weightKg);
}

/** `speciesCode`: especie de la mascota (unidad del peso); sin ella, kg. */
export function toPetFormValues(pet?: Pet, speciesCode?: string): PetFormValues {
  const weightUnit = weightInputUnit(speciesCode);
  const speciesData = parseSpeciesData(pet?.species_data);
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
    weightKg: weightText(pet?.weight_kg, weightUnit),
    weightUnit,
    sterilized: pet?.sterilized == null ? 'unknown' : pet.sterilized ? 'yes' : 'no',
    knownConditions: (pet?.known_conditions ?? []).join(', '),
    allergies: (pet?.allergies ?? []).join(', '),
    temperamentNotes: pet?.temperament_notes ?? '',
    species: toSpeciesFormValues(speciesData),
    // Alta: siempre se indica (vacío). Edición sin la columna en la copia: sin indicar.
    speciesIndicated: pet === undefined || speciesData !== null,
  };
}

/** Peso del formulario en kg, o `null` si está vacío o no es un número válido en su unidad. */
export function weightToKg(values: Pick<PetFormValues, 'weightKg' | 'weightUnit'>): number | null {
  const text = normalizeDecimal(values.weightKg);
  if (text === '') return null;
  if (values.weightUnit === 'g') return /^\d+$/.test(text) ? Number(text) / 1000 : null;
  return WEIGHT_PATTERN.test(text) ? Number(text) : null;
}

/**
 * Cambia la especie. Una raza concreta (del catálogo o escrita) pertenece a la especie anterior, así
 * que se descarta y la pregunta vuelve a «sin contestar»; mestizo y desconocida siguen siendo válidos.
 * Los campos propios de la especie anterior se vacían (el servidor tampoco los aceptaría) y el peso
 * pasa a la unidad de la nueva (si ya era un número válido, convertido).
 */
export function withSpecies(values: PetFormValues, speciesId: string, speciesCode?: string): PetFormValues {
  if (speciesId === values.speciesId) return values;
  const keepsBreed = values.breedStatus === 'mixed' || values.breedStatus === 'unknown';
  const weightUnit = weightInputUnit(speciesCode);
  const kg = weightToKg(values);
  const weightKg =
    weightUnit === values.weightUnit ? values.weightKg : kg === null ? values.weightKg : weightText(kg, weightUnit);
  return {
    ...values,
    speciesId,
    breedStatus: keepsBreed ? values.breedStatus : null,
    breedSource: 'catalog',
    breedId: '',
    breedText: '',
    weightKg,
    weightUnit,
    species: emptySpeciesForm(),
    speciesIndicated: true,
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
 * `breedSpeciesId`: especie de la raza elegida según el catálogo (del servidor o del dispositivo), si
 * se conoce; una raza de otra especie no se envía nunca (la FK `pets_breed_species_fkey` la rechazaría
 * y, sin conexión, el alta o la edición se quedaría sin poder sincronizar).
 * `speciesCode`: código de la especie elegida; con él se detectan erratas (`pet-plausibility.ts`).
 */
export function validatePetForm(
  values: PetFormValues,
  { breedSpeciesId, speciesCode, today = todayIsoDate() }: { breedSpeciesId?: string; speciesCode?: string; today?: string } = {}
): PetFormErrors {
  const errors: PetFormErrors = {};

  if (values.name.trim() === '') errors.name = 'required';
  if (values.speciesId === '') errors.speciesId = 'required';

  if (values.breedStatus === 'known') {
    if (values.breedSource === 'catalog' && values.breedId === '') errors.breedId = 'breed_required';
    if (
      values.breedSource === 'catalog' &&
      values.breedId !== '' &&
      breedSpeciesId !== undefined &&
      breedSpeciesId !== values.speciesId
    ) {
      errors.breedId = 'breed_species_mismatch';
    }
    if (values.breedSource === 'other' && values.breedText.trim() === '') {
      errors.breedText = 'breed_required';
    }
  }

  const birthDate = values.birthDate.trim();
  if (birthDate !== '') {
    if (!isRealDate(birthDate)) errors.birthDate = 'invalid_date';
    else if (birthDate > todayIsoDate()) errors.birthDate = 'future_date';
    else if (!isPlausibleBirthDate(birthDate, todayIsoDate(), speciesCode)) errors.birthDate = 'implausible_birth_date';
  }

  if (normalizeDecimal(values.weightKg) !== '') {
    const parsed = weightToKg(values);
    if (parsed === null || parsed <= 0 || parsed >= MAX_WEIGHT_KG) {
      errors.weightKg = 'invalid_weight';
    } else if (!isPlausibleWeight(parsed, speciesCode)) {
      errors.weightKg = 'implausible_weight';
    }
  }

  if (Object.keys(speciesFormErrors(values.species, fieldsFor(speciesCode, 'profile'), today)).length > 0) {
    errors.species = 'species_invalid';
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

/**
 * Convierte valores ya validados a las columnas editables de `pets`. `speciesCode`: especie elegida
 * (qué campos propios hay); sin ella solo se conservan los datos de especie que ya hubiera.
 */
export function toPetFields(
  values: PetFormValues,
  { speciesCode, today = todayIsoDate() }: { speciesCode?: string; today?: string } = {}
): PetFields {
  const weight = weightToKg(values);
  return {
    name: values.name.trim(),
    species_id: values.speciesId,
    sex: values.sex,
    ...toBreedFields(values),
    birth_date: toNullableText(values.birthDate),
    // Gramos → kg con 3 decimales como mucho (numeric(9,3)).
    weight_kg: weight === null ? null : Math.round(weight * 1000) / 1000,
    sterilized: values.sterilized === 'unknown' ? null : values.sterilized === 'yes',
    known_conditions: toList(values.knownConditions),
    allergies: toList(values.allergies),
    temperament_notes: toNullableText(values.temperamentNotes),
    ...(values.speciesIndicated
      ? { species_data: toSpeciesData(values.species, fieldsFor(speciesCode, 'profile'), today) }
      : {}),
  };
}
