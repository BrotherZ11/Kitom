/**
 * Datos derivados del perfil de una mascota (tablero 3.6). Módulo puro, sin imports de la app: se
 * prueba con `npm test`. Nada se estima: si un dato no está, se dice que falta.
 */

type ProfilePet = {
  photo_path: string | null;
  breed_status: string | null;
  birth_date: string | null;
  weight_kg: number | null;
  sex: string | null;
  sterilized: boolean | null;
  allergies: string[] | null;
  known_conditions: string[] | null;
  temperament_notes: string | null;
};

/** Los 9 datos opcionales del perfil, en el orden en que se piden (tablero 3.8). */
export const PROFILE_FIELDS = [
  'photo',
  'breed',
  'birthDate',
  'weight',
  'sex',
  'sterilized',
  'allergies',
  'knownConditions',
  'temperament',
] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];

const hasText = (value: string | null) => value !== null && value.trim() !== '';
const hasItems = (value: string[] | null) => value !== null && value.length > 0;

/**
 * Datos opcionales que faltan. «No lo sé» (sexo `unknown`, raza desconocida) no cuenta como
 * contestado salvo en la raza, donde «desconocida» es una respuesta (`breed_status = 'unknown'`).
 */
export function missingProfileFields(pet: ProfilePet): ProfileField[] {
  const present: Record<ProfileField, boolean> = {
    photo: pet.photo_path !== null,
    breed: pet.breed_status !== null,
    birthDate: pet.birth_date !== null,
    weight: pet.weight_kg !== null,
    sex: pet.sex !== null && pet.sex !== 'unknown',
    sterilized: pet.sterilized !== null,
    allergies: hasItems(pet.allergies),
    knownConditions: hasItems(pet.known_conditions),
    temperament: hasText(pet.temperament_notes),
  };
  return PROFILE_FIELDS.filter((field) => !present[field]);
}

const LOG_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type PetAge = { unit: 'years' | 'months'; count: number } | { unit: 'newborn' };

/** Edad a partir de `birth_date` y de hoy (ambos `YYYY-MM-DD`); `null` si falta o es posterior. */
export function petAge(birthDate: string | null, today: string): PetAge | null {
  const birth = birthDate ? LOG_DATE.exec(birthDate) : null;
  const now = LOG_DATE.exec(today);
  if (!birth || !now) return null;
  const [by, bm, bd] = birth.slice(1).map(Number);
  const [ty, tm, td] = now.slice(1).map(Number);
  let months = (ty - by) * 12 + (tm - bm);
  if (td < bd) months -= 1;
  if (months < 0) return null;
  if (months === 0) return { unit: 'newborn' };
  if (months < 12) return { unit: 'months', count: months };
  return { unit: 'years', count: Math.floor(months / 12) };
}

/**
 * Racha vigente según `pet_streaks` (la calcula el servidor al guardar registros). El servidor no la
 * pone a 0 si pasan los días sin registrar: si el último registro es anterior a ayer, ya no hay racha.
 */
export function currentStreak(
  streak: { current_streak: number; last_log_date: string | null } | null,
  yesterday: string
): number {
  if (!streak || !streak.last_log_date || streak.last_log_date < yesterday) return 0;
  return streak.current_streak;
}
