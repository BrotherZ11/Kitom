// =====================================================================
// KITOM · Suscripción: RevenueCat, Auth y PostgREST por HTTP
// =====================================================================
// Con `fetch`, para que el mismo código corra en Deno y en las pruebas de Node.
// - RevenueCat: clave secreta de la API v1 (REVENUECAT_SECRET_API_KEY), solo aquí.
// - Auth: clave anónima + el JWT del usuario (subscription-sync).
// - apply_subscription_state: clave de servicio (solo service_role la ejecuta).
// Los errores son códigos, nunca el mensaje del servidor, la URL ni claves.
// =====================================================================
import { DatabaseError, ProviderError, type ApplyResult } from './subscription-handlers.ts';
import { isUuid, type SubscriptionState } from './subscription-state.ts';

const REQUEST_TIMEOUT_MS = 10_000;
const REVENUECAT_API = 'https://api.revenuecat.com/v1';

type Http = { fetch?: typeof fetch; timeoutMs?: number };

function base(url: string): string {
  return url.replace(/\/+$/, '');
}

async function call(http: Http, url: string, init: RequestInit): Promise<Response> {
  try {
    return await (http.fetch ?? fetch)(url, { ...init, signal: AbortSignal.timeout(http.timeoutMs ?? REQUEST_TIMEOUT_MS) });
  } catch {
    throw new ProviderError('network');
  }
}

export function createRevenueCatGateway(config: Http & { apiKey: string; apiUrl?: string }) {
  return {
    async fetchSubscriber(userId: string): Promise<unknown> {
      const response = await call(config, `${base(config.apiUrl ?? REVENUECAT_API)}/subscribers/${encodeURIComponent(userId)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${config.apiKey}`, Accept: 'application/json' },
      });
      if (response.status === 404) throw new ProviderError('not_found');
      if (!response.ok) throw new ProviderError('http');
      try {
        return await response.json();
      } catch {
        throw new ProviderError('http');
      }
    },
  };
}

export function createAuthGateway(config: Http & { url: string; anonKey: string }) {
  return {
    async getUserId(token: string): Promise<string | null> {
      let response: Response;
      try {
        response = await call(config, `${base(config.url)}/auth/v1/user`, {
          method: 'GET',
          headers: { apikey: config.anonKey, Authorization: `Bearer ${token}` },
        });
      } catch {
        return null;
      }
      if (!response.ok) return null;
      const body = (await response.json().catch(() => null)) as { id?: unknown } | null;
      return isUuid(body?.id) ? body.id : null;
    },
  };
}

const APPLY_RESULTS = new Set<ApplyResult>(['applied', 'duplicate', 'stale', 'unknown_user']);

export function createApplyStateGateway(config: Http & { url: string; serviceKey: string }) {
  return {
    async applyState(userId: string, sourceEventId: string, eventType: string, state: SubscriptionState): Promise<ApplyResult> {
      let response: Response;
      try {
        response = await call(config, `${base(config.url)}/rest/v1/rpc/apply_subscription_state`, {
          method: 'POST',
          headers: {
            apikey: config.serviceKey,
            Authorization: `Bearer ${config.serviceKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            p_user_id: userId,
            p_source_event_id: sourceEventId,
            p_event_type: eventType,
            p_state_at: state.stateAt,
            p_is_premium: state.isPremium,
            p_status: state.status,
            p_current_period_start: state.currentPeriodStart,
            p_current_period_end: state.currentPeriodEnd,
            p_trial_end: state.trialEnd,
            p_cancel_at_period_end: state.cancelAtPeriodEnd,
            p_provider: state.provider,
            p_provider_subscription_id: state.providerSubscriptionId,
            p_raw_payload: state.rawPayload,
          }),
        });
      } catch {
        throw new DatabaseError();
      }
      if (!response.ok) throw new DatabaseError();
      const result = await response.json().catch(() => null);
      if (typeof result !== 'string' || !APPLY_RESULTS.has(result as ApplyResult)) throw new DatabaseError();
      return result as ApplyResult;
    },
  };
}
