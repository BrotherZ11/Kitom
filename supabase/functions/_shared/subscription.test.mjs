// Pruebas de la lógica de suscripciones (sin Deno ni red):
//   node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON supabase/functions/_shared/subscription.test.mjs
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { handleRevenueCatWebhook, handleSubscriptionSync, ProviderError } from './subscription-handlers.ts';
import { createApplyStateGateway, createAuthGateway, createRevenueCatGateway } from './subscription-rest.ts';
import { isAuthorizedWebhook, parseWebhookEvent, stateFromSubscriber, timingSafeEqual } from './subscription-state.ts';

const NOW = new Date('2026-11-16T12:00:00Z');
const USER = '6a2f8a8e-3b1c-4c55-9d7e-0a1b2c3d4e5f';
const OTHER = '7b3f8a8e-3b1c-4c55-9d7e-0a1b2c3d4e5f';
const SECRET = 'x'.repeat(40);

function subscriber({ entitlement, product, requestDate = '2026-11-16T12:00:00Z' } = {}) {
  return {
    request_date: requestDate,
    subscriber: {
      entitlements: entitlement ? { premium: entitlement } : {},
      subscriptions: product ? { 'kitom_premium:annual': product } : {},
    },
  };
}

const ACTIVE_ENTITLEMENT = {
  product_identifier: 'kitom_premium:annual',
  purchase_date: '2026-11-01T10:00:00Z',
  expires_date: '2027-11-01T10:00:00Z',
};
const ACTIVE_PRODUCT = {
  purchase_date: '2026-11-01T10:00:00Z',
  expires_date: '2027-11-01T10:00:00Z',
  period_type: 'normal',
  store: 'play_store',
  is_sandbox: true,
  store_transaction_id: 'GPA.1234-5678',
};

describe('stateFromSubscriber', () => {
  test('sin el entitlement: plan gratuito con el estado por defecto', () => {
    const state = stateFromSubscriber(subscriber(), 'premium', NOW);
    assert.equal(state.isPremium, false);
    assert.equal(state.status, 'active');
    assert.equal(state.providerSubscriptionId, null);
    assert.equal(state.stateAt, '2026-11-16T12:00:00.000Z');
  });

  test('suscripción activa', () => {
    const state = stateFromSubscriber(subscriber({ entitlement: ACTIVE_ENTITLEMENT, product: ACTIVE_PRODUCT }), 'premium', NOW);
    assert.equal(state.isPremium, true);
    assert.equal(state.status, 'active');
    assert.equal(state.currentPeriodEnd, '2027-11-01T10:00:00.000Z');
    assert.equal(state.cancelAtPeriodEnd, false);
    assert.equal(state.providerSubscriptionId, 'GPA.1234-5678');
    assert.equal(state.trialEnd, null);
    assert.deepEqual(state.rawPayload.store, 'play_store');
  });

  test('en prueba gratuita: trialing con trial_end', () => {
    const state = stateFromSubscriber(
      subscriber({ entitlement: { ...ACTIVE_ENTITLEMENT, expires_date: '2026-11-20T10:00:00Z' }, product: { ...ACTIVE_PRODUCT, period_type: 'trial' } }),
      'premium', NOW,
    );
    assert.equal(state.status, 'trialing');
    assert.equal(state.trialEnd, '2026-11-20T10:00:00.000Z');
  });

  test('cancelada dentro del periodo: sigue Premium, sin renovación', () => {
    const state = stateFromSubscriber(
      subscriber({ entitlement: ACTIVE_ENTITLEMENT, product: { ...ACTIVE_PRODUCT, unsubscribe_detected_at: '2026-11-10T00:00:00Z' } }),
      'premium', NOW,
    );
    assert.equal(state.isPremium, true);
    assert.equal(state.cancelAtPeriodEnd, true);
  });

  test('caducada: no Premium y expired', () => {
    const state = stateFromSubscriber(
      subscriber({ entitlement: { ...ACTIVE_ENTITLEMENT, expires_date: '2026-11-15T10:00:00Z' }, product: { ...ACTIVE_PRODUCT, unsubscribe_detected_at: '2026-11-01T11:00:00Z' } }),
      'premium', NOW,
    );
    assert.equal(state.isPremium, false);
    assert.equal(state.status, 'expired');
    assert.equal(state.cancelAtPeriodEnd, false);
  });

  test('problema de cobro en periodo de gracia: Premium y past_due hasta el fin de la gracia', () => {
    const state = stateFromSubscriber(
      subscriber({
        entitlement: { ...ACTIVE_ENTITLEMENT, expires_date: '2026-11-15T10:00:00Z', grace_period_expires_date: '2026-11-22T10:00:00Z' },
        product: { ...ACTIVE_PRODUCT, billing_issues_detected_at: '2026-11-15T10:00:00Z' },
      }),
      'premium', NOW,
    );
    assert.equal(state.isPremium, true);
    assert.equal(state.status, 'past_due');
    assert.equal(state.currentPeriodEnd, '2026-11-22T10:00:00.000Z');
  });

  test('se compara con la hora de RevenueCat, no con la de la función', () => {
    const state = stateFromSubscriber(
      subscriber({ entitlement: { ...ACTIVE_ENTITLEMENT, expires_date: '2026-11-16T12:30:00Z' }, product: ACTIVE_PRODUCT, requestDate: '2026-11-16T12:00:00Z' }),
      'premium', new Date('2026-11-16T13:00:00Z'),
    );
    assert.equal(state.isPremium, true);
  });

  test('otro entitlement no cuenta', () => {
    const body = subscriber({ entitlement: ACTIVE_ENTITLEMENT, product: ACTIVE_PRODUCT });
    assert.equal(stateFromSubscriber(body, 'pro', NOW).isPremium, false);
  });

  test('no guarda atributos del cliente', () => {
    const body = subscriber({ entitlement: ACTIVE_ENTITLEMENT, product: ACTIVE_PRODUCT });
    body.subscriber.subscriber_attributes = { $email: { value: 'alguien@example.com' } };
    const state = stateFromSubscriber(body, 'premium', NOW);
    assert.ok(!JSON.stringify(state).includes('alguien@example.com'));
  });

  test('respuesta sin subscriber: error de proveedor', () => {
    assert.throws(() => stateFromSubscriber({}, 'premium', NOW), /invalid_provider_response/);
    assert.throws(() => stateFromSubscriber(null, 'premium', NOW), /invalid_provider_response/);
  });
});

