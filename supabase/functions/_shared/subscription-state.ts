// =====================================================================
// KITOM · Suscripción: estado de RevenueCat → fila de `subscriptions`
// =====================================================================
// Módulo puro (sin Deno ni red), compartido por las Edge Functions
// revenuecat-webhook y subscription-sync y probado con `node --test`
// (subscription.test.mjs). Contrato: docs/README.md §19.
//
// Por qué se lee el cliente de la API y no se aplica el evento: los webhooks
// pueden llegar repetidos o desordenados. El estado que devuelve
// GET /v1/subscribers/{app_user_id} en ese momento es el bueno, y la BD no
// lo sustituye por uno leído antes (apply_subscription_state: 'stale').
// =====================================================================

export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled' | 'expired';

export type SubscriptionState = {
  stateAt: string;
  isPremium: boolean;
  status: SubscriptionStatus;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  trialEnd: string | null;
  cancelAtPeriodEnd: boolean;
  provider: 'revenuecat';
  providerSubscriptionId: string | null;
  /** Lo mínimo para soporte; nunca atributos del cliente (pueden llevar datos personales). */
  rawPayload: Record<string, unknown>;
};

export class InvalidProviderResponse extends Error {
  constructor() {
    super('invalid_provider_response');
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function ms(value: unknown): number | null {
  const s = str(value);
  if (s === null) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

function iso(value: unknown): string | null {
  const t = ms(value);
  return t === null ? null : new Date(t).toISOString();
}

/**
 * Estado de la suscripción de un cliente a partir de la respuesta de
 * GET /v1/subscribers/{app_user_id}. `now` es el reloj de la función (se usa
 * solo si RevenueCat no da `request_date`).
 */
export function stateFromSubscriber(body: unknown, entitlementId: string, now: Date): SubscriptionState {
  if (!isRecord(body) || !isRecord(body.subscriber)) throw new InvalidProviderResponse();
  const subscriber = body.subscriber;
  const requestMs = ms(body.request_date) ?? now.getTime();
  const stateAt = new Date(requestMs).toISOString();

  const entitlements = isRecord(subscriber.entitlements) ? subscriber.entitlements : {};
  const subscriptions = isRecord(subscriber.subscriptions) ? subscriber.subscriptions : {};
  const entitlement = isRecord(entitlements[entitlementId]) ? entitlements[entitlementId] : null;

  if (!entitlement) {
    // Nunca tuvo Premium: el estado por defecto de la fila (plan gratuito, «active»).
    return {
      stateAt,
      isPremium: false,
      status: 'active',
      currentPeriodStart: null,
      currentPeriodEnd: null,
      trialEnd: null,
      cancelAtPeriodEnd: false,
      provider: 'revenuecat',
      providerSubscriptionId: null,
      rawPayload: { entitlement: null },
    };
  }

  const productId = str(entitlement.product_identifier);
  const product = productId && isRecord(subscriptions[productId]) ? subscriptions[productId] : null;

  const expiresMs = ms(entitlement.expires_date);
  const graceMs = ms(entitlement.grace_period_expires_date) ?? ms(product?.grace_period_expires_date);
  // Sin fecha de caducidad = compra de por vida (no es el caso de Kitom, pero es Premium).
  const endMs = expiresMs === null ? null : Math.max(expiresMs, graceMs ?? expiresMs);
  const active = endMs === null || endMs > requestMs;

  const inTrial = str(product?.period_type) === 'trial';
  const billingIssue = str(product?.billing_issues_detected_at) !== null;
  const inGrace = active && expiresMs !== null && expiresMs <= requestMs;

  let status: SubscriptionStatus;
  if (!active) status = 'expired';
  else if (inGrace || (billingIssue && graceMs !== null)) status = 'past_due';
  else if (inTrial) status = 'trialing';
  else status = 'active';

  return {
    stateAt,
    isPremium: active,
    status,
    currentPeriodStart: iso(product?.purchase_date) ?? iso(entitlement.purchase_date),
    currentPeriodEnd: endMs === null ? null : new Date(endMs).toISOString(),
    trialEnd: inTrial ? iso(entitlement.expires_date) : null,
    cancelAtPeriodEnd: active && str(product?.unsubscribe_detected_at) !== null,
    provider: 'revenuecat',
    providerSubscriptionId: str(product?.store_transaction_id),
    rawPayload: {
      entitlement: entitlementId,
      product_identifier: productId,
      store: str(product?.store),
      period_type: str(product?.period_type),
      is_sandbox: product?.is_sandbox === true,
      unsubscribe_detected_at: iso(product?.unsubscribe_detected_at),
      billing_issues_detected_at: iso(product?.billing_issues_detected_at),
      refunded_at: iso(product?.refunded_at),
    },
  };
}

export type WebhookEvent = {
  id: string;
  type: string;
  environment: string | null;
  /** Cuentas de Kitom (UUID) afectadas: app_user_id, alias y las dos partes de una transferencia. */
  userIds: string[];
};

/** Lee el cuerpo del webhook. null si no es un evento de RevenueCat. */
export function parseWebhookEvent(body: unknown): WebhookEvent | null {
  if (!isRecord(body) || !isRecord(body.event)) return null;
  const event = body.event;
  const id = str(event.id);
  const type = str(event.type);
  if (!id || !type || id.length > 200 || type.length > 100) return null;

  const candidates: unknown[] = [event.app_user_id, event.original_app_user_id];
  for (const key of ['aliases', 'transferred_from', 'transferred_to']) {
    const list = event[key];
    if (Array.isArray(list)) candidates.push(...list.slice(0, 50));
  }
  const userIds = [...new Set(candidates.filter(isUuid).map((value) => value.toLowerCase()))];
  return { id, type, environment: str(event.environment), userIds };
}

/** Comparación en tiempo constante (para el secreto del webhook). */
export function timingSafeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

/**
 * RevenueCat envía en `Authorization` el valor configurado en su panel. Se
 * acepta tal cual o con «Bearer » delante, para que valga cualquiera de las
 * dos formas de configurarlo.
 */
export function isAuthorizedWebhook(header: string | null, secret: string): boolean {
  if (!header || secret.length < 32) return false;
  return timingSafeEqual(header, secret) || timingSafeEqual(header, `Bearer ${secret}`);
}
