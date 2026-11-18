// Integración de revenuecat-webhook y subscription-sync contra el Supabase LOCAL: Auth, PostgREST,
// apply_subscription_state y get_my_plan reales; RevenueCat simulado (sin red ni claves reales).
// Lanzar con `node supabase/functions/_shared/run-integration.mjs` (se niega si la URL no es local).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { handleRevenueCatWebhook, handleSubscriptionSync } from './subscription-handlers.ts';
import { createApplyStateGateway, createAuthGateway } from './subscription-rest.ts';

const URL_ = process.env.KITOM_IT_SUPABASE_URL;
const ANON = process.env.KITOM_IT_SUPABASE_ANON_KEY;
const SERVICE = process.env.KITOM_IT_SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !ANON || !SERVICE || !/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(URL_)) {
  throw new Error('Solo contra el Supabase local: usa run-integration.mjs');
}

const SECRET = 'integration-secret-'.padEnd(40, 'x');
const PASSWORD = 'Prueba123!integration';
const email = `sub-it-${Date.now()}@example.test`;
let userId;
let token;

async function api(path, { method = 'GET', bearer = SERVICE, apikey = SERVICE, body } = {}) {
  const response = await fetch(`${URL_}${path}`, {
    method,
    headers: { apikey, Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const myPlan = async () => (await api('/rest/v1/rpc/get_my_plan', { method: 'POST', bearer: token, apikey: ANON, body: {} })).body[0];

// RevenueCat simulado: lo que devuelva `current` para el usuario.
let current = { subscriber: { entitlements: {}, subscriptions: {} } };
const now = () => new Date();
function premiumUntil(date, extra = {}) {
  return {
    request_date: new Date().toISOString(),
    subscriber: {
      entitlements: { premium: { product_identifier: 'kitom_premium:monthly', purchase_date: new Date().toISOString(), expires_date: date } },
      subscriptions: { 'kitom_premium:monthly': { period_type: 'normal', store: 'play_store', is_sandbox: true, store_transaction_id: `GPA.${Date.now()}`, ...extra } },
    },
  };
}

function gateways() {
  return {
    ...createApplyStateGateway({ url: URL_, serviceKey: SERVICE }),
    ...createAuthGateway({ url: URL_, anonKey: ANON }),
    fetchSubscriber: async () => current,
    log: () => {},
    now,
  };
}

before(async () => {
  const created = await api('/auth/v1/admin/users', { method: 'POST', body: { email, password: PASSWORD, email_confirm: true } });
  assert.equal(created.status, 200, 'alta del usuario de prueba');
  userId = created.body.id;
  const session = await api('/auth/v1/token?grant_type=password', { method: 'POST', bearer: ANON, apikey: ANON, body: { email, password: PASSWORD } });
  token = session.body.access_token;
  assert.ok(token);
});

after(async () => {
  if (userId) await api(`/auth/v1/admin/users/${userId}`, { method: 'DELETE' });
});

describe('suscripción contra el Supabase local', () => {
  test('una cuenta nueva es gratuita', async () => {
    const plan = await myPlan();
    assert.equal(plan.is_premium, false);
    assert.equal(plan.max_owned_pets, 2);
    assert.equal(plan.history_days, 30);
    assert.equal(plan.ai_monthly_limit, 3);
  });

  test('el usuario no puede ejecutar apply_subscription_state ni escribir su suscripción', async () => {
    const rpc = await api('/rest/v1/rpc/apply_subscription_state', {
      method: 'POST', bearer: token, apikey: ANON,
      body: { p_user_id: userId, p_source_event_id: 'x', p_event_type: 'X', p_state_at: new Date().toISOString(), p_is_premium: true,
        p_status: 'active', p_current_period_start: null, p_current_period_end: null, p_trial_end: null,
        p_cancel_at_period_end: false, p_provider: 'x', p_provider_subscription_id: null, p_raw_payload: null },
    });
    assert.ok([401, 403, 404].includes(rpc.status), `RPC denegada (${rpc.status})`);
    const patch = await api(`/rest/v1/subscriptions?user_id=eq.${userId}`, { method: 'PATCH', bearer: token, apikey: ANON, body: { plan: 'premium' } });
    assert.ok([401, 403].includes(patch.status), `UPDATE denegado (${patch.status})`);
    assert.equal((await myPlan()).is_premium, false);
  });

  test('tras comprar, subscription-sync con el JWT deja la cuenta Premium', async () => {
    current = premiumUntil(new Date(Date.now() + 30 * 864e5).toISOString());
    const response = await handleSubscriptionSync(
      new Request('http://x', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }),
      { revenueCatKey: 'sk_fake' }, gateways(),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'applied' });
    const plan = await myPlan();
    assert.equal(plan.is_premium, true);
    assert.equal(plan.max_owned_pets, null);
    assert.equal(plan.ai_monthly_limit, null);
    assert.equal(plan.can_invite_co_owners, true);
  });

  test('subscription-sync con un JWT falso: 401', async () => {
    const response = await handleSubscriptionSync(
      new Request('http://x', { method: 'POST', headers: { Authorization: 'Bearer no-vale' } }),
      { revenueCatKey: 'sk_fake' }, gateways(),
    );
    assert.equal(response.status, 401);
  });

  test('cancelada: sigue Premium hasta el final del periodo', async () => {
    current = premiumUntil(new Date(Date.now() + 10 * 864e5).toISOString(), { unsubscribe_detected_at: new Date().toISOString() });
    const response = await handleRevenueCatWebhook(
      new Request('http://x', { method: 'POST', headers: { Authorization: SECRET }, body: JSON.stringify({ event: { id: `cancel-${Date.now()}`, type: 'CANCELLATION', app_user_id: userId } }) }),
      { webhookSecret: SECRET, revenueCatKey: 'sk_fake' }, gateways(),
    );
    assert.equal(response.status, 200);
    const plan = await myPlan();
    assert.equal(plan.is_premium, true);
    assert.equal(plan.cancel_at_period_end, true);
  });

  test('el mismo evento repetido es un no-op', async () => {
    const id = `dup-${Date.now()}`;
    const send = () => handleRevenueCatWebhook(
      new Request('http://x', { method: 'POST', headers: { Authorization: SECRET }, body: JSON.stringify({ event: { id, type: 'RENEWAL', app_user_id: userId } }) }),
      { webhookSecret: SECRET, revenueCatKey: 'sk_fake' }, gateways(),
    );
    assert.equal((await (await send()).json()).applied, 1);
    assert.equal((await (await send()).json()).duplicate, 1);
  });

  test('caducada (webhook de EXPIRATION): vuelve al plan gratuito', async () => {
    current = premiumUntil(new Date(Date.now() - 864e5).toISOString());
    const response = await handleRevenueCatWebhook(
      new Request('http://x', { method: 'POST', headers: { Authorization: SECRET }, body: JSON.stringify({ event: { id: `exp-${Date.now()}`, type: 'EXPIRATION', app_user_id: userId } }) }),
      { webhookSecret: SECRET, revenueCatKey: 'sk_fake' }, gateways(),
    );
    assert.equal(response.status, 200);
    const plan = await myPlan();
    assert.equal(plan.is_premium, false);
    assert.equal(plan.status, 'expired');
    assert.equal(plan.ai_monthly_limit, 3);
  });
});
