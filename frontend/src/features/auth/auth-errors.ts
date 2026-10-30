import type { AuthErrorCode } from '@/features/auth/auth-error-code';
import { t } from '@/i18n';

// El mapeo (puro y probado) está en `auth-error-code.ts`; aquí se añade el texto visible.
export { toAuthErrorCode, type AuthErrorCode } from '@/features/auth/auth-error-code';

export function authErrorMessage(code: AuthErrorCode): string {
  return t(`auth.errors.${code}`);
}
