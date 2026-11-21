# Kitom — Compilación, despliegue y publicación

Estado y procedimientos (revisión 2026-10-29). **Hoy no existe un camino de publicación**: no hay
proyecto de producción, ni `eas.json`, ni firma de release, ni `ios.bundleIdentifier`. Este documento
describe lo que hay y los pasos que faltan; los marcados «decisión» requieren al usuario.

## 1. Entornos

| Entorno | Supabase | App | Estado |
|---|---|---|---|
| Local | Docker (`npx supabase start`) | `npm run start:local` (no toca `.env`) | operativo |
| Desarrollo | `kitom-dev` | `npx expo start` con `frontend/.env` | operativo; único remoto |
| Producción | — | — | **no existe** |

Usar `kitom-dev` para usuarios reales no es aceptable: contiene datos de prueba, su configuración de
Auth no está versionada y es donde se aplican primero las migraciones.

## 2. Variables y secretos (solo nombres)

| Dónde | Nombre | Notas |
|---|---|---|
| `frontend/.env` (ignorado por git; plantilla `frontend/.env.example`) | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` | públicas: acaban en el bundle. Nunca otra clave aquí |
| Secretos de Edge Functions (`supabase secrets set`, los pone el usuario) | `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL` (opcional, respaldo ante `429`/`503`), `AI_PROVIDER`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `AI_INPUT_USD_PER_MTOK`, `AI_OUTPUT_USD_PER_MTOK`, `PET_STORAGE_CLEANUP_SECRET`, `PET_STORAGE_CLEANUP_MODE`, `REVENUECAT_SECRET_API_KEY` (v1, `sk_…`), `REVENUECAT_WEBHOOK_AUTH` (≥ 32 caracteres), `REVENUECAT_ENTITLEMENT_ID` (opcional, `premium`), `RESEND_API_KEY` y `INVITATION_EMAIL_FROM` (avisos de invitación por email), `EXPO_ACCESS_TOKEN` (opcional, push con seguridad reforzada) | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` los da la plataforma |
| App (EAS por entorno, o `frontend/.env` en local) | `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY` (`goog_…`), `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` (después) | claves **públicas** de SDK de RevenueCat; sin ellas no se puede comprar Premium (`SETUP_GUIDE.md` §7) |
| EAS, variable de tipo archivo (o `frontend/google-services.json` en local, ignorado por git) | `GOOGLE_SERVICES_JSON` | Firebase para el push en Android; lo lee `frontend/app.config.js`. Sin él, la build no recibe push (`SETUP_GUIDE.md` §8). La clave FCM V1 va en las credenciales de EAS, no aquí |
| `supabase/config.toml` (solo local) | `env(...)` | sin valores literales |
| Raíz `.env` (opcional) | `OPENAI_API_KEY` | solo para Studio local |

Para varios entornos con EAS: perfiles en `eas.json` con `env` o variables de EAS por entorno
(`development`, `preview`, `production`) apuntando a cada proyecto Supabase.

## 3. App: configuración (`frontend/app.json`, `frontend/eas.json`)

| Campo | Valor | Notas |
|---|---|---|
| `name` / `slug` | Kitom / `kitom` | `slug` cambiado de `frontend` (2026-10-30) antes de crear el proyecto EAS |
| `version` | 1.1.0 | igual en `package.json`; subirla en cada versión publicada |
| `android.package` | `com.kitom.app` | fijado; no cambiar |
| `android.versionCode` | 2 en `app.json` | con `appVersionSource: remote`, EAS lo gestiona e incrementa (`autoIncrement`) |
| `ios.bundleIdentifier` / `buildNumber` | `com.kitom.app` / 1 | preparado; iOS no se publica en la v1 (Android primero) |
| `android.allowBackup` | `false` | la copia de Android incluiría la copia local de registros y mascotas (sin cifrar) |
| `android.permissions` | `SCHEDULE_EXACT_ALARM` | justificarlo en Play (recordatorios de medicación a su hora) |
| `android.blockedPermissions` | `SYSTEM_ALERT_WINDOW`, `USE_BIOMETRIC`, `USE_FINGERPRINT`, `WRITE_EXTERNAL_STORAGE`, `RECORD_AUDIO` | los añadían dependencias sin uso en Kitom |
| plugins | router, splash, secure-store (sin Face ID, copia excluida), notifications, image-picker, sharing, datetimepicker, Sentry | textos de permisos de iOS solo en español (pendiente al publicar en iOS) |
| `runtimeVersion` / `updates` | ausentes | solo hacen falta si se adopta EAS Update |

