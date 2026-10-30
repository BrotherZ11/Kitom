import {
  isAuthError,
  isAuthPKCECodeVerifierMissingError,
  isAuthRetryableFetchError,
  isAuthWeakPasswordError,
} from '@supabase/supabase-js';

/**
 * Errores de auth que entiende la UI. Nunca se muestra al usuario el error crudo de Supabase. Módulo
 * puro (se prueba con `npm test` contra las clases de error reales de auth-js); el mensaje de cada
 * código está en `auth-errors.ts` (`authErrorMessage`).
 */
export type AuthErrorCode =
  | 'missing_fields'
  | 'invalid_email'
  | 'invalid_credentials'
  | 'email_already_registered'
  /** Validación previa: menos de `MIN_PASSWORD_LENGTH` caracteres (`validation.ts`). */
  | 'password_too_short'
  /** La contraseña nueva y su repetición no coinciden. */
  | 'password_mismatch'
  | 'weak_password'
  /** Aparece en filtraciones conocidas (protección de contraseñas filtradas de Supabase Auth). */
  | 'pwned_password'
  | 'same_password'
  /** Cambio de contraseña: la contraseña actual no es correcta. */
  | 'wrong_current_password'
  /** El código de verificación (nonce de `reauthenticate`) no es válido o ha caducado. */
  | 'code_invalid'
  /** Registro sin aceptar los Términos y la Política de privacidad. */
  | 'terms_not_accepted'
  | 'email_not_confirmed'
  | 'link_invalid'
  | 'oauth_failed'
  | 'rate_limited'
  | 'signup_disabled'
  | 'network'
  | 'unknown';

export function toAuthErrorCode(error: unknown): AuthErrorCode {
  if (isAuthRetryableFetchError(error)) return 'network';
  if (isAuthWeakPasswordError(error)) {
    // `reasons`: `length`, `characters` o `pwned`. Una filtrada se explica aparte: alargarla no basta.
    return error.reasons.includes('pwned') ? 'pwned_password' : 'weak_password';
  }
  // Enlace abierto en otro dispositivo o flujo ya consumido: no hay verifier PKCE local.
  if (isAuthPKCECodeVerifierMissingError(error)) return 'link_invalid';

  if (isAuthError(error)) {
    switch (error.code) {
      case 'invalid_credentials':
        return 'invalid_credentials';
      case 'user_already_exists':
      case 'email_exists':
        return 'email_already_registered';
      case 'weak_password':
        return 'weak_password';
      case 'same_password':
        return 'same_password';
      // Con «exigir la contraseña actual» activo en Supabase Auth (GoTrue
      // `update_password_require_current_password`), `updateUser` la comprueba.
      case 'current_password_invalid':
        return 'wrong_current_password';
      case 'current_password_required':
        return 'missing_fields';
      case 'reauthentication_not_valid':
      case 'reauth_nonce_missing':
        return 'code_invalid';
      case 'otp_expired':
      case 'flow_state_expired':
      case 'flow_state_not_found':
      case 'bad_code_verifier':
        return 'link_invalid';
      case 'bad_oauth_callback':
      case 'bad_oauth_state':
      case 'provider_disabled':
        return 'oauth_failed';
      case 'email_address_invalid':
        return 'invalid_email';
      case 'email_not_confirmed':
        return 'email_not_confirmed';
      case 'over_request_rate_limit':
      case 'over_email_send_rate_limit':
        return 'rate_limited';
      case 'signup_disabled':
      case 'email_provider_disabled':
        return 'signup_disabled';
    }
  }

  // fetch lanza TypeError cuando no hay red.
  if (error instanceof TypeError) return 'network';

  return 'unknown';
}
