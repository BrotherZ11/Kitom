/**
 * Campos propios de cada especie en la ficha (`pets.species_data`) y en el registro diario
 * (`daily_logs.species_data`), y qué escalas comunes del registro se preguntan a cada especie.
 *
 * Es la copia de la app del catálogo `public.species_fields` (migración `20261111120000_species_fields.sql`):
 * la base de datos valida con su tabla y la app pinta los formularios con esta copia (funciona sin
 * conexión y en el arranque en frío). `species-fields-parity.integration.test.mjs` comprueba que
 * coinciden. Añadir o cambiar un campo = migración nueva + esta copia + textos en `i18n` (es/en).
 *
 * Módulo puro, sin imports: se prueba con `npm test`. Diseño y decisiones:
 * `docs/proposals/2026-11-11-species-fields.md`. Las listas son un borrador de producto pendiente de
 * validación veterinaria antes de publicarlas (D-2).
 *
 * Reglas del catálogo (comprobadas por las pruebas):
 * - Un mismo `code` significa lo mismo en todas las especies: mismo `kind`, mismas opciones y misma
 *   unidad (el rango sí puede cambiar: el peso de una cobaya no es el de un hámster). Así un texto y
 *   un resumen sirven para todas.
 * - Sin texto libre: las notas siguen en las columnas comunes.
 * - En el registro diario, como mucho 6 campos propios por especie (objetivo de < 45 s).
 */

export const SPECIES_CODES = [
  'dog',
  'cat',
  'rabbit',
  'guinea_pig',
  'hamster',
  'horse',
  'bird_other',
  'reptile_other',
  'other',
] as const;
export type SpeciesCode = (typeof SPECIES_CODES)[number];

export type SpeciesFieldScope = 'profile' | 'daily';

/**
 * - `scale3`: menos / como siempre / más, guardado como 2/3/4 (como los detalles del registro).
 * - `choice`: un código de `options`. `multi_choice`: varios, sin repetir.
 * - `boolean`: sí/no. `integer` / `decimal`: número en `unit`, entre `min` y `max`.
 * - `date`: `YYYY-MM-DD`, nunca futura.
 */
export type SpeciesFieldKind = 'scale3' | 'choice' | 'multi_choice' | 'boolean' | 'integer' | 'decimal' | 'date';

/** Unidad en la que se guarda (y se pide) el número. */
export type SpeciesFieldUnit = 'g' | 'kg' | 'cm' | 'cm2' | 'min' | 'h' | 'celsius' | 'count';

export type SpeciesField = {
  code: string;
  kind: SpeciesFieldKind;
  options?: readonly string[];
  min?: number;
  max?: number;
  unit?: SpeciesFieldUnit;
};

/** Escalas comunes del registro (`daily_logs.*_level`, `sleep_quality`), con el nombre de la app. */
export const CORE_SCALES = ['energy', 'appetite', 'mood', 'activity', 'sleep', 'vocalization', 'social'] as const;
export type CoreScale = (typeof CORE_SCALES)[number];

/** `primary`: obligatoria al crear un registro; `optional`: en «Detalles»; `hidden`: no se pregunta. */
export type CoreScaleRole = 'primary' | 'optional' | 'hidden';

export type SpeciesDefinition = {
  core: Readonly<Record<CoreScale, CoreScaleRole>>;
  profile: readonly SpeciesField[];
  daily: readonly SpeciesField[];
};

// Opciones compartidas -------------------------------------------------------------------------

const YES_NO_UNKNOWN = ['yes', 'no', 'unknown'] as const;
const STOOL = ['normal', 'soft', 'liquid', 'hard', 'none'] as const;
const SMALL_DROPPINGS = ['usual', 'fewer', 'none_seen'] as const;
const SMALL_HOUSING = ['cage', 'pen', 'free_roam', 'outdoor'] as const;
const HAY_EATEN = ['none', 'less', 'usual'] as const;
const LIVES_WITH = ['children', 'dogs', 'cats', 'other_animals'] as const;
const DIET = ['dry', 'wet', 'mixed', 'homemade', 'raw', 'other'] as const;

