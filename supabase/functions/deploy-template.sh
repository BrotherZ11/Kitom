#!/usr/bin/env bash
# =====================================================================
# KITOM · Plantilla: secretos y despliegue de las Edge Functions (docs/DEPLOYMENT.md §8, docs/SETUP_GUIDE.md §7)
# =====================================================================
# La ejecuta el responsable desde la raíz del repo, con el proyecto enlazado (kitom-dev hoy; repetir en
# producción). Claude no puede: `secrets set` y `functions deploy` están bloqueados para él. Copiar este
# archivo FUERA del repo, rellenar los <...> y ejecutarlo allí: nunca commitear valores. Se niega a seguir
# si queda algún <...>. Los secretos que ya existan (GEMINI_*, PET_STORAGE_CLEANUP_*) no se tocan.
# =====================================================================
set -euo pipefail

REVENUECAT_SECRET_API_KEY='<sk_clave-secreta-v1-de-revenuecat>'
# Valor aleatorio de 40+ caracteres; el mismo en RevenueCat › Webhooks › Authorization header value.
# Por ejemplo: openssl rand -base64 48
REVENUECAT_WEBHOOK_AUTH='<valor-aleatorio-largo>'

for value in "$REVENUECAT_SECRET_API_KEY" "$REVENUECAT_WEBHOOK_AUTH"; do
  if [[ "$value" == *"<"* ]]; then
    echo "Rellena todos los <...> antes de ejecutar la plantilla." >&2
    exit 1
  fi
done
if [ "${#REVENUECAT_WEBHOOK_AUTH}" -lt 32 ]; then
  echo "REVENUECAT_WEBHOOK_AUTH necesita al menos 32 caracteres." >&2
  exit 1
fi

npx supabase secrets set \
  REVENUECAT_SECRET_API_KEY="$REVENUECAT_SECRET_API_KEY" \
  REVENUECAT_WEBHOOK_AUTH="$REVENUECAT_WEBHOOK_AUTH"

# Kitom Premium y el paso nuevo de delete-account (borra también el cliente de RevenueCat).
npx supabase functions deploy revenuecat-webhook
npx supabase functions deploy subscription-sync
npx supabase functions deploy delete-account

npx supabase functions list
echo "Webhook de RevenueCat: https://<ref>.supabase.co/functions/v1/revenuecat-webhook (Send test event → 200)."
