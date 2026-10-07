import type { AuthErrorCode } from '@/features/auth/auth-errors';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validación previa mínima para dar feedback inmediato. Las reglas reales (p. ej. requisitos de
 * contraseña) las decide Supabase Auth y llegan como error mapeado.
 */
export function validateEmail(email: string): AuthErrorCode | null {
  if (email.trim() === '') return 'missing_fields';
  if (!EMAIL_PATTERN.test(email.trim())) return 'invalid_email';
  return null;
}

export function validateCredentials(email: string, password: string): AuthErrorCode | null {
  if (email.trim() === '' || password === '') return 'missing_fields';
  return validateEmail(email);
}