// Campos reutilizados (mismo significado en varias especies) -------------------------------------

const microchip: SpeciesField = { code: 'microchip', kind: 'choice', options: YES_NO_UNKNOWN };
const diet: SpeciesField = { code: 'diet', kind: 'choice', options: DIET };
const livesWith: SpeciesField = { code: 'lives_with', kind: 'multi_choice', options: LIVES_WITH };
const water: SpeciesField = { code: 'water', kind: 'scale3' };
const stool: SpeciesField = { code: 'stool', kind: 'choice', options: STOOL };
const smallHousing: SpeciesField = { code: 'housing', kind: 'choice', options: SMALL_HOUSING };
const unlimitedHay: SpeciesField = { code: 'unlimited_hay', kind: 'boolean' };
const hayEaten: SpeciesField = { code: 'hay_eaten', kind: 'choice', options: HAY_EATEN };
const droppings: SpeciesField = { code: 'droppings', kind: 'choice', options: SMALL_DROPPINGS };
const hoursOut: SpeciesField = { code: 'hours_out', kind: 'integer', min: 0, max: 24, unit: 'h' };

const ALL_OPTIONAL: Record<CoreScale, CoreScaleRole> = {
  energy: 'primary',
  appetite: 'primary',
  mood: 'optional',
  activity: 'primary',
  sleep: 'optional',
  vocalization: 'optional',
  social: 'optional',
};

/** Perro y gato: exactamente como antes de esta fase (4 principales y 3 detalles). */
const DOG_CAT_CORE: Record<CoreScale, CoreScaleRole> = {
  energy: 'primary',
  appetite: 'primary',
  mood: 'primary',
  activity: 'primary',
  sleep: 'optional',
  vocalization: 'optional',
  social: 'optional',
};

