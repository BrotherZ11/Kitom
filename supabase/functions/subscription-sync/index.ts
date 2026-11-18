// =====================================================================
// KITOM · Edge Function subscription-sync
// =====================================================================
// La llama la app justo después de comprar o restaurar Premium, para no
// esperar al webhook: lee en RevenueCat el estado del usuario del JWT (nunca
// de uno que venga en el cuerpo) y lo guarda con apply_subscription_state.
// La app nunca decide el plan: después vuelve a leer get_my_plan().
// Respuestas y lógica: ../_shared/subscription-handlers.ts; contrato:
// docs/README.md §19.
//
// verify_jwt = true (config.toml) y la función vuelve a comprobar el JWT con Auth.
// Secretos: REVENUECAT_SECRET_API_KEY (y REVENUECAT_ENTITLEMENT_ID opcional), los
// mismos que revenuecat-webhook. SUPABASE_URL, SUPABASE_ANON_KEY y
// SUPABASE_SERVICE_ROLE_KEY las da la plataforma.
// =====================================================================
import { handleSubscriptionSync, type Log } from '../_shared/subscription-handlers.ts';
import { createApplyStateGateway, createAuthGateway, createRevenueCatGateway } from '../_shared/subscription-rest.ts';

const log: Log = (event, fields) => console.log(JSON.stringify({ event, ...fields }));

Deno.serve((request) => {
  const revenueCatKey = Deno.env.get('REVENUECAT_SECRET_API_KEY') ?? '';
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  return handleSubscriptionSync(
    request,
    {
      entitlementId: Deno.env.get('REVENUECAT_ENTITLEMENT_ID'),
      revenueCatKey: revenueCatKey && url && anonKey && serviceKey ? revenueCatKey : undefined,
    },
    {
      ...createRevenueCatGateway({ apiKey: revenueCatKey }),
      ...createApplyStateGateway({ url, serviceKey }),
      ...createAuthGateway({ url, anonKey }),
      log,
    },
  );
});
