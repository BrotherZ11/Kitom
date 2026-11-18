import { supabase } from '@/lib/supabase';
import { toPlan, type Plan, type PlanRow } from '@/features/subscription/plan-model';

/** Plan y límites de la cuenta (RPC `get_my_plan`, siempre sobre `auth.uid()`). */
export async function fetchMyPlan(): Promise<Plan> {
  const { data, error } = await supabase.rpc('get_my_plan');
  if (error) throw error;
  return toPlan((data?.[0] ?? null) as PlanRow | null);
}

/**
 * Pide a `subscription-sync` que lea en RevenueCat el estado de la cuenta y lo guarde (tras comprar o
 * restaurar, para no esperar al webhook). La respuesta no se usa para decidir nada: después se
 * vuelve a leer `get_my_plan`.
 */
export async function syncSubscription(): Promise<void> {
  const { error } = await supabase.functions.invoke('subscription-sync', { body: {} });
  if (error) throw error;
}