export const SPECIES_DEFINITIONS: Readonly<Record<SpeciesCode, SpeciesDefinition>> = {
  dog: {
    core: DOG_CAT_CORE,
    profile: [
      microchip,
      { code: 'living_area', kind: 'choice', options: ['indoor', 'outdoor', 'both'] },
      diet,
      { code: 'meals_per_day', kind: 'integer', min: 1, max: 6, unit: 'count' },
      { code: 'walks_per_day', kind: 'integer', min: 0, max: 8, unit: 'count' },
      livesWith,
      { code: 'training', kind: 'choice', options: ['none', 'basic', 'advanced', 'working'] },
    ],
    daily: [
      { code: 'walks', kind: 'integer', min: 0, max: 10, unit: 'count' },
      { code: 'walk_minutes', kind: 'integer', min: 0, max: 600, unit: 'min' },
      water,
      stool,
      { code: 'vomit', kind: 'boolean' },
      { code: 'scratching', kind: 'scale3' },
    ],
  },
  cat: {
    core: DOG_CAT_CORE,
    profile: [
      microchip,
      { code: 'outdoor_access', kind: 'choice', options: ['never', 'protected', 'supervised', 'free'] },
      { code: 'litter_boxes', kind: 'integer', min: 0, max: 10, unit: 'count' },
      { code: 'litter_type', kind: 'choice', options: ['clumping', 'silica', 'plant', 'other'] },
      diet,
      { code: 'water_source', kind: 'choice', options: ['bowl', 'fountain', 'both'] },
      livesWith,
    ],
    daily: [
      { code: 'urination', kind: 'choice', options: ['less', 'usual', 'more', 'outside_box'] },
      stool,
      water,
      { code: 'grooming', kind: 'scale3' },
      { code: 'hairball_vomit', kind: 'choice', options: ['none', 'hairball', 'vomit'] },
      { code: 'hiding', kind: 'boolean' },
    ],
  },
  rabbit: {
    core: { ...DOG_CAT_CORE, sleep: 'hidden', vocalization: 'hidden' },
    profile: [
      smallHousing,
      hoursOut,
      unlimitedHay,
      { code: 'daily_greens', kind: 'boolean' },
      { code: 'pellets', kind: 'choice', options: ['none', 'extruded', 'seed_mix'] },
      { code: 'bonded_companion', kind: 'boolean' },
      { code: 'flooring', kind: 'choice', options: ['hard', 'carpet', 'mixed'] },
    ],
    daily: [
      hayEaten,
      droppings,
      { code: 'uneaten_cecotropes', kind: 'boolean' },
      water,
      { code: 'hunched', kind: 'boolean' },
    ],
  },
  guinea_pig: {
    core: { ...DOG_CAT_CORE, sleep: 'hidden' },
    profile: [
      smallHousing,
      { code: 'companions', kind: 'integer', min: 0, max: 10, unit: 'count' },
      { code: 'vitamin_c', kind: 'choice', options: ['diet', 'supplement', 'both', 'none', 'unknown'] },
      unlimitedHay,
    ],
    daily: [hayEaten, droppings, water, { code: 'weight_g', kind: 'integer', min: 100, max: 2500, unit: 'g' }],
  },
  hamster: {
    core: { ...DOG_CAT_CORE, mood: 'optional', sleep: 'hidden', vocalization: 'hidden', social: 'hidden' },
    profile: [
      { code: 'cage_area', kind: 'integer', min: 500, max: 20000, unit: 'cm2' },
      { code: 'wheel_diameter', kind: 'integer', min: 10, max: 40, unit: 'cm' },
      { code: 'bedding_depth', kind: 'integer', min: 0, max: 60, unit: 'cm' },
      { code: 'lives_alone', kind: 'boolean' },
    ],
    daily: [
      { code: 'wheel_use', kind: 'choice', options: ['none', 'little', 'usual', 'lots'] },
      { code: 'food_hoarded', kind: 'scale3' },
      droppings,
      { code: 'weight_g', kind: 'integer', min: 15, max: 250, unit: 'g' },
    ],
  },
  horse: {
    core: DOG_CAT_CORE,
    profile: [
      { code: 'height', kind: 'integer', min: 70, max: 200, unit: 'cm' },
      { code: 'horse_use', kind: 'choice', options: ['leisure', 'sport', 'work', 'breeding', 'retired'] },
      { code: 'horse_housing', kind: 'choice', options: ['stall', 'stall_paddock', 'pasture', 'mixed'] },
      { code: 'shoeing', kind: 'choice', options: ['barefoot', 'front', 'all'] },
      { code: 'forage', kind: 'choice', options: ['hay', 'grass', 'haylage', 'mixed'] },
      { code: 'concentrate', kind: 'decimal', min: 0, max: 10, unit: 'kg' },
    ],
    daily: [
      { code: 'work_minutes', kind: 'integer', min: 0, max: 480, unit: 'min' },
      { code: 'work_intensity', kind: 'choice', options: ['light', 'medium', 'high'] },
      { code: 'forage_eaten', kind: 'scale3' },
      water,
      { code: 'manure', kind: 'choice', options: ['usual', 'fewer', 'soft', 'none_seen'] },
      { code: 'lameness', kind: 'choice', options: ['none', 'mild', 'evident'] },
    ],
  },
  bird_other: {
    core: { ...DOG_CAT_CORE, sleep: 'hidden' },
    profile: [
      { code: 'bird_housing', kind: 'choice', options: ['cage', 'aviary', 'free'] },
      hoursOut,
      { code: 'wings_clipped', kind: 'boolean' },
      { code: 'leg_band', kind: 'choice', options: YES_NO_UNKNOWN },
      { code: 'bird_diet', kind: 'choice', options: ['seeds', 'pellets', 'mixed'] },
      { code: 'daily_fresh_food', kind: 'boolean' },
      { code: 'lives_with_birds', kind: 'boolean' },
    ],
    daily: [
      { code: 'plumage', kind: 'choice', options: ['normal', 'fluffed', 'plucked'] },
      { code: 'bird_droppings', kind: 'choice', options: ['usual', 'watery', 'color_change', 'fewer'] },
      { code: 'food_eaten', kind: 'scale3' },
      { code: 'bath', kind: 'boolean' },
      { code: 'minutes_out', kind: 'integer', min: 0, max: 1440, unit: 'min' },
    ],
  },
  reptile_other: {
    core: {
      energy: 'primary',
      appetite: 'primary',
      mood: 'hidden',
      activity: 'primary',
      sleep: 'hidden',
      vocalization: 'hidden',
      social: 'hidden',
    },
    profile: [
      { code: 'reptile_diet', kind: 'choice', options: ['insectivore', 'herbivore', 'carnivore', 'omnivore'] },
      { code: 'enclosure_length', kind: 'integer', min: 10, max: 400, unit: 'cm' },
      { code: 'enclosure_width', kind: 'integer', min: 10, max: 400, unit: 'cm' },
      { code: 'enclosure_height', kind: 'integer', min: 10, max: 400, unit: 'cm' },
      { code: 'basking_temp', kind: 'decimal', min: 15, max: 50, unit: 'celsius' },
      { code: 'cool_temp', kind: 'decimal', min: 10, max: 40, unit: 'celsius' },
      { code: 'uvb', kind: 'choice', options: ['none', 't5', 't8', 'mercury_vapor', 'unknown'] },
      { code: 'uvb_changed_on', kind: 'date' },
      { code: 'brumation', kind: 'choice', options: ['yes', 'no', 'not_applicable'] },
    ],
    daily: [
      { code: 'fed', kind: 'choice', options: ['not_due', 'ate', 'refused'] },
      { code: 'shedding', kind: 'choice', options: ['no', 'in_progress', 'complete', 'incomplete'] },
      { code: 'defecated', kind: 'boolean' },
      { code: 'basking_temp', kind: 'decimal', min: 15, max: 50, unit: 'celsius' },
      { code: 'soak', kind: 'boolean' },
    ],
  },
  other: { core: ALL_OPTIONAL, profile: [], daily: [] },
};

