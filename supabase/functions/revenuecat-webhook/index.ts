// =====================================================================
// KITOM · Edge Function revenuecat-webhook
// =====================================================================
// La llama RevenueCat en cada evento de suscripción (compra, renovación,
// cancelación, problema de cobro, caducidad, transferencia…). No aplica el
// evento: lee el estado actual de cada cuenta afectada en la API de
// RevenueCat y lo guarda con apply_subscription_state (service_role).
// Respuestas y lógica: ../_shared/subscription-handlers.ts; contrato:
// docs/README.md §19; configuración: docs/DEPLOYMENT.md §9.
//
// verify_jwt = false (config.toml): RevenueCat no tiene un JWT de Supabase;
// la función exige su propio secreto en Authorization.
// Secretos (supabase secrets set, los pone el usuario; nunca en el repo):
//   REVENUECAT_WEBHOOK_AUTH     ≥ 32 caracteres; el mismo valor en el panel de RevenueCat
//   REVENUECAT_SECRET_API_KEY   clave secreta v1 (sk_…) del proyecto de RevenueCat
//   REVENUECAT_ENTITLEMENT_ID   opcional; por defecto «premium»
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY las da la plataforma.
// =====================================================================
import { handleRevenueCatWebhook, type Log } from '../_shared/subscription-handlers.ts';
import { createApplyStateGateway, createRevenueCatGateway } from '../_shared/subscription-rest.ts';

const log: Log = (event, fields) => console.log(JSON.stringify({ event, ...fields }));

Deno.serve((request) => {
  const revenueCatKey = Deno.env.get('REVENUECAT_SECRET_API_KEY') ?? '';
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  return handleRevenueCatWebhook(
    request,
    {
      webhookSecret: Deno.env.get('REVENUECAT_WEBHOOK_AUTH'),
      entitlementId: Deno.env.get('REVENUECAT_ENTITLEMENT_ID'),
      revenueCatKey: revenueCatKey && url && serviceKey ? revenueCatKey : undefined,
    },
    {
      ...createRevenueCatGateway({ apiKey: revenueCatKey }),
      ...createApplyStateGateway({ url, serviceKey }),
      log,
    },
  );
});
