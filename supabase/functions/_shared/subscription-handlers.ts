// =====================================================================
// KITOM · Manejadores de revenuecat-webhook y subscription-sync
// =====================================================================
// Sin Deno ni red: reciben las pasarelas (subscription-rest.ts en las
// funciones, falsas en subscription.test.mjs). Contrato: docs/README.md §19.
//
// revenuecat-webhook (verify_jwt = false; lo llama RevenueCat):
//   POST con Authorization = REVENUECAT_WEBHOOK_AUTH.
//   200 { status: 'processed', applied, duplicate, stale, unknown_user }
//   200 { status: 'ignored' } (evento de prueba o sin cuenta de Kitom)
//   401 unauthorized · 400 invalid_request · 405 method_not_allowed
//   500 server_misconfigured | provider_unavailable | server_error (RevenueCat reintenta)
// subscription-sync (verify_jwt = true; la llama la app tras comprar o restaurar):
//   POST con el JWT del usuario. El usuario sale del JWT, nunca del cuerpo.
//   200 { status: 'applied' | 'duplicate' | 'stale' | 'unknown_user' }
//   401 not_authenticated · 405 method_not_allowed
//   500 server_misconfigured · 502 provider_unavailable · 500 server_error
// =====================================================================
import {
  InvalidProviderResponse,
  isAuthorizedWebhook,
  parseWebhookEvent,
  stateFromSubscriber,
  type SubscriptionState,
} from './subscription-state.ts';

export type ApplyResult = 'applied' | 'duplicate' | 'stale' | 'unknown_user';

export class ProviderError extends Error {
  readonly code: 'network' | 'http' | 'not_found';
  constructor(code: 'network' | 'http' | 'not_found') {
    super(`provider_${code}`);
    this.code = code;
  }
}

export class DatabaseError extends Error {
  constructor() {
    super('database_error');
  }
}

export type Log = (event: string, fields?: Record<string, unknown>) => void;

export type SubscriptionGateways = {
  fetchSubscriber: (userId: string) => Promise<unknown>;
  applyState: (userId: string, sourceEventId: string, eventType: string, state: SubscriptionState) => Promise<ApplyResult>;
  log: Log;
  now?: () => Date;
};

export type WebhookConfig = { webhookSecret?: string; entitlementId?: string; revenueCatKey?: string };
export type SyncConfig = { entitlementId?: string; revenueCatKey?: string };

const DEFAULT_ENTITLEMENT = 'premium';

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function syncUser(
  userId: string,
  sourceEventId: (state: SubscriptionState) => string,
  eventType: string,
  entitlementId: string,
  gateways: SubscriptionGateways,
): Promise<{ result: ApplyResult; isPremium: boolean }> {
  const body = await gateways.fetchSubscriber(userId);
  const state = stateFromSubscriber(body, entitlementId, (gateways.now ?? (() => new Date()))());
  const result = await gateways.applyState(userId, sourceEventId(state), eventType, state);
  return { result, isPremium: state.isPremium };
}

function errorResponse(error: unknown, gateways: SubscriptionGateways, where: string): Response {
  if (error instanceof ProviderError || error instanceof InvalidProviderResponse) {
    gateways.log('subscription_provider_error', { where, code: error.message });
    return json(where === 'sync' ? 502 : 500, { error: 'provider_unavailable' });
  }
  gateways.log('subscription_error', { where, code: error instanceof DatabaseError ? 'database' : 'unexpected' });
  return json(500, { error: 'server_error' });
}

export async function handleRevenueCatWebhook(
  request: Request,
  config: WebhookConfig,
  gateways: SubscriptionGateways,
): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  if (!config.webhookSecret || config.webhookSecret.length < 32 || !config.revenueCatKey) {
    gateways.log('subscription_misconfigured', { where: 'webhook' });
    return json(500, { error: 'server_misconfigured' });
  }
  if (!isAuthorizedWebhook(request.headers.get('Authorization'), config.webhookSecret)) {
    return json(401, { error: 'unauthorized' });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'invalid_request' });
  }
  const event = parseWebhookEvent(body);
  if (!event) return json(400, { error: 'invalid_request' });

  if (event.type === 'TEST' || event.userIds.length === 0) {
    gateways.log('subscription_webhook_ignored', { type: event.type, reason: event.type === 'TEST' ? 'test' : 'no_user' });
    return json(200, { status: 'ignored' });
  }

  const counts: Record<ApplyResult, number> = { applied: 0, duplicate: 0, stale: 0, unknown_user: 0 };
  try {
    for (const userId of event.userIds) {
      const { result } = await syncUser(
        userId,
        () => `${event.id}:${userId}`,
        event.type,
        config.entitlementId || DEFAULT_ENTITLEMENT,
        gateways,
      );
      counts[result] += 1;
    }
  } catch (error) {
    return errorResponse(error, gateways, 'webhook');
  }

  gateways.log('subscription_webhook_processed', { type: event.type, environment: event.environment, ...counts });
  return json(200, { status: 'processed', ...counts });
}

export async function handleSubscriptionSync(
  request: Request,
  config: SyncConfig,
  gateways: SubscriptionGateways & { getUserId: (token: string) => Promise<string | null> },
): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  if (!config.revenueCatKey) {
    gateways.log('subscription_misconfigured', { where: 'sync' });
    return json(500, { error: 'server_misconfigured' });
  }

  const header = request.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  let userId: string | null = null;
  if (token) {
    try {
      userId = await gateways.getUserId(token);
    } catch {
      userId = null;
    }
  }
  if (!userId) return json(401, { error: 'not_authenticated' });

  try {
    const { result } = await syncUser(
      userId,
      (state) => `sync:${userId}:${state.stateAt}`,
      'SYNC',
      config.entitlementId || DEFAULT_ENTITLEMENT,
      gateways,
    );
    gateways.log('subscription_sync', { result });
    return json(200, { status: result });
  } catch (error) {
    return errorResponse(error, gateways, 'sync');
  }
}