/** Como mucho 6 campos propios por día (registro en < 45 s). */
export const MAX_DAILY_SPECIES_FIELDS = 6;
/** Tamaño máximo de `species_data` en el servidor (bytes del JSON). */
export const SPECIES_DATA_MAX_BYTES = 4096;

export function isSpeciesCode(value: unknown): value is SpeciesCode {
  return (SPECIES_CODES as readonly unknown[]).includes(value);
}

/** Definición de una especie; una desconocida (o sin especie) se trata como «Otro». */
export function speciesDefinition(code: string | null | undefined): SpeciesDefinition {
  return isSpeciesCode(code) ? SPECIES_DEFINITIONS[code] : SPECIES_DEFINITIONS.other;
}

/**
 * Definición para el registro diario cuando la especie puede no conocerse (sin conexión y sin copia
 * de la mascota): sin especie se usan las escalas de siempre (las de perro y gato) y ningún campo
 * propio, para no ocultar nada que antes se preguntaba.
 */
export function dailyDefinition(code: string | null | undefined): SpeciesDefinition {
  if (code === null || code === undefined) return { core: DOG_CAT_CORE, profile: [], daily: [] };
  return speciesDefinition(code);
}

export function fieldsFor(code: string | null | undefined, scope: SpeciesFieldScope): readonly SpeciesField[] {
  const definition = speciesDefinition(code);
  return scope === 'profile' ? definition.profile : definition.daily;
}

export function findField(
  code: string | null | undefined,
  scope: SpeciesFieldScope,
  fieldCode: string
): SpeciesField | null {
  return fieldsFor(code, scope).find((field) => field.code === fieldCode) ?? null;
}

/** Escalas comunes con un papel dado, en el orden de pantalla. */
export function coreScales(definition: SpeciesDefinition, role: CoreScaleRole): CoreScale[] {
  return CORE_SCALES.filter((scale) => definition.core[scale] === role);
}

// ---------------------------------------------------------------------------------------------
// Valores
// ---------------------------------------------------------------------------------------------