Permisos efectivos en Android (manifiesto combinado): Internet y estado de red, cámara, notificaciones
(`POST_NOTIFICATIONS`, arranque, vibración, `WAKE_LOCK`), alarmas exactas, lectura de imágenes hasta
Android 12 (`READ_EXTERNAL_STORAGE` con `maxSdkVersion` 32; desde Android 13 se usa el selector de
fotos del sistema, sin permiso) y los de insignias/FCM que añade `expo-notifications`.

Expo Go no sirve para producción ni para probar avisos (el módulo `kitom-exact-alarms` y
`expo-notifications` necesitan build nativa).

## 4. Compilación

### Local (pruebas)

`npx expo prebuild --platform android` + `cd android && ./gradlew assembleRelease`: APK firmada con
la **clave de depuración**, `/android` ignorado por git. No vale para Google Play. Sin token de Sentry,
exportar `SENTRY_DISABLE_AUTO_UPLOAD=true` antes de Gradle. Para subir los source maps, poner `SENTRY_AUTH_TOKEN` en
la terminal o en `frontend/.env.sentry-build-plugin` (ignorado por git) y repetir `prebuild`, que escribe la
organización y el proyecto de `app.json` en `android/sentry.properties` (y cambia los `scripts` de `package.json`: revertirlos).
La APK solo envía errores si se compila con `EXPO_PUBLIC_SENTRY_DSN`, en `frontend/.env` o en la terminal.
Igual con `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`: sin él, «Continuar con Google» abre el navegador en vez del selector de cuentas
(`AUTH.md` §4). En el bundle debe aparecer `.apps.googleusercontent.com`.

Antes de instalar una APK local, comprobar a qué servidor apunta: compilar sin `EXPO_PUBLIC_*` en la terminal (se usan las de
`frontend/.env`; las variables del proceso tienen prioridad) y buscar en `android/app/build/generated/assets/` el bundle, que debe contener
`supabase.co` y no `127.0.0.1`. Una APK con la URL local da «No hay conexión» en un móvil real.

### EAS (publicación)

`frontend/eas.json` ya define los perfiles (todos heredan `base`: Node 24.12). Solo `development` lleva
`SENTRY_DISABLE_AUTO_UPLOAD=true`: `preview` y `production` suben los source maps y necesitan `SENTRY_AUTH_TOKEN`:

| Perfil | Uso | Android | Entorno de variables EAS |
|---|---|---|---|
| `development` | development client para depurar en dispositivo | APK interna | `development` |
| `preview` | probar la build de release con testers | APK interna | `preview` |
| `production` | tienda | AAB, `autoIncrement` | `production` |

`submit.production.android`: pista `internal`, borrador. Pasos (los ejecuta el responsable con su cuenta):

Estado (2026-11-21): ✅ pasos 1 y 2 (proyecto `brotherz/kitom`; variables de `production`, también `GOOGLE_SERVICES_JSON` y
`SENTRY_AUTH_TOKEN`); primera build `production` lanzada el 2026-11-21 (keystore generado en la nube por EAS; versionCode 3,
gestionado por EAS: `appVersionSource: remote`). El archivo subido a EAS pesa ~517 MB (todo el repo menos lo ignorado por git):
un `.easignore` lo reduciría, pero sustituye a los `.gitignore` y debe repetir sus reglas.

1. Cuenta Expo; desde `frontend/`: `npx eas-cli@latest login` y `npx eas-cli@latest init` (añade
   `extra.eas.projectId` y `owner` a `app.json`: commitearlo). El perfil `development` usa `expo-dev-client`
   (instalado el 2026-11-18).
2. Variables por entorno en EAS (Project › Environment variables), nunca en el repo. Plantilla con todos los
   `eas env:create`: `frontend/scripts/eas-env-template.sh` (copiarla fuera del repo, rellenarla y ejecutarla). Variables:
   `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` (del proyecto de ese entorno) y
   `EXPO_PUBLIC_SENTRY_DSN` (Sentry › proyecto `kitom-app` › Client Keys), `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` (Client ID del
   cliente Web de Google Cloud; público) y `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY` (Kitom Premium; pública). En `preview` y `production`, además, el
   secreto `SENTRY_AUTH_TOKEN` (token de organización, visibilidad *sensitive*): la organización y el proyecto ya están en `app.json`.
