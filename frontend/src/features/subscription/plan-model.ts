/**
 * Kitom Premium: modelo puro del plan y de las compras (sin React, red ni RevenueCat; probado con
 * `npm test`, `plan-model.test.mjs`).
 *
 * El plan y sus límites los decide el servidor (`get_my_plan`, migración *_premium_plans): la app
 * solo los muestra y oculta o bloquea lo que el servidor ya rechazaría. Contrato:
 * `docs/FRONTEND_ARCHITECTURE.md` «PaywallScreen».
 */

/**
 * Copia, solo para textos sin conexión, de `private.free_plan_limits().max_owned_pets`. Con conexión
 * manda `Plan.maxOwnedPets` (lo que diga el servidor).
 */
export const FREE_MAX_OWNED_PETS = 2;

export type PlanStatus ='active' | 'trialing' | 'past_due' | 'canceled' | 'expired';

export type Plan = {
  isPremium: boolean;
  /** Plan guardado (puede ser `premium` caducado: `isPremium` es el efectivo). */
  storedPlan: 'free' | 'premium';
  status: PlanStatus;
  currentPeriodEnd: string | null;
  trialEnd: string | null;
  cancelAtPeriodEnd: boolean;
  ownedPets: number;
  /** `null` = sin límite. */
  maxOwnedPets: number | null;
  historyDays: number | null;
  canInviteCoOwners: boolean;
  aiMonthlyUsed: number;
  aiMonthlyLimit: number | null;
};

/** Fila de `get_my_plan` tal como llega de PostgREST (los nulos, como `null`). */
export type PlanRow = {
  plan: string | null;
  is_premium: boolean | null;
  status: string | null;
  current_period_end: string | null;
  trial_end: string | null;
  cancel_at_period_end: boolean | null;
  owned_pets: number | null;
  max_owned_pets: number | null;
  history_days: number | null;
  can_invite_co_owners: boolean | null;
  ai_monthly_used: number | null;
  ai_monthly_limit: number | null;
};

const STATUSES: readonly PlanStatus[] = ['active', 'trialing', 'past_due', 'canceled', 'expired'];

export class InvalidPlanResponse extends Error {
  constructor() {
    super('invalid_plan_response');
  }
}

export function toPlan(row: PlanRow | null | undefined): Plan {
  if (!row || typeof row.is_premium !== 'boolean') throw new InvalidPlanResponse();
  const status = STATUSES.includes(row.status as PlanStatus) ? (row.status as PlanStatus) : 'active';
  return {
    isPremium: row.is_premium,
    storedPlan: row.plan === 'premium' ? 'premium' : 'free',
    status,
    currentPeriodEnd: row.current_period_end ?? null,
    trialEnd: row.trial_end ?? null,
    cancelAtPeriodEnd: row.cancel_at_period_end === true,
    ownedPets: row.owned_pets ?? 0,
    maxOwnedPets: row.max_owned_pets ?? null,
    historyDays: row.history_days ?? null,
    canInviteCoOwners: row.can_invite_co_owners === true,
    aiMonthlyUsed: row.ai_monthly_used ?? 0,
    aiMonthlyLimit: row.ai_monthly_limit ?? null,
  };
}

/**
 * ¿Puede crear otra mascota propia? Sin plan conocido (sin conexión) no se bloquea: el servidor
 * decide al sincronizar (`pet_limit_reached`). `pendingLocalCreates` = altas guardadas en el
 * dispositivo que aún no llegaron al servidor.
 */
export function canCreateOwnedPet(plan: Plan | null | undefined, pendingLocalCreates = 0): boolean {
  if (!plan || plan.maxOwnedPets === null) return true;
  return plan.ownedPets + pendingLocalCreates < plan.maxOwnedPets;
}

/**
 * Primer día (`YYYY-MM-DD`) que el plan deja ver del historial, contando hoy: con 30 días y hoy
 * 2026-11-16, el 2026-10-18. `null` = todo el historial (Premium o plan aún desconocido).
 */
export function historyStartDate(plan: Plan | null | undefined, today: string): string | null {
  if (!plan || plan.historyDays === null) return null;
  const [y, m, d] = today.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, d - (plan.historyDays - 1)));
  return start.toISOString().slice(0, 10);
}

/** ¿Queda fuera del historial visible? (Comparación de fechas `YYYY-MM-DD` como texto.) */
export function isBeyondHistory(date: string, start: string | null): boolean {
  return start !== null && date < start;
}

/** Rangos de días (resumen, evolución) que el plan deja elegir. */
export function allowedRangeDays<T extends number>(plan: Plan | null | undefined, ranges: readonly T[]): T[] {
  if (!plan || plan.historyDays === null) return [...ranges];
  const limit = plan.historyDays;
  return ranges.filter((days) => days <= limit);
}

/** Motivo por el que se abre la pantalla de Premium (texto de cabecera y analítica futura). */
export type PaywallReason = 'ai' | 'pets' | 'history' | 'co_owners' | 'settings';

const REASONS: readonly PaywallReason[] = ['ai', 'pets', 'history', 'co_owners', 'settings'];

export function parsePaywallReason(value: unknown): PaywallReason {
  return REASONS.includes(value as PaywallReason) ? (value as PaywallReason) : 'settings';
}

