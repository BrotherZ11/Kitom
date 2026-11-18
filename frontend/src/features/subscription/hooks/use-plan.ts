import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { aiKeys } from '@/features/ai-analysis/hooks/use-ai-analysis';
import { useAuth } from '@/features/auth/auth-context';
import { fetchMyPlan, syncSubscription } from '@/features/subscription/api/plan-api';
import type { Plan } from '@/features/subscription/plan-model';
import {
  forgetPurchaser,
  identifyPurchaser,
  loadPlanOptions,
  purchasePlanOption,
  purchasesSupported,
  restorePurchases,
} from '@/features/subscription/purchases';

/** Query keys del plan (por usuario: el plan es de la cuenta). */
export const planKeys = {
  all: ['plan'] as const,
  user: (userId: string) => ['plan', userId] as const,
  options: (userId: string) => ['plan', userId, 'options'] as const,
};

/**
 * Plan de la cuenta (`get_my_plan`). Sin conexión no hay dato (`data` undefined): las pantallas no
 * bloquean nada por el plan y el servidor decide al sincronizar. Sin staleTime: el recuento de mascotas
 * y de consultas cambia con lo que hace el usuario, así que se vuelve a leer al abrir cada pantalla.
 */
export function usePlan() {
  const auth = useAuth();
  const userId = auth.user?.id ?? '';
  return useQuery({
    queryKey: planKeys.user(userId),
    enabled: auth.canUseServer && userId !== '',
    queryFn: () => auth.serverCall(fetchMyPlan),
  });
}

/** Precios de la oferta actual (solo donde se puede comprar). */
export function usePlanOptions() {
  const auth = useAuth();
  const userId = auth.user?.id ?? '';
  return useQuery({
    queryKey: planKeys.options(userId),
    enabled: purchasesSupported && auth.canUseServer && userId !== '',
    queryFn: async () => {
      await identifyPurchaser(userId);
      return loadPlanOptions();
    },
    staleTime: 10 * 60_000,
  });
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Tras comprar o restaurar: el servidor lee el estado en RevenueCat y la app vuelve a leer el plan.
 * Si `subscription-sync` falla, el webhook lo hará igualmente: se reintenta leer el plan unos
 * segundos. Devuelve el plan que diga el servidor (nunca el del SDK).
 */
function useRefreshPlanFromStore() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const userId = auth.user?.id ?? '';
  return async (): Promise<Plan | null> => {
    try {
      await auth.serverCall(syncSubscription);
    } catch {
      // El webhook también actualiza el plan.
    }
    let plan: Plan | null = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        plan = await auth.serverCall(fetchMyPlan);
        queryClient.setQueryData(planKeys.user(userId), plan);
        if (plan.isPremium) break;
      } catch {
        // Se reintenta.
      }
      await wait(1_500);
    }
    void queryClient.invalidateQueries({ queryKey: aiKeys.entitlement(userId) });
    return plan;
  };
}

export function usePurchasePremium() {
  const auth = useAuth();
  const refresh = useRefreshPlanFromStore();
  return useMutation({
    mutationFn: async ({ packages, optionId }: { packages: Map<string, unknown>; optionId: string }) => {
      await identifyPurchaser(auth.user?.id ?? '');
      await purchasePlanOption(packages, optionId);
      return refresh();
    },
  });
}

export function useRestorePurchases() {
  const auth = useAuth();
  const refresh = useRefreshPlanFromStore();
  return useMutation({
    mutationFn: async () => {
      await identifyPurchaser(auth.user?.id ?? '');
      await restorePurchases();
      return refresh();
    },
  });
}

/**
 * Identifica la cuenta en RevenueCat mientras hay sesión, y la olvida al salir de la zona con
 * sesión (cerrar sesión o borrar la cuenta). Montar una sola vez, en `(app)/_layout.tsx`.
 */
export function usePurchaserIdentity() {
  const auth = useAuth();
  const userId = auth.canUseServer ? (auth.user?.id ?? null) : null;
  useEffect(() => {
    if (!userId || !purchasesSupported) return;
    identifyPurchaser(userId).catch(() => {
      // Sin red o tienda no disponible: se reintenta al comprar.
    });
  }, [userId]);
  useEffect(
    () => () => {
      void forgetPurchaser();
    },
    [],
  );
}