/** Valor de un campo, tal como va en el JSON. */
export type SpeciesValue = number | string | boolean | string[];
/** `species_data`: un objeto plano; una clave ausente = sin indicar (nunca `null`). */
export type SpeciesData = Record<string, SpeciesValue>;

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isRealDate(value: string): boolean {
  const match = DATE.exec(value);
  if (!match) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Decimales permitidos en un `decimal` (la BD acepta lo mismo). */
export const DECIMAL_PLACES = 2;

/**
 * ¿Es un valor válido para el campo? Mismas reglas que el trigger `validate_species_data`, salvo la
 * fecha futura, que el servidor mide con su reloj (`today` permite comprobarla aquí también).
 */
export function isValidSpeciesValue(field: SpeciesField, value: unknown, today?: string): value is SpeciesValue {
  switch (field.kind) {
    case 'scale3':
      return value === 2 || value === 3 || value === 4;
    case 'boolean':
      return typeof value === 'boolean';
    case 'choice':
      return typeof value === 'string' && (field.options ?? []).includes(value);
    case 'multi_choice':
      return (
        Array.isArray(value) &&
        value.length > 0 &&
        value.every((item) => typeof item === 'string' && (field.options ?? []).includes(item)) &&
        new Set(value).size === value.length
      );
    case 'integer':
      return (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= (field.min ?? -Infinity) &&
        value <= (field.max ?? Infinity)
      );
    case 'decimal': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return false;
      if (value < (field.min ?? -Infinity) || value > (field.max ?? Infinity)) return false;
      const scaled = value * 10 ** DECIMAL_PLACES;
      return Math.abs(scaled - Math.round(scaled)) < 1e-6;
    }
    case 'date':
      return typeof value === 'string' && isRealDate(value) && value >= '1900-01-01' && (today === undefined || value <= today);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Forma canónica de `species_data`: claves ordenadas y `multi_choice` en el orden de sus opciones (sin
 * duplicados). Las claves que esta versión no conoce **se conservan** tal cual: las pudo escribir una
 * versión más nueva de la app y no deben perderse al editar.
 */
export function normalizeSpeciesData(data: SpeciesData, speciesCode?: string | null): SpeciesData {
  const result: SpeciesData = {};
  for (const key of Object.keys(data).sort()) {
    const value = data[key];
    if (value === undefined || value === null) continue;
    const field = speciesCode === undefined ? null : findFieldAnyScope(speciesCode, key);
    if (Array.isArray(value)) {
      const options = field?.options;
      const unique = [...new Set(value)];
      result[key] = options ? options.filter((option) => unique.includes(option)) : unique.sort();
      if ((result[key] as string[]).length === 0) delete result[key];
      continue;
    }
    result[key] = value;
  }
  return result;
}

function findFieldAnyScope(speciesCode: string | null, key: string): SpeciesField | null {
  return findField(speciesCode, 'daily', key) ?? findField(speciesCode, 'profile', key);
}

/** Lee `species_data` (del servidor o del dispositivo); `null` si no tiene la forma de un objeto plano. */
export function parseSpeciesData(value: unknown): SpeciesData | null {
  if (!isRecord(value)) return null;
  const result: SpeciesData = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'number' || typeof item === 'string' || typeof item === 'boolean') {
      result[key] = item;
    } else if (Array.isArray(item) && item.every((entry) => typeof entry === 'string')) {
      result[key] = [...item];
    } else {
      return null;
    }
  }
  return normalizeSpeciesData(result);
}

export function sameSpeciesValue(a: SpeciesValue | undefined, b: SpeciesValue | undefined): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && [...a].sort().every((item, index) => item === [...b].sort()[index]);
  }
  return a === b;
}

export function sameSpeciesData(a: SpeciesData, b: SpeciesData): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if (!sameSpeciesValue(a[key], b[key])) return false;
  return true;
}

/** ¿Tiene algún valor? (Para «no vacío» del registro.) */
export function hasSpeciesValues(data: SpeciesData | null | undefined): boolean {
  return data !== null && data !== undefined && Object.keys(data).length > 0;
}

