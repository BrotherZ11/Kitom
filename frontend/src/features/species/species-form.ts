import {
  DECIMAL_PLACES,
  isValidSpeciesValue,
  normalizeSpeciesData,
  setSpeciesValue,
  type SpeciesData,
  type SpeciesField,
  type SpeciesValue,
} from './species-fields.ts';

/**
 * Estado de los campos de especie en un formulario (ficha o registro diario). Módulo puro (`npm test`).
 *
 * Las elecciones van directamente a `data`. Los números y las fechas se escriben como texto (`text`) y
 * solo se convierten al guardar: así un valor a medio escribir («32,») no se pierde ni se guarda mal.
 * `data` conserva también las claves que esta versión no conoce (de otra versión o de la especie
 * anterior): nunca se pierden al editar.
 */
export type SpeciesFormValues = {
  data: SpeciesData;
  /**
   * Texto escrito en los campos `integer`, `decimal` y `date`, por código. Solo los que el usuario ha
   * tocado; los demás muestran el valor guardado (`speciesText`).
   */
  text: Record<string, string>;
};

export type SpeciesFieldError = 'invalid_number' | 'invalid_decimal' | 'invalid_date';

const TEXT_KINDS = new Set(['integer', 'decimal', 'date']);

export function isTextField(field: SpeciesField): boolean {
  return TEXT_KINDS.has(field.kind);
}

/** Texto inicial de un número o fecha guardados (decimales con punto, como se guardan). */
function valueToText(value: SpeciesValue | undefined): string {
  if (value === undefined) return '';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  return '';
}

export function toSpeciesFormValues(data: SpeciesData | null | undefined): SpeciesFormValues {
  return { data: { ...(data ?? {}) }, text: {} };
}

/** Lo que muestra un campo de texto: lo escrito o, si no se ha tocado, el valor guardado. */
export function speciesText(form: SpeciesFormValues, code: string): string {
  return form.text[code] ?? valueToText(form.data[code]);
}

export function emptySpeciesForm(): SpeciesFormValues {
  return { data: {}, text: {} };
}

/** Elige (o quita, con `undefined`) un valor de un campo de elección, escala o sí/no. */
export function setSpeciesFormValue(form: SpeciesFormValues, code: string, value: SpeciesValue | undefined): SpeciesFormValues {
  return { ...form, data: setSpeciesValue(form.data, code, value) };
}

/** Pulsar la opción ya elegida la quita (como en las escalas del registro). */
export function toggleSpeciesChoice(form: SpeciesFormValues, code: string, value: SpeciesValue): SpeciesFormValues {
  return setSpeciesFormValue(form, code, form.data[code] === value ? undefined : value);
}

/** Añade o quita una opción de un campo de elección múltiple (en el orden de sus opciones). */
export function toggleSpeciesMulti(form: SpeciesFormValues, field: SpeciesField, option: string): SpeciesFormValues {
  const current = Array.isArray(form.data[field.code]) ? (form.data[field.code] as string[]) : [];
  const next = current.includes(option) ? current.filter((item) => item !== option) : [...current, option];
  const ordered = (field.options ?? []).filter((item) => next.includes(item));
  return setSpeciesFormValue(form, field.code, ordered.length > 0 ? ordered : undefined);
}

export function setSpeciesText(form: SpeciesFormValues, code: string, text: string): SpeciesFormValues {
  return { ...form, text: { ...form.text, [code]: text } };
}

/** Número escrito por el usuario: admite coma o punto decimal; `null` si no es un número. */
export function parseNumberText(text: string): number | null {
  const normalized = text.trim().replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

type Parsed = { ok: true; value: SpeciesValue | undefined } | { ok: false; error: SpeciesFieldError };

function parseText(field: SpeciesField, text: string, today: string): Parsed {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: true, value: undefined };
  if (field.kind === 'date') {
    return isValidSpeciesValue(field, trimmed, today) ? { ok: true, value: trimmed } : { ok: false, error: 'invalid_date' };
  }
  const number = parseNumberText(trimmed);
  const error: SpeciesFieldError = field.kind === 'decimal' ? 'invalid_decimal' : 'invalid_number';
  if (number === null) return { ok: false, error };
  // Redondeo de coma flotante («32.55» puede llegar como 32.550000000000004).
  const value = field.kind === 'decimal' ? Number(number.toFixed(DECIMAL_PLACES + 2)) : number;
  return isValidSpeciesValue(field, value, today) ? { ok: true, value } : { ok: false, error };
}

/** Errores de los campos de texto (números y fechas) del formulario. */
export function speciesFormErrors(
  form: SpeciesFormValues,
  fields: readonly SpeciesField[],
  today: string
): Record<string, SpeciesFieldError> {
  const errors: Record<string, SpeciesFieldError> = {};
  for (const field of fields) {
    if (!isTextField(field) || form.text[field.code] === undefined) continue;
    const parsed = parseText(field, form.text[field.code], today);
    if (!parsed.ok) errors[field.code] = parsed.error;
  }
  return errors;
}

/**
 * `species_data` que resulta del formulario: las elecciones, los números y fechas válidos y las claves
 * desconocidas tal cual. Un texto no válido deja el valor anterior (`speciesFormErrors` impide guardar).
 */
export function toSpeciesData(form: SpeciesFormValues, fields: readonly SpeciesField[], today: string): SpeciesData {
  let data = { ...form.data };
  for (const field of fields) {
    if (!isTextField(field) || form.text[field.code] === undefined) continue;
    const parsed = parseText(field, form.text[field.code], today);
    if (parsed.ok) data = setSpeciesValue(data, field.code, parsed.value);
  }
  return normalizeSpeciesData(data);
}

/** ¿Hay algún dato de los campos de la especie (indicado o escrito)? */
export function hasSpeciesFormValues(form: SpeciesFormValues, fields: readonly SpeciesField[]): boolean {
  return fields.some((field) =>
    isTextField(field) ? speciesText(form, field.code).trim() !== '' : form.data[field.code] !== undefined
  );
}