describe('parseWebhookEvent', () => {
  test('reúne las cuentas de Kitom (UUID) sin repetir y descarta ids anónimos', () => {
    const event = parseWebhookEvent({
      event: {
        id: 'evt-1', type: 'TRANSFER', environment: 'SANDBOX',
        app_user_id: '$RCAnonymousID:abc', original_app_user_id: USER.toUpperCase(),
        aliases: [USER, '$RCAnonymousID:abc'], transferred_from: [USER], transferred_to: [OTHER],
      },
    });
    assert.deepEqual(event.userIds, [USER, OTHER]);
    assert.equal(event.environment, 'SANDBOX');
  });

  test('sin id o tipo: null', () => {
    assert.equal(parseWebhookEvent({ event: { type: 'RENEWAL' } }), null);
    assert.equal(parseWebhookEvent({}), null);
    assert.equal(parseWebhookEvent('x'), null);
  });
});

describe('secreto del webhook', () => {
  test('acepta el valor tal cual o con Bearer; rechaza el resto', () => {
    assert.equal(isAuthorizedWebhook(SECRET, SECRET), true);
    assert.equal(isAuthorizedWebhook(`Bearer ${SECRET}`, SECRET), true);
    assert.equal(isAuthorizedWebhook(`${SECRET}y`, SECRET), false);
    assert.equal(isAuthorizedWebhook(null, SECRET), false);
  });
  test('un secreto corto no vale nunca', () => {
    assert.equal(isAuthorizedWebhook('corto', 'corto'), false);
  });
  test('timingSafeEqual', () => {
    assert.equal(timingSafeEqual('abc', 'abc'), true);
    assert.equal(timingSafeEqual('abc', 'abd'), false);
    assert.equal(timingSafeEqual('abc', 'abcd'), false);
  });
});

