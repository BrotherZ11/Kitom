import { Platform } from 'react-native';

import {
  chooseGoogleSignInMethod,
  interpretNativeSignIn,
  interpretNativeSignInError,
  type GoogleSignInMethod,
  type NativeGoogleOutcome,
} from '@/features/auth/google-sign-in-plan';

type GoogleSignInModule = typeof import('@react-native-google-signin/google-signin');

/**
 * Client ID **web** de Google Cloud (el mismo que usa Supabase en su proveedor Google). Es público: va en cada
 * petición a Google. Con él, el ID token de Android lleva como audiencia ese cliente y Supabase lo acepta. Sin él,
 * la build usa el acceso por navegador (`docs/AUTH.md` §4).
 */
const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

let loaded: GoogleSignInModule | null | undefined;
let configured = false;

/**
 * Carga el módulo solo en Android y con `require` protegido: en Expo Go no existe su módulo nativo y un `import`
 * normal rompería la app al arrancar (como `expo-notifications`, `features/notifications/device-notifications.ts`).
 */
function load(): GoogleSignInModule | null {
  if (loaded !== undefined) return loaded;
  if (Platform.OS !== 'android') {
    loaded = null;
    return loaded;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    loaded = require('@react-native-google-signin/google-signin') as GoogleSignInModule;
  } catch (error) {
    if (__DEV__) console.warn('[auth] acceso nativo con Google no disponible en este entorno', error);
    loaded = null;
  }
  return loaded;
}

/** Camino del botón «Continuar con Google» en este dispositivo (`google-sign-in-plan.ts`). */
export function googleSignInMethod(): GoogleSignInMethod {
  return chooseGoogleSignInMethod({ platform: Platform.OS, webClientId: WEB_CLIENT_ID, hasNativeModule: load() !== null });
}

/**
 * Abre el selector de cuentas de Android y devuelve el ID token de Google. Solo con `googleSignInMethod() === 'native'`.
 * Antes cierra la sesión de Google del módulo (no la de Kitom): si no, Android reutilizaría la última cuenta sin
 * preguntar, y quien tenga varias no podría elegir.
 */
export async function requestGoogleIdToken(): Promise<NativeGoogleOutcome> {
  const module = load();
  const webClientId = WEB_CLIENT_ID?.trim();
  if (!module || !webClientId) return { type: 'error', error: 'oauth_failed' };
  const { GoogleSignin, statusCodes } = module;

  try {
    if (!configured) {
      GoogleSignin.configure({ webClientId });
      configured = true;
    }
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    await GoogleSignin.signOut().catch(() => null);
    return interpretNativeSignIn(await GoogleSignin.signIn());
  } catch (error) {
    if (__DEV__) console.warn('[auth] acceso nativo con Google', error);
    return interpretNativeSignInError(error, statusCodes);
  }
}
