import type { AuthErrorCode } from './auth-error-code.ts';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  if (!EMAIL_PATTERN.test(email.trim())) return 'invalid_email';
  return null;
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

/** Registro con email: email válido, contraseña nueva válida y Términos aceptados (en ese orden). */
export function validateSignUp(email: string, password: string, acceptedTerms: boolean): AuthErrorCode | null {
  return validateCredentials(email, password) ?? validateNewPassword(password) ?? (acceptedTerms ? null : 'terms_not_accepted');
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
