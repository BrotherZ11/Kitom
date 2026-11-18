import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  allowedRangeDays,
  canCreateOwnedPet,
  errorHint,
  historyStartDate,
  isBeyondHistory,
  parsePaywallReason,
  purchaseErrorCode,
  summarizePlan,
  toPlan,
  toPlanOptions,
} from './plan-model.ts';

const FREE_ROW = {
  plan: 'free', is_premium: false, status: 'active', current_period_end: null, trial_end: null,
  cancel_at_period_end: false, owned_pets: 1, max_owned_pets: 2, history_days: 30,
  can_invite_co_owners: false, ai_monthly_used: 1, ai_monthly_limit: 3,
};
const PREMIUM_ROW = {
  ...FREE_ROW, plan: 'premium', is_premium: true, current_period_end: '2026-12-16T10:00:00Z',
  max_owned_pets: null, history_days: null, can_invite_co_owners: true, ai_monthly_limit: null,
};

describe('toPlan', () => {
  test('plan gratuito con sus límites', () => {
    const plan = toPlan(FREE_ROW);
    assert.equal(plan.isPremium, false);
    assert.equal(plan.maxOwnedPets, 2);
    assert.equal(plan.historyDays, 30);
    assert.equal(plan.aiMonthlyLimit, 3);
    assert.equal(plan.canInviteCoOwners, false);
  });
  test('Premium: límites nulos = sin límite', () => {
    const plan = toPlan(PREMIUM_ROW);
    assert.equal(plan.isPremium, true);
    assert.equal(plan.maxOwnedPets, null);
    assert.equal(plan.historyDays, null);
  });
  test('Premium guardado pero caducado: el efectivo manda', () => {
    const plan = toPlan({ ...FREE_ROW, plan: 'premium', status: 'expired' });
    assert.equal(plan.isPremium, false);
    assert.equal(plan.storedPlan, 'premium');
  });
  test('respuesta vacía o sin is_premium: error (nunca suponer un plan)', () => {
    assert.throws(() => toPlan(undefined), /invalid_plan_response/);
    assert.throws(() => toPlan({ ...FREE_ROW, is_premium: null }), /invalid_plan_response/);
  });
});

describe('límites', () => {
  test('mascotas: hasta el límite, contando las altas locales pendientes', () => {
    const plan = toPlan(FREE_ROW);
    assert.equal(canCreateOwnedPet(plan), true);
    assert.equal(canCreateOwnedPet(plan, 1), false);
    assert.equal(canCreateOwnedPet(toPlan({ ...FREE_ROW, owned_pets: 3 })), false, 'cuentas que ya tenían más');
    assert.equal(canCreateOwnedPet(toPlan(PREMIUM_ROW), 10), true);
    assert.equal(canCreateOwnedPet(null, 5), true, 'sin plan conocido (sin conexión) no se bloquea');
  });

  test('historial: primer día visible contando hoy', () => {
    assert.equal(historyStartDate(toPlan(FREE_ROW), '2026-11-16'), '2026-10-18');
    assert.equal(historyStartDate(toPlan(FREE_ROW), '2026-03-01'), '2026-01-31');
    assert.equal(historyStartDate(toPlan(PREMIUM_ROW), '2026-11-16'), null);
    assert.equal(historyStartDate(null, '2026-11-16'), null);
    assert.equal(isBeyondHistory('2026-10-17', '2026-10-18'), true);
    assert.equal(isBeyondHistory('2026-10-18', '2026-10-18'), false);
    assert.equal(isBeyondHistory('2020-01-01', null), false);
  });

  test('rangos permitidos', () => {
    assert.deepEqual(allowedRangeDays(toPlan(FREE_ROW), [7, 30, 90]), [7, 30]);
    assert.deepEqual(allowedRangeDays(toPlan(PREMIUM_ROW), [7, 30, 90]), [7, 30, 90]);
    assert.deepEqual(allowedRangeDays(null, [7, 30, 90]), [7, 30, 90]);
  });
});

