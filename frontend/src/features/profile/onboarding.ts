import type { LocalCollection } from '@/lib/local-store/local-store';

/**
 * Configuración inicial (tableros 2.1–2.4 y 3.4): perfil, aviso veterinario, privacidad y primera
 * mascota. Termina al guardar `profiles.onboarding_completed_at`. Módulo puro: se prueba con
 * `npm test`. Contrato: `docs/FRONTEND_ARCHITECTURE.md` §2 «Configuración inicial».
 */

/** Versión del texto del aviso veterinario (`profiles.disclaimer_version`). Cambiar el texto = subirla. */
export const DISCLAIMER_VERSION = '1.0';

/** Longitud máxima del nombre del perfil (la columna no tiene límite; es de interfaz). */
export const PROFILE_NAME_MAX_LENGTH = 60;

/** `null` = válido. El nombre es opcional: vacío también es válido (no se guarda). */
export function validateProfileName(name: string): 'too_long' | null {
  return name.trim().length > PROFILE_NAME_MAX_LENGTH ? 'too_long' : null;
}

export type OnboardingGate = 'loading' | 'pending' | 'complete' | 'error';

export type OnboardingInput = {
  /** Sesión utilizable (`signed_in`). Sin ella no se puede comprobar el perfil. */
  canUseServer: boolean;
  /** Marca del dispositivo «ya terminada»; `undefined` mientras se lee. */
  localDone: boolean | undefined;
  /** Perfil del servidor: cargando, error o la fecha guardada (`null` = sin terminar o sin perfil). */
  remote:
    | { status: 'pending' }
    | { status: 'error'; offline: boolean }
    | { status: 'success'; completedAt: string | null };
};

/**
 * ¿Hay que pasar por la configuración inicial?
 * - La marca del dispositivo basta para entrar (no se espera al servidor en cada arranque).
 * - Sin sesión utilizable, o si la comprobación falla por la red, nunca se bloquea: la app funciona sin
 *   conexión y quien tiene una sesión guardada ya entró antes en este móvil; si le faltaba algo, se le
 *   pedirá al recuperar la conexión.
 * - Con servidor, decide `onboarding_completed_at`.
 */
export function resolveOnboardingGate({ canUseServer, localDone, remote }: OnboardingInput): OnboardingGate {
  if (localDone === true) return 'complete';
  if (!canUseServer) return 'complete';
  if (localDone === undefined) return 'loading';
  if (remote.status === 'pending') return 'loading';
  if (remote.status === 'error') return remote.offline ? 'complete' : 'error';
  return remote.completedAt ? 'complete' : 'pending';
}

export type OnboardingFlag = { done: true };

/** Marca del dispositivo, por usuario (`LocalStore`). Solo se escribe cuando el servidor lo confirma. */
export const ONBOARDING_COLLECTION: LocalCollection<OnboardingFlag> = {
  name: 'onboarding',
  version: 1,
  parse(data) {
    return typeof data === 'object' && data !== null && (data as { done?: unknown }).done === true ? { done: true } : null;
  },
};

export const ONBOARDING_ID = ['state'] as const;
