#!/usr/bin/env bash
# =====================================================================
# KITOM · Plantilla: variables de EAS por entorno (docs/DEPLOYMENT.md §4)
# =====================================================================
# La ejecuta el responsable, una vez, después de `npx eas-cli@latest login` y `npx eas-cli@latest init`
# (desde frontend/). Copiar este archivo FUERA del repo, rellenar los <...> y ejecutarlo allí: nunca
# commitear valores. Se niega a seguir si queda algún <...>.
#
# Públicas (EXPO_PUBLIC_*, acaban en el bundle): visibilidad `plaintext`.
# SENTRY_AUTH_TOKEN es un secreto de compilación: visibilidad `secret`.
# Mientras no exista el proyecto de producción de Supabase, `production` puede usar kitom-dev
# (y cambiarse después con `eas env:update`).
# =====================================================================
set -euo pipefail

SUPABASE_URL_DEV='<https://<ref-de-kitom-dev>.supabase.co>'
SUPABASE_ANON_DEV='<anon-o-publishable-de-kitom-dev>'
SUPABASE_URL_PROD='<https://<ref-de-produccion>.supabase.co>'
SUPABASE_ANON_PROD='<anon-o-publishable-de-produccion>'
SENTRY_DSN='<dsn-de-sentry-kitom-app>'
SENTRY_AUTH_TOKEN='<token-de-organizacion-de-sentry>'
GOOGLE_WEB_CLIENT_ID='<cliente-web>.apps.googleusercontent.com'
REVENUECAT_ANDROID_KEY='<goog_clave-publica-de-revenuecat>'

for value in "$SUPABASE_URL_DEV" "$SUPABASE_ANON_DEV" "$SUPABASE_URL_PROD" "$SUPABASE_ANON_PROD" "$SENTRY_DSN" \
  "$SENTRY_AUTH_TOKEN" "$GOOGLE_WEB_CLIENT_ID" "$REVENUECAT_ANDROID_KEY"; do
  if [[ "$value" == *"<"* ]]; then
    echo "Rellena todos los <...> antes de ejecutar la plantilla." >&2
    exit 1
  fi
done

EAS="npx eas-cli@latest"

create() { # entorno nombre valor visibilidad
  $EAS env:create --environment "$1" --name "$2" --value "$3" --visibility "$4" --non-interactive --force
}

for env in development preview; do
  create "$env" EXPO_PUBLIC_SUPABASE_URL "$SUPABASE_URL_DEV" plaintext
  create "$env" EXPO_PUBLIC_SUPABASE_ANON_KEY "$SUPABASE_ANON_DEV" plaintext
done
create production EXPO_PUBLIC_SUPABASE_URL "$SUPABASE_URL_PROD" plaintext
create production EXPO_PUBLIC_SUPABASE_ANON_KEY "$SUPABASE_ANON_PROD" plaintext

for env in development preview production; do
  create "$env" EXPO_PUBLIC_SENTRY_DSN "$SENTRY_DSN" plaintext
  create "$env" EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID "$GOOGLE_WEB_CLIENT_ID" plaintext
  create "$env" EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY "$REVENUECAT_ANDROID_KEY" plaintext
done
for env in preview production; do
  create "$env" SENTRY_AUTH_TOKEN "$SENTRY_AUTH_TOKEN" secret
done

$EAS env:list --environment production