describe('resumen del plan', () => {
  test('cada estado', () => {
    assert.deepEqual(summarizePlan(toPlan(FREE_ROW)), { kind: 'free' });
    assert.deepEqual(summarizePlan(toPlan(PREMIUM_ROW)), { kind: 'renews', on: '2026-12-16T10:00:00Z' });
    assert.deepEqual(summarizePlan(toPlan({ ...PREMIUM_ROW, cancel_at_period_end: true })), { kind: 'ends', on: '2026-12-16T10:00:00Z' });
    assert.deepEqual(summarizePlan(toPlan({ ...PREMIUM_ROW, status: 'past_due' })), { kind: 'billing_issue', until: '2026-12-16T10:00:00Z' });
    assert.deepEqual(
      summarizePlan(toPlan({ ...PREMIUM_ROW, status: 'trialing', trial_end: '2026-11-23T10:00:00Z' })),
      { kind: 'trial', until: '2026-11-23T10:00:00Z', renews: true },
    );
  });
});

describe('compras', () => {
  test('errores de RevenueCat', () => {
    assert.equal(purchaseErrorCode({ code: '1' }), 'cancelled');
    assert.equal(purchaseErrorCode({ code: '0', userCancelled: true }), 'cancelled');
    assert.equal(purchaseErrorCode({ code: '20' }), 'pending');
    assert.equal(purchaseErrorCode({ code: '10' }), 'network');
    assert.equal(purchaseErrorCode({ code: '6' }), 'already_owned');
    assert.equal(purchaseErrorCode({ code: '7' }), 'other_account');
    assert.equal(purchaseErrorCode({ code: '23' }), 'unavailable');
    assert.equal(purchaseErrorCode({ code: '999' }), 'unknown');
    assert.equal(purchaseErrorCode(null), 'unknown');
  });

  test('paquetes: mensual y anual, con precio de la tienda y prueba gratuita', () => {
    const options = toPlanOptions([
      {
        identifier: '$rc_annual', packageType: 'ANNUAL',
        product: { priceString: '39,99 €', pricePerMonthString: '3,33 €', subscriptionPeriod: 'P1Y',
          defaultOption: { freePhase: { billingPeriod: { unit: 'DAY', value: 7 } } } },
      },
      { identifier: '$rc_monthly', packageType: 'MONTHLY', product: { priceString: '4,99 €', subscriptionPeriod: 'P1M' } },
      { identifier: 'lifetime', packageType: 'LIFETIME', product: { priceString: '99 €' } },
    ]);
    assert.deepEqual(options, [
      { id: '$rc_monthly', period: 'month', priceString: '4,99 €', pricePerMonthString: null, trialDays: null },
      { id: '$rc_annual', period: 'year', priceString: '39,99 €', pricePerMonthString: '3,33 €', trialDays: 7 },
    ]);
  });

  test('paquete personalizado reconocido por el periodo; prueba por precio introductorio 0 (iOS)', () => {
    const options = toPlanOptions([
      { identifier: 'anual', packageType: 'CUSTOM',
        product: { priceString: '$39.99', subscriptionPeriod: 'P1Y', introPrice: { price: 0, periodUnit: 'WEEK', periodNumberOfUnits: 1 } } },
      { identifier: 'anual2', packageType: 'ANNUAL', product: { priceString: '$1', subscriptionPeriod: 'P1Y' } },
    ]);
    assert.equal(options.length, 1, 'un solo anual');
    assert.equal(options[0].trialDays, 7);
  });

  test('motivo de la pantalla y hint de error', () => {
    assert.equal(parsePaywallReason('ai'), 'ai');
    assert.equal(parsePaywallReason('lo-que-sea'), 'settings');
    assert.equal(errorHint({ hint: 'pet_limit_reached' }), 'pet_limit_reached');
    assert.equal(errorHint({ hint: '' }), null);
    assert.equal(errorHint('x'), null);
  });
});
