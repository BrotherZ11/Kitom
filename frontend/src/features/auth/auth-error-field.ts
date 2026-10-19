import type { AuthErrorCode } from '@/features/auth/auth-errors';

export type AuthField = 'email' | 'password';

/**
 * Campo en el que se muestra un error de auth (el diseño pone el error en el propio campo). `null`:
 * error del formulario o de la acción, en una alerta. Solo decide dónde se ve: el mensaje es el mismo
 * (`authErrorMessage`). `missing_fields` no señala un campo concreto.
 */
export function authErrorField(code: AuthErrorCode): AuthField | null {
  switch (code) {
    case 'invalid_email':
    case 'email_already_registered':
      return 'email';
    case 'invalid_credentials':
    case 'weak_password':
    case 'same_password':
      return 'password';
    default:
      return null;
  }
}
