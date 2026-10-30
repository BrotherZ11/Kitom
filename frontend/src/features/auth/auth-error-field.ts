import type { AuthErrorCode } from './auth-error-code.ts';

/** `currentPassword` y `confirmPassword`: cambio de contraseña (ajustes y recuperación). */
export type AuthField = 'email' | 'password' | 'currentPassword' | 'confirmPassword' | 'code';

/**
 * Campo en el que se muestra un error de auth (el diseño pone el error en el propio campo). `null`:
 * error del formulario o de la acción, en una alerta. Solo decide dónde se ve: el mensaje es el mismo
 * (`authErrorMessage`). `missing_fields` no señala un campo concreto. Una pantalla sin el campo
 * indicado (p. ej. sin «contraseña actual») muestra el error en la alerta.
 */
export function authErrorField(code: AuthErrorCode): AuthField | null {
  switch (code) {
    case 'invalid_email':
    case 'email_already_registered':
      return 'email';
    case 'invalid_credentials':
    case 'password_too_short':
    case 'weak_password':
    case 'pwned_password':
    case 'same_password':
      return 'password';
    case 'wrong_current_password':
      return 'currentPassword';
    case 'password_mismatch':
      return 'confirmPassword';
    case 'code_invalid':
      return 'code';
    default:
      return null;
  }
}