3. `npx eas-cli@latest build -p android --profile preview` → instalar en móviles reales.
4. Firma: EAS genera y custodia el keystore (`eas credentials`); descargar una copia de seguridad.
   Activar Play App Signing al crear la app en Play Console. Las SHA-1 de la clave de subida y de la de firma de Play
   necesitan su cliente Android en Google Cloud (`SETUP_GUIDE.md` §4); sin ellos, el acceso con Google falla.
5. `npx eas-cli@latest build -p android --profile production` y
   `npx eas-cli@latest submit -p android --profile production` (requiere la clave de la cuenta de
   servicio de Play, configurada en EAS).
6. iOS (versión posterior): cuenta de Apple Developer, «Iniciar sesión con Apple» si se ofrece Google,
   textos de permisos en inglés, `eas build -p ios`.
7. Opcional: EAS Update con `runtimeVersion`; una actualización OTA no puede cambiar código nativo.

## 5. Base de datos y Edge Functions

1. **Proyecto de producción** (decisión: región UE por RGPD; plan con copias de seguridad diarias o PITR).
2. Aplicar todas las migraciones con `npx supabase db push` contra el proyecto de producción
   (lo ejecuta el usuario) y los catálogos (`supabase/seed.sql`, `supabase/seeds/breeds.sql`, ver `SEED.md`).
3. Crear y configurar buckets **con límites** (ver `DATABASE.md` §5; la migración en preparación fija los de `pet-photos`).
4. Auth (Dashboard): confirmación de email, contraseña ≥ 8 y protección de contraseñas filtradas,
   `secure_password_change`, SMTP propio, Site URL y Redirect URLs `kitom://**` (ver `AUTH.md`),
   proveedor Google con cliente de producción.
5. Edge Functions: `npx supabase functions deploy ai-analysis-process` y `pet-storage-cleanup`;
   secretos del §2; plan de pago del proveedor de IA (SEC-03).
6. Limpieza programada: habilitar `pg_cron` + `pg_net` (o un programador externo) para invocar
   `pet-storage-cleanup` con su secreto; primero en modo informe (ver `docs/proposals/2026-10-26-pet-photos-cleanup.md`).
7. Regenerar tipos (`gen types --linked`) solo desde el proyecto de desarrollo.

Orden de despliegue de una versión: migraciones (compatibles hacia atrás) → Edge Functions → app.
Una migración que rompa versiones antiguas de la app necesita una ventana en la que convivan ambas.

## 6. Publicación

### Requisitos (verificar en las consolas: cambian con el tiempo)

| Requisito | Tipo | Estado |
|---|---|---|
| Cuenta Google Play Console y Apple Developer Program | obligatorio | PENDIENTE (usuario) |
| Eliminación de cuenta desde la app (y URL web en Play) | obligatorio | En la app: P0-02. URL web lista: `site/delete-account.html` (base: `LEGAL_SITE_URL` de `frontend/src/lib/legal-links.ts`); Pages activado, falta el `push` |
| Política de privacidad pública y enlazada | obligatorio | LISTA: `site/privacy.html` y `site/terms.html` (es/en), enlazadas en Ajustes › Legal, Privacidad y la consulta con IA; falta activar GitHub Pages y la revisión legal recomendada |
| Formulario Data Safety (Play) y etiquetas de privacidad (App Store) | obligatorio | PENDIENTE; borrador en `PRIVACY.md` |
| Justificación de `SCHEDULE_EXACT_ALARM` en Play | condicional (si se mantiene el permiso) | PENDIENTE |
| Nivel de API objetivo exigido por Play | obligatorio | por verificar en la build de EAS |
| Prueba cerrada antes de producción en cuentas personales nuevas de Play | condicional | por verificar |
| «Iniciar sesión con Apple» si se ofrece Google en iOS (directriz 4.8) | condicional | PENDIENTE (decisión) |
| Manifiesto de privacidad de iOS (lo generan los paquetes de Expo) | obligatorio | por verificar en la build |
| Fichas: icono, capturas, descripción, categoría, clasificación de contenido | obligatorio | PENDIENTE |
| Compras en la app (si hay Premium) | condicional | BLOQUEADO (decisión de producto) |
| Descargo médico visible (la app no diagnostica) | obligatorio para Kitom | COMPLETADO en la app |

### Distribución de pruebas

Android: pista de prueba interna/cerrada de Play con la AAB de EAS. iOS: TestFlight. Recoger fallos
con Sentry y un canal de feedback (email de soporte).

