// Pruebas de integración (solo contra el Supabase LOCAL, `npm run test:integration`): desde la migración
// *_premium_plans (2026-11-16), sin Premium una cuenta no puede tener más de 2 mascotas propias ni
// invitar co-tutores. Las suites que no tratan del plan hacen Premium a sus cuentas de prueba con esto.
// El plan gratuito se prueba en `supabase/tests/database/premium_plans.test.sql` y en
// `supabase/functions/_shared/subscription.integration.test.mjs`.
//
// Usa la clave de servicio LOCAL que pasa `scripts/test-integration.mjs` (que se niega si la URL no es
// local). Nunca contra `kitom-dev`.
const url = process.env.KITOM_IT_SUPABASE_URL;
const serviceKey = process.env.KITOM_IT_SUPABASE_SERVICE_ROLE_KEY;

export async function grantPremium(userId) {
  if (!url || !serviceKey || !/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) {
    throw new Error('grantPremium: solo contra el Supabase local (npm run test:integration)');
  }
  const response = await fetch(`${url}/rest/v1/subscriptions?user_id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ plan: 'premium', status: 'active', current_period_end: null }),
  });
  if (!response.ok) throw new Error(`grantPremium: HTTP ${response.status}`);
}