function fakeGateways({ subscribers = {}, results = {}, failFetch = false } = {}) {
  const applied = [];
  const logs = [];
  return {
    applied,
    logs,
    now: () => NOW,
    log: (event, fields) => logs.push({ event, ...fields }),
    async fetchSubscriber(userId) {
      if (failFetch) throw new ProviderError('network');
      return subscribers[userId] ?? subscriber();
    },
    async applyState(userId, sourceEventId, eventType, state) {
      applied.push({ userId, sourceEventId, eventType, isPremium: state.isPremium, status: state.status });
      return results[userId] ?? 'applied';
    },
    async getUserId(token) {
      return token === 'good-token' ? USER : null;
    },
  };
}

function webhookRequest(body, auth = SECRET, method = 'POST') {
  return new Request('http://localhost/revenuecat-webhook', {
    method,
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
}

const CONFIG = { webhookSecret: SECRET, revenueCatKey: 'sk_test' };

describe('revenuecat-webhook', () => {
  test('aplica el estado leído de RevenueCat a cada cuenta, con id de evento por cuenta', async () => {
    const gateways = fakeGateways({ subscribers: { [USER]: subscriber({ entitlement: ACTIVE_ENTITLEMENT, product: ACTIVE_PRODUCT }) } });
    const response = await handleRevenueCatWebhook(
      webhookRequest({ event: { id: 'evt-9', type: 'TRANSFER', transferred_from: [OTHER], transferred_to: [USER] } }),
      CONFIG, gateways,
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'processed', applied: 2, duplicate: 0, stale: 0, unknown_user: 0 });
    assert.deepEqual(gateways.applied.map((a) => [a.userId, a.sourceEventId, a.isPremium]), [
      [OTHER, `evt-9:${OTHER}`, false],
      [USER, `evt-9:${USER}`, true],
    ]);
  });

  test('sin el secreto: 401 y nada aplicado', async () => {
    const gateways = fakeGateways();
    const response = await handleRevenueCatWebhook(webhookRequest({ event: { id: 'e', type: 'RENEWAL', app_user_id: USER } }, 'Bearer otro'), CONFIG, gateways);
    assert.equal(response.status, 401);
    assert.equal(gateways.applied.length, 0);
  });

  test('sin configurar: 500 server_misconfigured (antes de mirar el secreto)', async () => {
    const response = await handleRevenueCatWebhook(webhookRequest({}), { webhookSecret: SECRET }, fakeGateways());
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'server_misconfigured' });
  });

  test('evento de prueba o sin cuenta de Kitom: 200 ignored', async () => {
    for (const event of [{ id: 'e', type: 'TEST', app_user_id: USER }, { id: 'e', type: 'RENEWAL', app_user_id: '$RCAnonymousID:1' }]) {
      const gateways = fakeGateways();
      const response = await handleRevenueCatWebhook(webhookRequest({ event }), CONFIG, gateways);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { status: 'ignored' });
      assert.equal(gateways.applied.length, 0);
    }
  });

  test('cuerpo inválido: 400; otro método: 405', async () => {
    assert.equal((await handleRevenueCatWebhook(webhookRequest({ nada: 1 }), CONFIG, fakeGateways())).status, 400);
    const bad = new Request('http://localhost/x', { method: 'POST', headers: { Authorization: SECRET }, body: '{' });
    assert.equal((await handleRevenueCatWebhook(bad, CONFIG, fakeGateways())).status, 400);
    assert.equal((await handleRevenueCatWebhook(webhookRequest(null, SECRET, 'GET'), CONFIG, fakeGateways())).status, 405);
  });

  test('RevenueCat no responde: 500 para que reintente', async () => {
    const response = await handleRevenueCatWebhook(
      webhookRequest({ event: { id: 'e', type: 'RENEWAL', app_user_id: USER } }), CONFIG, fakeGateways({ failFetch: true }),
    );
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'provider_unavailable' });
  });

  test('cuenta borrada: unknown_user con 200 (no reintentar para siempre)', async () => {
    const response = await handleRevenueCatWebhook(
      webhookRequest({ event: { id: 'e', type: 'EXPIRATION', app_user_id: USER } }), CONFIG, fakeGateways({ results: { [USER]: 'unknown_user' } }),
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).unknown_user, 1);
  });
});

function syncRequest(token) {
  return new Request('http://localhost/subscription-sync', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {} });
}

