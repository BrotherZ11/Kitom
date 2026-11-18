// =====================================================================
// KITOM · Edge Function delete-account
// =====================================================================
// Borra la cuenta del usuario del JWT (la llama la app desde Ajustes ›
// Eliminar cuenta). POST con el JWT del usuario en Authorization:
//   { "mode": "preview" }  → 200 { status: 'preview', plan }
//   { "mode": "delete", "confirm": "DELETE", "expected": [...] }
//                          → 200 { status: 'deleted', transferred, deleted, avatars_removed }
// Errores ({ error: <código> }): 401 not_authenticated · 410 account_not_found
// · 400 invalid_request · 409 plan_changed (+ plan) | too_many_pets · 500
// server_misconfigured | server_error | deletion_incomplete (+ step y
// recuentos; repetir converge). Contrato: docs/README.md §12.
//
// La pasarela verifica el JWT (config.toml: verify_jwt por defecto, true).
// SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY las da la
// plataforma; REVENUECAT_SECRET_API_KEY es opcional (borra el cliente de RevenueCat). Lógica y pruebas: deletion.ts,
// rest.ts y sus *.test.mjs; contra el Supabase local: run-integration.mjs.
// =====================================================================
import { handleDeleteAccountRequest, type Log } from './deletion.ts';
import { createRestAdmin, createRestAuth, createRestBilling, createRestUserGateway } from './rest.ts';

const log: Log = (event, fields) => console.log(JSON.stringify({ event, ...fields }));
const revenueCatKey = Deno.env.get('REVENUECAT_SECRET_API_KEY') ?? '';

Deno.serve((request) =>
  handleDeleteAccountRequest(
    request,
    {
      supabaseUrl: Deno.env.get('SUPABASE_URL'),
      anonKey: Deno.env.get('SUPABASE_ANON_KEY'),
      serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    },
    ({ url, anonKey, serviceKey, token }) => ({
      auth: createRestAuth({ url, apiKey: anonKey }),
      user: createRestUserGateway({ url, apiKey: anonKey, token }),
      admin: createRestAdmin({ url, apiKey: serviceKey }),
      // Kitom Premium: solo si el proyecto tiene RevenueCat configurado.
      billing: revenueCatKey ? createRestBilling({ url: 'https://api.revenuecat.com', apiKey: revenueCatKey }) : undefined,
      log,
    }),
    log,
  ),
);