### Antes de cada lanzamiento

- [ ] `tsc`, lint, unitarias, integración, pgTAP y concurrencia en verde (`TESTING.md`).
- [ ] Migraciones aplicadas en producción y advisors sin avisos nuevos.
- [ ] Edge Functions desplegadas y secretos presentes.
- [ ] Build de producción probada en Android e iOS físicos (avisos, cámara, sesión offline).
- [ ] `version`/`versionCode`/`buildNumber` incrementados y `CHANGELOG.md` actualizado.

## 7. Rollback y recuperación

- **App**: no se puede retirar una versión instalada; en Play se detiene el despliegue escalonado y se
  publica una versión corregida con `versionCode` mayor; en iOS, nueva versión (o OTA si solo es JS y
  hay EAS Update).
- **Base de datos**: no hay migraciones «down»; se corrige con una migración nueva. Antes de cada
  `db push` a producción, copia de seguridad o PITR.
- **Edge Functions**: volver a desplegar la versión anterior desde git.
- Plan de incidentes y soporte: pendiente (`ROADMAP.md`).

## 8. Lista de acciones del responsable para publicar (en orden)

Todo lo que no puede hacerse desde el repositorio. Los `functions deploy` y `db push` se repiten en el proyecto de producción.

Las cuentas y los paneles (GitHub Pages, dominio, SMTP, Supabase Auth, Google Cloud y Play), paso a paso: [`SETUP_GUIDE.md`](SETUP_GUIDE.md).

**A. Desarrollo (`kitom-dev`)**
1. ✅ `db push` de `20261030090318` (2026-11-04).
   - ✅ `db push` de `20261105093545` y `20261105122353` (2026-11-06) y tipos regenerados.
   - ✅ `db push` de `20261111120000_species_fields` (campos por especie), `supabase/seeds/breeds.sql` reejecutado y
     tipos regenerados con `--linked` (2026-11-12). **Antes de publicar una build con esta versión:** la app lee
     `species_data` y llama a `save_daily_log` con `p_species_data`; contra un servidor sin la migración, las
     lecturas de mascotas y registros fallarían. Orden: migración → seed → build. Las builds anteriores siguen
     funcionando con la migración aplicada (no envían `p_species_data` y conservan lo guardado).
   - ✅ Orientación v2 (2026-11-13; hecho por el usuario el 2026-11-15): `db push` de `20261113134252_ai_guidance_v2.sql`,
     `supabase/seed.sql` reejecutado (72 señales por especie), tipos regenerados con `--linked` y
     `ai-analysis-process` desplegada con el prompt v2. En producción, el mismo orden: migración → seed → función → build
     (la función lee las columnas nuevas; una build anterior sigue funcionando con la migración aplicada).
     Opcional: `supabase secrets set GEMINI_FALLBACK_MODEL=<modelo>` (reintento con otro modelo ante `429`/`5xx`).
   - **Pendiente antes de publicar:** revisión veterinaria de los campos por especie y del texto de las observaciones
     del resumen de bienestar (`proposals/2026-11-11-species-fields.md` D-2, `2026-11-10-wellness-reports.md` D-9), y
     publicar los términos actualizados de `site/` (todas las especies).
2. ✅ Tipos regenerados.
3. ✅ `delete-account` (v1) y `pet-storage-cleanup` (v1) desplegadas (comprobado en solo lectura, 2026-11-04);
   `ai-analysis-process` con el prompt v2, desplegada por el usuario (2026-11-15).
4. Revisar la IA: una consulta real (con y sin foto) hasta `completed` y los logs de la función. Hasta hoy ninguna
   consulta de `kitom-dev` ha llegado a `completed`, así que el secreto `GEMINI_API_KEY` sigue sin comprobarse.
5. Limpieza: secreto `PET_STORAGE_CLEANUP_SECRET` (≥ 32 caracteres) y, en el editor SQL,
   `select vault.create_secret('https://<ref>.supabase.co', 'kitom_project_url');` y
   `select vault.create_secret('<el mismo secreto>', 'pet_storage_cleanup_secret');`. Primero en modo informe; `PET_STORAGE_CLEANUP_MODE=delete`
   cuando el informe sea correcto. Comprobar `cron.job_run_details`.

**B. Páginas legales**
6. Pages ya está activado (Source = GitHub Actions; 2026-11-04). Falta hacer `push` de `main` para publicar y comprobar las URL: `SETUP_GUIDE.md` §1.
7. Confirmar los supuestos de los textos (España, región UE de Supabase, edad mínima 16) y pedir revisión legal.

