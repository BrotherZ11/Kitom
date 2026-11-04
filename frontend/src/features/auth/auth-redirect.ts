import { isAuthPKCECodeVerifierMissingError } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

import { emailLinkRedirectUrl, readUrlParams, toFlow, type AuthRedirectFlow } from '@/features/auth/auth-callback-plan';
import { toAuthErrorCode, type AuthErrorCode } from '@/features/auth/auth-errors';
import { EMAIL_LINK_BRIDGE_URL } from '@/lib/legal-links';
import { supabase } from '@/lib/supabase';

/**
 * Deep links de Supabase Auth (confirmación de email, recuperación de contraseña y OAuth).
 * Configuración necesaria en Supabase: docs/AUTH.md.
 */

export type { AuthRedirectFlow };

export type AuthRedirectResult =
  | { status: 'signed_in'; flow: AuthRedirectFlow | null }
  /** Email confirmado en el servidor, pero sin sesión en este dispositivo: iniciar sesión. */
  | { status: 'email_confirmed' }
  | { status: 'error'; error: AuthErrorCode };

/**
 * Ruta de Expo Router que recibe los enlaces: `src/app/auth-callback.tsx`, disponible con y sin sesión
 * (qué se canjea en cada caso: `auth-callback-plan.ts`).
 */
const CALLBACK_PATH = 'auth-callback';

/**
 * URL a la que Supabase redirige tras verificar el enlace. Debe estar en Auth > URL Configuration >
 * Redirect URLs. Release: los emails, a la página puente (`emailLinkRedirectUrl`), y Google,
 * `kitom://auth-callback?flow=oauth`; desarrollo: `exp://<host>/--/auth-callback?flow=…`.
 * La usan el registro, el reenvío de la confirmación, la recuperación y Google.
 */
export function getAuthRedirectUrl(flow: AuthRedirectFlow): string {
  if (!__DEV__ && Platform.OS !== 'web' && flow !== 'oauth') return emailLinkRedirectUrl(EMAIL_LINK_BRIDGE_URL, flow);
  return Linking.createURL(CALLBACK_PATH, { queryParams: { flow } });
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
