import type { Pet } from '@/features/pets/types';
import type { LocalCollection } from '@/lib/local-store/local-store';

import { parseVersion } from '../../daily-logs/offline/daily-log-version.ts';

/**
 * Copias locales de mascotas para verlas sin conexión (`LocalStore`, aisladas por usuario). Módulo
 * puro: se prueba con `npm test`. Solo lectura: nada de esto se envía al servidor ni sustituye a RLS.
 *
 * Dos colecciones (`docs/FRONTEND_ARCHITECTURE.md` §5 «Pets sin conexión (fase 7)»):
 * - `pets` (`kitom:v1:<userId>:pets:<petId>`): la última versión conocida de una mascota
 *   (`PetSnapshot`). Existe si la mascota se leyó del servidor al menos una vez. Nunca se borra sola:
 *   si el servidor deja de devolverla, queda con `unavailableAt`.
 * - `pets-list` (`kitom:v1:<userId>:pets-list:current`): qué mascotas devolvió la última lista correcta
 *   (`PetListSnapshot`). No existe = la lista nunca se ha cargado en este dispositivo; `petIds: []` = el
 *   servidor confirmó que no hay mascotas.
 *
 * Se guardan solo las columnas que pintan las pantallas (las de `PET_COLUMNS`): ni URLs firmadas de
 * fotos (caducan; se firman bajo demanda con `photo_path`), ni permisos (`can_edit_pet` puede cambiar),
 * ni tokens. Lo que no valida al leer es un error (`corrupt`), nunca un valor por defecto.
 */

/** Mascota tal como se guarda: exactamente las columnas que lee la app. */
export type CachedPet = Pet;

export type PetSnapshot = {
  pet: CachedPet;
  /** Instante del dispositivo (ISO) en que se guardó esta versión. Solo para mostrar «actualizado…». */
  savedAt: string;
  /** Instante del dispositivo en que el servidor dejó de devolverla (sin acceso o eliminada), o `null`. */
  unavailableAt: string | null;
};

export type PetListSnapshot = {
  savedAt: string;
  /** Mascotas visibles en la última lista correcta, en el orden del servidor (`created_at`). */
  petIds: string[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SEX_VALUES = ['male', 'female', 'unknown'];
const BREED_STATUS_VALUES = ['known', 'mixed', 'unknown'];

export function isPetId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const nullable = (check: (value: unknown) => boolean) => (value: unknown) => value === null || check(value);
const isString = (value: unknown) => typeof value === 'string';
const isNonEmptyString = (value: unknown) => typeof value === 'string' && value.trim() !== '';
const isStringArray = (value: unknown) => Array.isArray(value) && value.every((item) => typeof item === 'string');
const isTimestamp = (value: unknown) => typeof value === 'string' && parseVersion(value) !== null;
/** Un path de Storage (`{pet_id}/{uuid}.jpg`), nunca una URL (firmada o no). */
const isStoragePath = (value: unknown) =>
  typeof value === 'string' && value !== '' && !value.includes('://') && !value.startsWith('/');

const PET_FIELDS: Record<keyof CachedPet, (value: unknown) => boolean> = {
  id: isPetId,
  owner_id: isPetId,
  name: isNonEmptyString,
  species_id: isPetId,
  sex: nullable((value) => SEX_VALUES.includes(value as string)),
  breed: nullable(isString),
  breed_id: nullable(isPetId),
  breed_status: nullable((value) => BREED_STATUS_VALUES.includes(value as string)),
  birth_date: nullable((value) => typeof value === 'string' && ISO_DATE.test(value)),
  weight_kg: nullable((value) => typeof value === 'number' && Number.isFinite(value)),
  sterilized: nullable((value) => typeof value === 'boolean'),
  known_conditions: nullable(isStringArray),
  allergies: nullable(isStringArray),
  temperament_notes: nullable(isString),
  photo_path: nullable(isStoragePath),
  is_active: (value) => typeof value === 'boolean',
  created_at: isTimestamp,
  updated_at: isTimestamp,
};

const PET_FIELD_NAMES = Object.keys(PET_FIELDS) as (keyof CachedPet)[];

/**
 * Copia solo las columnas conocidas de una fila (del servidor o leída del dispositivo) y la valida.
 * `null` si falta alguna o alguna no tiene el tipo esperado. Las propiedades de más no se copian.
 */
export function toCachedPet(row: unknown): CachedPet | null {
  if (!isRecord(row)) return null;
  const pet: Record<string, unknown> = {};
  for (const field of PET_FIELD_NAMES) {
    if (!(field in row) || !PET_FIELDS[field](row[field])) return null;
    const value = row[field];
    pet[field] = Array.isArray(value) ? [...value] : value;
  }
  return pet as CachedPet;
}

function parsePetSnapshot(data: unknown): PetSnapshot | null {
  if (!isRecord(data)) return null;
  const pet = toCachedPet(data.pet);
  if (!pet || !isTimestamp(data.savedAt)) return null;
  if (data.unavailableAt !== null && !isTimestamp(data.unavailableAt)) return null;
  return { pet, savedAt: data.savedAt as string, unavailableAt: data.unavailableAt as string | null };
}

function parsePetListSnapshot(data: unknown): PetListSnapshot | null {
  if (!isRecord(data) || !isTimestamp(data.savedAt) || !Array.isArray(data.petIds)) return null;
  if (!data.petIds.every(isPetId) || new Set(data.petIds).size !== data.petIds.length) return null;
  return { savedAt: data.savedAt as string, petIds: [...data.petIds] };
}

export const PET_SNAPSHOTS: LocalCollection<PetSnapshot> = {
  name: 'pets',
  version: 1,
  parse: parsePetSnapshot,
  // La copia debe ser de la mascota de su clave (una copia movida de clave no se usa).
  matchesKey: (value, key) => key.id.length === 1 && value.pet.id === key.id[0],
};

export const PET_LIST_SNAPSHOT: LocalCollection<PetListSnapshot> = {
  name: 'pets-list',
  version: 1,
  parse: parsePetListSnapshot,
};

/** Clave del único elemento de `pets-list`. */
export const PET_LIST_ID = ['current'] as const;
