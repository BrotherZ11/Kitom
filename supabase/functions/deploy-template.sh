#!/usr/bin/env bash
# =====================================================================
# KITOM · Plantilla: secretos y despliegue de las Edge Functions (docs/DEPLOYMENT.md §8, docs/SETUP_GUIDE.md §7–§8)
# =====================================================================
# La ejecuta el responsable desde la raíz del repo, con el proyecto enlazado (kitom-dev hoy; repetir en
# producción). Claude no puede: `secrets set` y `functions deploy` están bloqueados para él. Copiar este
# archivo FUERA del repo, rellenar los valores y ejecutarlo allí: nunca commitear valores.
# Un secreto vacío ('') no se toca: así se puede volver a ejecutar sin repetir los que ya están puestos
# (`npx supabase secrets list` enseña sus nombres). Los que ya existan (GEMINI_*, PET_STORAGE_CLEANUP_*) no se tocan.
# Desplegar es idempotente: vuelve a subir la versión del repo de cada función.
# =====================================================================
set -euo pipefail

# --- Kitom Premium (RevenueCat) — vacíos si ya están puestos ---
REVENUECAT_SECRET_API_KEY=''   # sk_… (clave secreta v1 de RevenueCat)
# Valor aleatorio de 40+ caracteres; el mismo en RevenueCat › Webhooks › Authorization header value.
# Por ejemplo: openssl rand -base64 48
REVENUECAT_WEBHOOK_AUTH=''

# --- Avisos de invitación (2026-11-20) ---
RESEND_API_KEY=''              # re_… (Resend › API Keys; permiso «Sending access» del dominio kitom.app)
INVITATION_EMAIL_FROM=''       # p. ej. 'Kitom <avisos@kitom.app>' (dominio verificado en Resend)
EXPO_ACCESS_TOKEN=''           # opcional: solo si activas «Enhanced Security for Push Notifications» en Expo

secrets=()
add_secret() {
  local name="$1" value="$2"
  if [ -z "$value" ]; then return; fi
  if [[ "$value" == *"<"* ]]; then
    echo "$name tiene un marcador <...>: rellénalo o déjalo vacío." >&2
    exit 1
  fi
  secrets+=("$name=$value")
}

if [ -n "$REVENUECAT_WEBHOOK_AUTH" ] && [ "${#REVENUECAT_WEBHOOK_AUTH}" -lt 32 ]; then
  echo "REVENUECAT_WEBHOOK_AUTH necesita al menos 32 caracteres." >&2
  exit 1
fi
if [ -n "$RESEND_API_KEY" ] && [ -z "$INVITATION_EMAIL_FROM" ]; then
  echo "Con RESEND_API_KEY hace falta INVITATION_EMAIL_FROM." >&2
  exit 1
fi

add_secret REVENUECAT_SECRET_API_KEY "$REVENUECAT_SECRET_API_KEY"
add_secret REVENUECAT_WEBHOOK_AUTH "$REVENUECAT_WEBHOOK_AUTH"
add_secret RESEND_API_KEY "$RESEND_API_KEY"
add_secret INVITATION_EMAIL_FROM "$INVITATION_EMAIL_FROM"
add_secret EXPO_ACCESS_TOKEN "$EXPO_ACCESS_TOKEN"

if [ "${#secrets[@]}" -gt 0 ]; then
  npx supabase secrets set "${secrets[@]}"
fi

# Kitom Premium, el paso de RevenueCat de delete-account y los avisos de invitación.
# invitation-notify necesita antes la migración 20261120154210_invitation_notifications (db push).
npx supabase functions deploy revenuecat-webhook
npx supabase functions deploy subscription-sync
npx supabase functions deploy delete-account
npx supabase functions deploy invitation-notify

npx supabase functions list
npx supabase secrets list
echo "Webhook de RevenueCat: https://<ref>.supabase.co/functions/v1/revenuecat-webhook (Send test event → 200)."
