/**
 * Decisiones de la ruta `/auth-callback` (destino de los enlaces de Supabase Auth). Módulo puro (se
 * prueba con `npm test`); el intercambio del código está en `auth-redirect.ts` y la pantalla en
 * `src/app/auth-callback.tsx`.
 *
 * La ruta está disponible con y sin sesión (layout raíz): así un enlace de recuperación abierto con la
 * sesión iniciada (p. ej. «Crear contraseña» desde ajustes) también funciona. Con sesión solo se
 * procesan enlaces de recuperación; el resto (confirmación de un registro, el retorno de Google que en
 * Android también llega por aquí) no se canjea: no tiene nada que hacer con una sesión ya iniciada y
 * podría cambiar de cuenta sin pasar por el cierre de sesión (que protege lo pendiente de sincronizar).
 */

export type AuthRedirectFlow = 'signup' | 'recovery' | 'oauth';

/** Une los parámetros de query y de fragmento (Supabase usa ambos según el caso). */
export function readUrlParams(url: string): Record<string, string> {
  const hashIndex = url.indexOf('#');
  const beforeHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const hash = hashIndex === -1 ? '' : url.slice(hashIndex + 1);
  const queryIndex = beforeHash.indexOf('?');
  const query = queryIndex === -1 ? '' : beforeHash.slice(queryIndex + 1);

  const params: Record<string, string> = {};
  for (const part of [query, hash]) {
    new URLSearchParams(part).forEach((value, key) => {
      params[key] = value;
    });
  }
  return params;
}

export function toFlow(value: string | undefined): AuthRedirectFlow | null {
  return value === 'signup' || value === 'recovery' || value === 'oauth' ? value : null;
}

/** Flujo declarado en la URL de retorno (`?flow=`, lo pone `getAuthRedirectUrl`). */
export function redirectFlow(url: string): AuthRedirectFlow | null {
  return toFlow(readUrlParams(url).flow);
}

/** ¿Se canjea el enlace? Sin sesión, siempre; con sesión, solo la recuperación de contraseña. */
export function shouldCompleteRedirect(flow: AuthRedirectFlow | null, isSignedIn: boolean): boolean {
  return !isSignedIn || flow === 'recovery';
}

/** Resultado del canje visto por la pantalla (`skipped`: enlace no canjeado porque ya hay sesión). */
export type CallbackOutcome = { status: 'signed_in' } | { status: 'email_confirmed' } | { status: 'error' } | { status: 'skipped' };

/**
 * A dónde sale la pantalla, o `null` para quedarse (procesando o mostrando el resultado). Con una
 * recuperación pendiente, siempre a `/update-password`; con sesión y el canje hecho (o no necesario),
 * a la app. Un canje correcto cuya sesión aún no ha llegado al estado de la app espera.
 */
export function callbackDestination(input: {
  outcome: CallbackOutcome | null;
  isSignedIn: boolean;
  isRecoveringPassword: boolean;
}): '/update-password' | '/' | null {
  if (!input.isSignedIn) return null;
  if (input.isRecoveringPassword) return '/update-password';
  if (input.outcome?.status === 'signed_in' || input.outcome?.status === 'skipped') return '/';
  return null;
}
