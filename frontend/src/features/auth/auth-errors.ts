import {
  isAuthError,
  isAuthRetryableFetchError,
  isAuthWeakPasswordError,
} from '@supabase/supabase-js';

import { t } from '@/i18n';

/** Errores de auth que entiende la UI. Nunca se muestra al usuario el error crudo de Supabase. */
export type AuthErrorCode =
  | 'missing_fields'
  | 'invalid_email'
  | 'invalid_credentials'
  | 'email_already_registered'
  | 'weak_password'
  | 'email_not_confirmed'
  | 'rate_limited'
  | 'signup_disabled'
  | 'network'
  | 'unknown';

export function toAuthErrorCode(error: unknown): AuthErrorCode {
  if (isAuthRetryableFetchError(error)) return 'network';
  if (isAuthWeakPasswordError(error)) return 'weak_password';

  if (isAuthError(error)) {
    switch (error.code) {
      case 'invalid_credentials':
        return 'invalid_credentials';
      case 'user_already_exists':
      case 'email_exists':
        return 'email_already_registered';
      case 'weak_password':
        return 'weak_password';
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

export function authErrorMessage(code: AuthErrorCode): string {
  return t(`auth.errors.${code}`);
}