/**
 * Quita del objeto los campos de un ámbito de la especie que no tienen un valor válido, sin tocar
 * las claves desconocidas (de otra versión). Para enviar solo lo que el servidor aceptará.
 */
export function invalidSpeciesFields(
  speciesCode: string | null | undefined,
  scope: SpeciesFieldScope,
  data: SpeciesData,
  today?: string
): string[] {
  const fields = fieldsFor(speciesCode, scope);
  return fields.filter((field) => field.code in data && !isValidSpeciesValue(field, data[field.code], today)).map((f) => f.code);
}

/** Cambia (o quita, con `undefined`) el valor de un campo. */
export function setSpeciesValue(data: SpeciesData, code: string, value: SpeciesValue | undefined): SpeciesData {
  const next = { ...data };
  if (value === undefined || (Array.isArray(value) && value.length === 0)) delete next[code];
  else next[code] = value;
  return next;
}

/**
 * Fusión a tres bandas por campo (registro diario y ficha): si solo cambió un lado respecto a `base`,
 * gana ese lado; si los dos lo cambiaron a valores distintos, el campo queda en `conflicts`.
 */
export function mergeSpeciesData(
  base: SpeciesData,
  local: SpeciesData,
  remote: SpeciesData
): { merged: SpeciesData; conflicts: string[] } {
  const merged: SpeciesData = {};
  const conflicts: string[] = [];
  const keys = [...new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])].sort();
  for (const key of keys) {
    const localChanged = !sameSpeciesValue(local[key], base[key]);
    const remoteChanged = !sameSpeciesValue(remote[key], base[key]);
    let value: SpeciesValue | undefined;
    if (localChanged && remoteChanged && !sameSpeciesValue(local[key], remote[key])) {
      conflicts.push(key);
      value = remote[key];
    } else {
      value = localChanged ? local[key] : remote[key];
    }
    if (value !== undefined) merged[key] = value;
  }
  return { merged, conflicts };
}

/** Bytes del JSON (UTF-8), para no superar `SPECIES_DATA_MAX_BYTES`. */
export function speciesDataBytes(data: SpeciesData): number {
  const json = JSON.stringify(data);
  let bytes = 0;
  for (const char of json) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

// ---------------------------------------------------------------------------------------------
// Unidades de entrada
// ---------------------------------------------------------------------------------------------

/**
 * El peso de la ficha se guarda siempre en kg (`pets.weight_kg`), pero en los animales pequeños se
 * pide en gramos.
 */
export function weightInputUnit(code: string | null | undefined): 'g' | 'kg' {
  return code === 'hamster' || code === 'guinea_pig' || code === 'bird_other' ? 'g' : 'kg';
}

/** Mínimos de peso por especie (en kg): detectan erratas (un hámster de 30 kg). Solo en el formulario. */
export const MIN_WEIGHT_KG: Readonly<Partial<Record<SpeciesCode, number>>> = {
  dog: 0.3,
  cat: 0.3,
  rabbit: 0.3,
  guinea_pig: 0.1,
  hamster: 0.01,
  horse: 30,
  bird_other: 0.005,
  reptile_other: 0.001,
};

/**
 * Definición de un campo por su código, en cualquier especie (un código significa lo mismo en todas;
 * solo cambia el rango). Para mostrar un dato guardado sin saber la especie (conflictos, historial).
 */
export function fieldByCode(code: string): SpeciesField | null {
  for (const species of SPECIES_CODES) {
    const definition = SPECIES_DEFINITIONS[species];
    const field = definition.daily.find((item) => item.code === code) ?? definition.profile.find((item) => item.code === code);
    if (field) return field;
  }
  return null;
}

/** `species_data` de una fila (mascota o registro); sin la columna o con otra forma, vacío. */
export function speciesDataOf(row: { species_data?: unknown } | null | undefined): SpeciesData {
  return parseSpeciesData(row?.species_data) ?? {};
}