describe('subscription-sync', () => {
  test('el usuario sale del JWT y se guarda su estado', async () => {
    const gateways = fakeGateways({ subscribers: { [USER]: subscriber({ entitlement: ACTIVE_ENTITLEMENT, product: ACTIVE_PRODUCT }) } });
    const response = await handleSubscriptionSync(syncRequest('good-token'), { revenueCatKey: 'sk' }, gateways);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'applied' });
    assert.equal(gateways.applied[0].userId, USER);
    assert.equal(gateways.applied[0].eventType, 'SYNC');
    assert.equal(gateways.applied[0].sourceEventId, `sync:${USER}:2026-11-16T12:00:00.000Z`);
  });

  test('sin JWT válido: 401', async () => {
    for (const token of [null, 'bad']) {
      const gateways = fakeGateways();
      const response = await handleSubscriptionSync(syncRequest(token), { revenueCatKey: 'sk' }, gateways);
      assert.equal(response.status, 401);
      assert.equal(gateways.applied.length, 0);
    }
  });

  test('RevenueCat no responde: 502', async () => {
    const response = await handleSubscriptionSync(syncRequest('good-token'), { revenueCatKey: 'sk' }, fakeGateways({ failFetch: true }));
    assert.equal(response.status, 502);
  });

  test('sin clave de RevenueCat: 500 server_misconfigured', async () => {
    const response = await handleSubscriptionSync(syncRequest('good-token'), {}, fakeGateways());
    assert.equal(response.status, 500);
  });
});

describe('adaptadores HTTP', () => {
  test('RevenueCat: GET del suscriptor con la clave secreta; 404 y errores como ProviderError', async () => {
    const calls = [];
    const gateway = createRevenueCatGateway({
      apiKey: 'sk_123',
      fetch: async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ subscriber: {} }), { status: 200 });
      },
    });
    assert.deepEqual(await gateway.fetchSubscriber(USER), { subscriber: {} });
    assert.equal(calls[0].url, `https://api.revenuecat.com/v1/subscribers/${USER}`);
    assert.equal(calls[0].init.headers.Authorization, 'Bearer sk_123');

    const notFound = createRevenueCatGateway({ apiKey: 'k', fetch: async () => new Response('', { status: 404 }) });
    await assert.rejects(() => notFound.fetchSubscriber(USER), /provider_not_found/);
    const down = createRevenueCatGateway({ apiKey: 'k', fetch: async () => { throw new Error('x'); } });
    await assert.rejects(() => down.fetchSubscriber(USER), /provider_network/);
  });

  test('apply_subscription_state por PostgREST con la clave de servicio', async () => {
    let seen;
    const gateway = createApplyStateGateway({
      url: 'http://127.0.0.1:54321/',
      serviceKey: 'service',
      fetch: async (url, init) => {
        seen = { url, init, body: JSON.parse(init.body) };
        return new Response(JSON.stringify('applied'), { status: 200 });
      },
    });
    const state = stateFromSubscriber(subscriber({ entitlement: ACTIVE_ENTITLEMENT, product: ACTIVE_PRODUCT }), 'premium', NOW);
    assert.equal(await gateway.applyState(USER, 'evt', 'RENEWAL', state), 'applied');
    assert.equal(seen.url, 'http://127.0.0.1:54321/rest/v1/rpc/apply_subscription_state');
    assert.equal(seen.init.headers.Authorization, 'Bearer service');
    assert.equal(seen.body.p_user_id, USER);
    assert.equal(seen.body.p_is_premium, true);
    assert.equal(seen.body.p_status, 'active');

    const failing = createApplyStateGateway({ url: 'http://x', serviceKey: 's', fetch: async () => new Response('{}', { status: 500 }) });
    await assert.rejects(() => failing.applyState(USER, 'e', 'T', state), /database_error/);
    const weird = createApplyStateGateway({ url: 'http://x', serviceKey: 's', fetch: async () => new Response('"otra"', { status: 200 }) });
    await assert.rejects(() => weird.applyState(USER, 'e', 'T', state), /database_error/);
  });

  test('Auth: id del usuario del JWT o null', async () => {
    const ok = createAuthGateway({ url: 'http://x', anonKey: 'a', fetch: async () => new Response(JSON.stringify({ id: USER }), { status: 200 }) });
    assert.equal(await ok.getUserId('t'), USER);
    const no = createAuthGateway({ url: 'http://x', anonKey: 'a', fetch: async () => new Response('{}', { status: 401 }) });
    assert.equal(await no.getUserId('t'), null);
  });
});
