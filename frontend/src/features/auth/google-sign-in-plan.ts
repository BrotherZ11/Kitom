import type { AuthErrorCode } from './auth-error-code.ts';

/**
 * Acceso con Google: qué camino usar y qué significa cada respuesta del módulo nativo. Módulo puro (se prueba
 * con `npm test`); la carga del módulo nativo está en `google-native-sign-in.ts` y la sesión, en `auth-context.tsx`.
 *
 * - `native`: Android con el módulo `@react-native-google-signin/google-signin` y el client ID web. El selector de
 *   cuentas del sistema da un ID token de Google y Supabase lo canjea (`signInWithIdToken`): no hay navegador ni URI
 *   de redirección.
 * - `browser`: el resto (web, iOS, Expo Go o una build sin `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`). Abre Google en el
 *   navegador y vuelve por `/auth-callback`; depende de la URI de redirección de Supabase en Google Cloud.
 */
export type GoogleSignInMethod = 'native' | 'browser';

export function chooseGoogleSignInMethod(input: {
  platform: string;
  webClientId: string | undefined;
  hasNativeModule: boolean;
}): GoogleSignInMethod {
  if (input.platform !== 'android') return 'browser';
  if (!input.webClientId?.trim()) return 'browser';
  return input.hasNativeModule ? 'native' : 'browser';
}

/** Errores del acceso nativo que ve el usuario (mensajes en `auth.errors`). */
export type NativeGoogleError = Extract<AuthErrorCode, 'google_play_services' | 'oauth_failed' | 'network'>;

export type NativeGoogleOutcome =
  | { type: 'token'; idToken: string }
  /** El usuario cerró el selector (o ya había otro acceso en curso): no es un error. */
  | { type: 'cancelled' }
  | { type: 'error'; error: NativeGoogleError };

/** Lo que devuelve `GoogleSignin.signIn()` (solo los campos que se usan). */
export type NativeSignInResponse =
  | { type: 'success'; data: { idToken: string | null } }
  | { type: 'cancelled'; data: null };

export function interpretNativeSignIn(response: NativeSignInResponse): NativeGoogleOutcome {
  if (response.type === 'cancelled') return { type: 'cancelled' };
  // Sin ID token: el client ID web no es el del proyecto de Google (no se puede canjear en Supabase).
  const idToken = response.data.idToken;
  return idToken ? { type: 'token', idToken } : { type: 'error', error: 'oauth_failed' };
}

/** `statusCodes` del módulo (sus valores vienen de las constantes nativas). */
export type NativeStatusCodes = {
  SIGN_IN_CANCELLED: string;
  IN_PROGRESS: string;
  PLAY_SERVICES_NOT_AVAILABLE: string;
};

/** `CommonStatusCodes` de Google Play services, como texto (así los rechaza el módulo en Android). */
const NETWORK_ERROR = '7';

export function interpretNativeSignInError(error: unknown, codes: NativeStatusCodes): NativeGoogleOutcome {
  const code = errorCode(error);
  if (code === codes.SIGN_IN_CANCELLED || code === codes.IN_PROGRESS) return { type: 'cancelled' };
  if (code === codes.PLAY_SERVICES_NOT_AVAILABLE) return { type: 'error', error: 'google_play_services' };
  if (code === NETWORK_ERROR) return { type: 'error', error: 'network' };
  // `10` (DEVELOPER_ERROR): falta el cliente Android con la huella SHA-1 de esta firma en Google Cloud. El
  // usuario no puede arreglarlo: mensaje genérico (la causa, en `docs/AUTH.md` §4).
  return { type: 'error', error: 'oauth_failed' };
}

/**
 * Error de Supabase al canjear el ID token. Lo que no tiene un mensaje propio (p. ej. un client ID que Supabase no
 * acepta como audiencia) se explica como fallo de Google, no como error desconocido.
 */
export function googleTokenErrorCode(code: AuthErrorCode): AuthErrorCode {
  return code === 'unknown' ? 'oauth_failed' : code;
}

function errorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  const code = (error as { code: unknown }).code;
  return typeof code === 'string' || typeof code === 'number' ? String(code) : null;
}