**C. Proveedores**
8. **Plan de Gemini (decisión 2026-11-15: gratuito de momento).** Según los
   [términos adicionales de la Gemini API](https://ai.google.dev/gemini-api/terms) (en vigor desde el 23-3-2026), a quien
   está en el EEE, Suiza o Reino Unido se le aplican las condiciones de datos del servicio de pago también en la cuota
   gratuita (Google no usa el contenido para mejorar sus productos), y la política de privacidad lo describe así, sin
   depender del plan. **Pero** los mismos términos dicen que para ofrecer la app a usuarios del EEE, Suiza o Reino
   Unido solo se pueden usar servicios de pago. Con la cuota gratuita valen las pruebas propias; **antes de la prueba
   cerrada con testers del EEE o de publicar**, activar la facturación del proyecto de Google AI Studio (o pasar a
   Vertex AI). Los límites de la cuota gratuita (peticiones por minuto y por día) tampoco aguantan a usuarios reales.
9. Validación del prompt, las señales por especie y las reglas de urgencia por un veterinario (`guidance.ts` y
   `urgency.ts`, `draft-2026-11-13`; `supabase/seed.sql`).
10. Sentry: ✅ proyecto `kitom-app` (organización `kitom`, región UE), errores reales y source maps comprobados y reglas de privacidad
    activas (`[Remove] [Anything] from [$user.geo.**]`, `[$user.id]` y `[contexts.device.id]`, motivo en `PRIVACY.md`; 2026-11-04). Falta:
    - Al crear el proyecto EAS, `EXPO_PUBLIC_SENTRY_DSN` y `SENTRY_AUTH_TOKEN` en sus variables (§4).
    - Comprobar que la retención del plan cumple los 90 días de la política.

**D. Producción**
11. Proyecto Supabase en la UE y pasos de §5, con `SETUP_GUIDE.md` §2-§4 (SMTP propio, plantillas, página puente, `kitom://**`, Google) y la
    lista de `AUTH.md` §3. SMTP con Resend: ✅ configurado en `kitom-dev` (el usuario, 2026-11-15); repetirlo en el proyecto
    de producción (**sin SMTP propio, los usuarios reales no reciben los correos de confirmación**) y comprobar una entrega
    real de cada plantilla.

**E. Google Play**
12. Cuentas de Expo y Play; `eas init` y variables por entorno (§4); build `preview` en móviles reales.
13. Prueba manual en móvil: emails reales, recuperación, Google, fotos, avisos, IA, dos cuentas con co-tutores.
14. Build `production`, Play App Signing, copia del keystore, fichas y Data Safety (borrador en `STORE_LISTING.md`), justificación de
    `SCHEDULE_EXACT_ALARM` y prueba cerrada.

**F. Kitom Premium (decisión 2026-11-16: activo desde la prueba cerrada)**

Secretos y despliegue de las funciones: plantilla `supabase/functions/deploy-template.sh` (copiarla fuera del repo, rellenarla y
ejecutarla).
15. ✅ `db push` de `20261116160000_premium_plans.sql` (el usuario, 2026-11-18) y tipos regenerados con `--linked`.
    ✅ `delete-account` redesplegada (el usuario, 2026-11-20).
16. Play Console (perfil de comerciante, suscripción `kitom_premium` con planes `monthly`/`annual` y prueba de 7 días,
    testers de licencia), RevenueCat (app, cuenta de servicio, entitlement `premium`, oferta `default`), secretos,
    `functions deploy revenuecat-webhook` y `subscription-sync`, webhook y `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY` en EAS:
    `SETUP_GUIDE.md` §7.
17. Prueba de compras con un tester de licencia y revisión legal de la cláusula de suscripción: `QA_2026-11-16.md` §4.

**G. Avisos de invitación (2026-11-20, QA-07)**
18. ✅ (el usuario, 2026-11-20; tipos regenerados el 2026-11-21) `db push` de `20261120154210_invitation_notifications.sql` y tipos regenerados; Resend (API key y remitente), Firebase
    (`google-services.json` en EAS y clave FCM V1 en las credenciales), secretos y `functions deploy invitation-notify` con la
    plantilla, y una build nueva: `SETUP_GUIDE.md` §8. Orden: migración → función → build (una build con este cambio contra un
    servidor sin la función solo pierde los avisos: la invitación se crea igual).
