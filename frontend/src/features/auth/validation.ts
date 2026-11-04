import type { AuthErrorCode } from './auth-error-code.ts';

/** Parte local sin espacios ni puntos en los extremos; dominio con etiquetas válidas y un TLD de letras. */
const EMAIL_PATTERN = /^[^\s@.]+(\.[^\s@.]+)*@([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;
const MAX_EMAIL_LENGTH = 254;

/** Dominios en los que un error de una o dos letras es casi seguro una errata (`gmial.com`). */
const COMMON_EMAIL_DOMAINS = [
  'gmail.com',
  'hotmail.com',
  'hotmail.es',
  'outlook.com',
  'outlook.es',
  'yahoo.com',
  'yahoo.es',
  'icloud.com',
  'live.com',
  'protonmail.com',
];

/**
 * Longitud mínima de una contraseña nueva (registro, recuperación y cambio en ajustes). Es la que debe
 * fijarse en Supabase Auth (Dashboard › Authentication › «Minimum password length», ver `docs/AUTH.md`);
 * la app la comprueba antes para avisar sin esperar al servidor, que es quien decide.
 */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Validación previa mínima para dar feedback inmediato. Las reglas reales (longitud, contraseñas
 * filtradas…) las decide Supabase Auth y llegan como error mapeado. Módulo puro (`npm test`).
 */
export function validateEmail(email: string): AuthErrorCode | null {
  if (email.trim() === '') return 'missing_fields';
  const trimmed = email.trim();
  if (trimmed.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(trimmed)) return 'invalid_email';
  return null;
}

/** Distancia de edición (inserción, borrado, sustitución o trasposición de letras contiguas). */
function editDistance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
      }
    }
  }
  return rows[a.length][b.length];
}

/**
 * Sugerencia para una errata en un dominio habitual (`ana@gmial.com` → `ana@gmail.com`), o `null`. Solo
 * orienta y nunca impide continuar: que un buzón exista únicamente lo demuestra el email de confirmación.
 */
export function suggestEmailCorrection(email: string): string | null {
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0) return null;
  const domain = trimmed.slice(at + 1).toLowerCase();
  if (domain.length < 4 || COMMON_EMAIL_DOMAINS.includes(domain)) return null;
  const match = COMMON_EMAIL_DOMAINS.find((candidate) => editDistance(domain, candidate) <= 2);
  return match ? `${trimmed.slice(0, at)}@${match}` : null;
}

/** Inicio de sesión: no se aplica la regla de longitud (cuentas anteriores a ella siguen entrando). */
export function validateCredentials(email: string, password: string): AuthErrorCode | null {
  if (email.trim() === '' || password === '') return 'missing_fields';
  return validateEmail(email);
}

/**
 * Longitud en caracteres (puntos de código, no unidades UTF-16): nunca cuenta menos que el servidor,
 * así que lo que la app acepta no lo rechaza Supabase por longitud.
 */
export function passwordLength(password: string): number {
  return [...password].length;
}

/** Contraseña nueva: obligatoria y con al menos `MIN_PASSWORD_LENGTH` caracteres. */
export function validateNewPassword(password: string): AuthErrorCode | null {
  if (password === '') return 'missing_fields';
  if (passwordLength(password) < MIN_PASSWORD_LENGTH) return 'password_too_short';
  return null;
}

/** Registro con email: email válido y contraseña nueva válida (en ese orden). */
export function validateSignUp(email: string, password: string): AuthErrorCode | null {
  return validateCredentials(email, password) ?? validateNewPassword(password);
}

/**
 * Contraseña nueva con repetición (recuperación y ajustes). Con `currentPassword` (cambio en ajustes),
 * también es obligatoria la actual.
 */
export function validatePasswordChange(input: {
  currentPassword?: string;
  password: string;
  confirmation: string;
}): AuthErrorCode | null {
  if (input.currentPassword === '' || input.password === '' || input.confirmation === '') return 'missing_fields';
  return validateNewPassword(input.password) ?? (input.password === input.confirmation ? null : 'password_mismatch');
}
