import { isAuthPKCECodeVerifierMissingError } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';

import { toAuthErrorCode, type AuthErrorCode } from '@/features/auth/auth-errors';
import { supabase } from '@/lib/supabase';

/**
 * Deep links de Supabase Auth (confirmación de email, recuperación de contraseña y OAuth).
 * Configuración necesaria en Supabase: docs/AUTH.md.
 */

export type AuthRedirectFlow = 'signup' | 'recovery' | 'oauth';

export type AuthRedirectResult =
  | { status: 'signed_in'; flow: AuthRedirectFlow | null }
  /** Email confirmado en el servidor, pero sin sesión en este dispositivo: iniciar sesión. */
  | { status: 'email_confirmed' }
  | { status: 'error'; error: AuthErrorCode };

/** Ruta de Expo Router que recibe los enlaces: `src/app/(auth)/auth-callback.tsx`. */
const CALLBACK_PATH = 'auth-callback';

/**
 * URL a la que Supabase redirige tras verificar el enlace. Debe estar en Auth > URL Configuration >
 * Redirect URLs. Build: `kitom://auth-callback?flow=…`; Expo Go: `exp://<host>/--/auth-callback?flow=…`.
 */
export function getAuthRedirectUrl(flow: AuthRedirectFlow): string {
  return Linking.createURL(CALLBACK_PATH, { queryParams: { flow } });
}

/** Une los parámetros de query y de fragmento (Supabase usa ambos según el caso). */
function readUrlParams(url: string): Record<string, string> {
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

function toFlow(value: string | undefined): AuthRedirectFlow | null {
  return value === 'signup' || value === 'recovery' || value === 'oauth' ? value : null;
}

/** Errores que Supabase añade a la URL de retorno (`error`, `error_code`). */
function redirectErrorToCode(code: string, flow: AuthRedirectFlow | null): AuthErrorCode {
  switch (code) {
    case 'otp_expired':
    case 'flow_state_expired':
    case 'flow_state_not_found':
    case 'bad_code_verifier':
      return 'link_invalid';
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return 'rate_limited';
    default:
      return flow === 'oauth' ? 'oauth_failed' : 'link_invalid';
  }
}

function toFailure(error: unknown, flow: AuthRedirectFlow | null): AuthRedirectResult {
  if (__DEV__) console.warn('[auth] redirect', error);
  // Supabase confirma el email antes de redirigir; si este dispositivo no tiene el verifier
  // (enlace abierto en otro dispositivo o flujo sustituido), solo falta iniciar sesión.
  if (flow === 'signup' && isAuthPKCECodeVerifierMissingError(error)) {
    return { status: 'email_confirmed' };
  }
  return { status: 'error', error: toAuthErrorCode(error) };
}

async function exchangeCode(
  code: string,
  flowId: string | undefined,
  flow: AuthRedirectFlow | null
): Promise<AuthRedirectResult> {
  try {
    // Emite SIGNED_IN, o PASSWORD_RECOVERY si el código viene de un enlace de recuperación.
    const { error } = await supabase.auth.exchangeCodeForSession(
      code,
      flowId ? { flowId } : undefined
    );
    return error ? toFailure(error, flow) : { status: 'signed_in', flow };
  } catch (error) {
    return toFailure(error, flow);
  }
}

// El código es de un solo uso y la misma URL puede llegar dos veces (en Android, el retorno de
// OAuth lo reciben a la vez openAuthSessionAsync y Expo Router): se comparte la misma promesa.
const exchangesByCode = new Map<string, Promise<AuthRedirectResult>>();

/** Procesa una URL de retorno de Supabase Auth y, si es válida, crea la sesión. */
export function completeAuthRedirect(url: string): Promise<AuthRedirectResult> {
  const params = readUrlParams(url);
  const flow = toFlow(params.flow);

  const errorCode = params.error_code ?? params.error;
  if (errorCode) {
    if (__DEV__) console.warn('[auth] redirect error', errorCode, params.error_description);
    return Promise.resolve({ status: 'error', error: redirectErrorToCode(errorCode, flow) });
  }

  const code = params.code;
  if (!code) return Promise.resolve({ status: 'error', error: 'link_invalid' });

  let exchange = exchangesByCode.get(code);
  if (!exchange) {
    exchange = exchangeCode(code, params.sb_flow_id, flow);
    exchangesByCode.set(code, exchange);
  }
  return exchange;
}
