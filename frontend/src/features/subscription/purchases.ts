import type * as PurchasesModule from 'react-native-purchases';
import { NativeModules, Platform } from 'react-native';

import { toPlanOptions, type PackageLike, type PlanOption } from '@/features/subscription/plan-model';

/**
 * Compras de Kitom Premium con RevenueCat (`react-native-purchases`). Solo en una build nativa de
 * Android o iOS con su clave pública (`EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY` /
 * `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY`, claves de SDK que pueden ir en el bundle). En web, Expo Go o
 * sin clave, `purchasesUnavailableReason` dice por qué y la pantalla de Premium no ofrece comprar.
 *
 * El SDK se carga con `require` dentro de `try` (como `expo-notifications`): si falta la parte nativa,
 * la app sigue funcionando. La app nunca decide el plan con lo que diga el SDK: tras comprar o
 * restaurar llama a `subscription-sync` y vuelve a leer `get_my_plan` (RLS/RPC son la autoridad).
 */

type Purchases = typeof PurchasesModule;

const ANDROID_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY ?? '';
const IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY ?? '';

function apiKey(): string {
  if (Platform.OS === 'android') return ANDROID_KEY;
  if (Platform.OS === 'ios') return IOS_KEY;
  return '';
}

/** Por qué no se puede comprar aquí (`null` = sí se puede). */
export const purchasesUnavailableReason: 'web' | 'unsupported_build' | 'not_configured' | null =
  Platform.OS !== 'android' && Platform.OS !== 'ios'
    ? 'web'
    : !NativeModules.RNPurchases
      ? 'unsupported_build'
      : apiKey() === ''
        ? 'not_configured'
        : null;

export const purchasesSupported = purchasesUnavailableReason === null;

let loaded: Purchases | null | undefined;

function load(): Purchases | null {
  if (loaded !== undefined) return loaded;
  if (!purchasesSupported) {
    loaded = null;
    return loaded;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    loaded = require('react-native-purchases') as Purchases;
  } catch (error) {
    if (__DEV__) console.warn('[purchases] no disponibles en este entorno', error);
    loaded = null;
  }
  return loaded;
}

function sdk(): Purchases['default'] {
  const module = load();
  if (!module) throw Object.assign(new Error('purchases_unavailable'), { code: '23' });
  return module.default;
}

let configuredFor: string | null = null;
let configured = false;

/**
 * Identifica al usuario de Kitom en RevenueCat (su id de Supabase: así el webhook sabe de quién es
 * cada compra). Configura el SDK la primera vez; después, `logIn` al cambiar de cuenta.
 */
export async function identifyPurchaser(userId: string): Promise<void> {
  if (!purchasesSupported || configuredFor === userId) return;
  const Purchases = sdk();
  if (!configured) {
    Purchases.configure({ apiKey: apiKey(), appUserID: userId });
    configured = true;
  } else {
    await Purchases.logIn(userId);
  }
  configuredFor = userId;
}

/** Al cerrar sesión: que la siguiente cuenta no herede el cliente de RevenueCat de la anterior. */
export async function forgetPurchaser(): Promise<void> {
  if (!purchasesSupported || !configured || configuredFor === null) return;
  configuredFor = null;
  try {
    await sdk().logOut();
  } catch {
    // logOut falla si el cliente ya era anónimo: no hay nada que olvidar.
  }
}

type OfferingPackages = { options: PlanOption[]; packages: Map<string, unknown> };

/** Paquetes de la oferta actual (mensual y anual) con el precio de la tienda. */
export async function loadPlanOptions(): Promise<OfferingPackages> {
  const offerings = await sdk().getOfferings();
  const packages = offerings.current?.availablePackages ?? [];
  return {
    options: toPlanOptions(packages as unknown as PackageLike[]),
    packages: new Map(packages.map((pkg) => [pkg.identifier, pkg])),
  };
}

export async function purchasePlanOption(packages: Map<string, unknown>, optionId: string): Promise<void> {
  const pkg = packages.get(optionId);
  if (!pkg) throw Object.assign(new Error('package_not_found'), { code: '5' });
  await sdk().purchasePackage(pkg as Parameters<Purchases['default']['purchasePackage']>[0]);
}

export async function restorePurchases(): Promise<void> {
  await sdk().restorePurchases();
}

/** Enlace de la tienda para gestionar o cancelar la suscripción (si RevenueCat lo da). */
export async function managementUrl(): Promise<string | null> {
  if (!purchasesSupported) return null;
  try {
    return (await sdk().getCustomerInfo()).managementURL ?? null;
  } catch {
    return null;
  }
}