/** Estado de la suscripción para Ajustes y la pantalla de Premium. */
export type PlanSummary =
  | { kind: 'free' }
  | { kind: 'trial'; until: string | null; renews: boolean }
  | { kind: 'renews'; on: string | null }
  | { kind: 'ends'; on: string | null }
  | { kind: 'billing_issue'; until: string | null };

export function summarizePlan(plan: Plan): PlanSummary {
  if (!plan.isPremium) return { kind: 'free' };
  if (plan.status === 'past_due') return { kind: 'billing_issue', until: plan.currentPeriodEnd };
  if (plan.status === 'trialing') return { kind: 'trial', until: plan.trialEnd ?? plan.currentPeriodEnd, renews: !plan.cancelAtPeriodEnd };
  if (plan.cancelAtPeriodEnd) return { kind: 'ends', on: plan.currentPeriodEnd };
  return { kind: 'renews', on: plan.currentPeriodEnd };
}

// ---------------------------------------------------------------------------------------------
// Compras (RevenueCat): errores y paquetes, sin depender del SDK
// ---------------------------------------------------------------------------------------------

export type PurchaseErrorCode =
  | 'cancelled'
  | 'pending'
  | 'network'
  | 'not_allowed'
  | 'already_owned'
  | 'other_account'
  | 'unavailable'
  | 'unknown';

/** Códigos de `PURCHASES_ERROR_CODE` (react-native-purchases 11) que la app distingue. */
const RC_CODES: Record<string, PurchaseErrorCode> = {
  '1': 'cancelled',
  '2': 'unavailable',
  '3': 'not_allowed',
  '5': 'unavailable',
  '6': 'already_owned',
  '7': 'other_account',
  '10': 'network',
  '13': 'other_account',
  '20': 'pending',
  '23': 'unavailable',
  '24': 'unavailable',
  '35': 'network',
  '40': 'other_account',
};

export function purchaseErrorCode(error: unknown): PurchaseErrorCode {
  if (typeof error !== 'object' || error === null) return 'unknown';
  const e = error as { code?: unknown; userCancelled?: unknown };
  if (e.userCancelled === true) return 'cancelled';
  const code = typeof e.code === 'string' || typeof e.code === 'number' ? String(e.code) : '';
  return RC_CODES[code] ?? 'unknown';
}

export type PackagePeriod = 'month' | 'year';

/** Lo que la pantalla necesita de un paquete de RevenueCat (precio siempre el de la tienda). */
export type PlanOption = {
  id: string;
  period: PackagePeriod;
  priceString: string;
  /** Precio por mes en la moneda de la tienda, para el anual. */
  pricePerMonthString: string | null;
  /** Días de prueba gratuita, si la tienda la ofrece a esta cuenta. */
  trialDays: number | null;
};

type PeriodLike = { unit?: unknown; value?: unknown } | null | undefined;

/** Subconjunto de `PurchasesPackage` que se usa (para probar sin el SDK). */
export type PackageLike = {
  identifier: string;
  packageType?: unknown;
  product: {
    priceString: string;
    pricePerMonthString?: string | null;
    subscriptionPeriod?: string | null;
    defaultOption?: { freePhase?: { billingPeriod?: PeriodLike } | null } | null;
    introPrice?: { price?: number; periodUnit?: unknown; periodNumberOfUnits?: unknown } | null;
  };
};

function periodDays(period: PeriodLike): number | null {
  if (!period || typeof period.value !== 'number') return null;
  switch (period.unit) {
    case 'DAY':
      return period.value;
    case 'WEEK':
      return period.value * 7;
    case 'MONTH':
      return period.value * 30;
    default:
      return null;
  }
}

function periodOf(pkg: PackageLike): PackagePeriod | null {
  if (pkg.packageType === 'MONTHLY') return 'month';
  if (pkg.packageType === 'ANNUAL') return 'year';
  // ISO 8601 de la tienda: P1M, P1Y (también P12M).
  const iso = pkg.product.subscriptionPeriod ?? '';
  if (iso === 'P1M') return 'month';
  if (iso === 'P1Y' || iso === 'P12M') return 'year';
  return null;
}

/** Opciones mensual y anual (en ese orden) de la oferta actual; ignora el resto de paquetes. */
export function toPlanOptions(packages: readonly PackageLike[]): PlanOption[] {
  const options: PlanOption[] = [];
  for (const pkg of packages) {
    const period = periodOf(pkg);
    if (!period || options.some((o) => o.period === period)) continue;
    const freeDays = periodDays(pkg.product.defaultOption?.freePhase?.billingPeriod);
    const intro = pkg.product.introPrice;
    const introDays =
      intro && intro.price === 0
        ? periodDays({ unit: intro.periodUnit, value: intro.periodNumberOfUnits })
        : null;
    options.push({
      id: pkg.identifier,
      period,
      priceString: pkg.product.priceString,
      pricePerMonthString: period === 'year' ? (pkg.product.pricePerMonthString ?? null) : null,
      trialDays: freeDays ?? introDays,
    });
  }
  return options.sort((a, b) => (a.period === b.period ? 0 : a.period === 'month' ? -1 : 1));
}

/** Pista de error de Postgres (`hint`) de una respuesta de PostgREST o de un error de la app. */
export function errorHint(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const hint = (error as { hint?: unknown }).hint;
  return typeof hint === 'string' && hint !== '' ? hint : null;
}
