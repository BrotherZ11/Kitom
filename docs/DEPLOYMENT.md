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
| Secretos de Edge Functions (`supabase secrets set`, los pone el usuario) | `GEMINI_API_KEY`, `GEMINI_MODEL`, `AI_PROVIDER`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `AI_INPUT_USD_PER_MTOK`, `AI_OUTPUT_USD_PER_MTOK`, `PET_STORAGE_CLEANUP_SECRET`, `PET_STORAGE_CLEANUP_MODE` | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` los da la plataforma |
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

1. Cuenta Expo; desde `frontend/`: `npx eas-cli@latest login` y `npx eas-cli@latest init` (añade
   `extra.eas.projectId` a `app.json`: commitearlo).
2. Variables por entorno en EAS (Project › Environment variables), nunca en el repo:
   `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` (del proyecto de ese entorno) y
   `EXPO_PUBLIC_SENTRY_DSN` (Sentry › proyecto `kitom-app` › Client Keys). En `preview` y `production`, además, el
   secreto `SENTRY_AUTH_TOKEN` (token de organización, visibilidad *sensitive*): la organización y el proyecto ya están en `app.json`.
3. `npx eas-cli@latest build -p android --profile preview` → instalar en móviles reales.
4. Firma: EAS genera y custodia el keystore (`eas credentials`); descargar una copia de seguridad.
   Activar Play App Signing al crear la app en Play Console.
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
2. ✅ Tipos regenerados.
3. ✅ `ai-analysis-process` (v2), `delete-account` (v1) y `pet-storage-cleanup` (v1) desplegadas (comprobado en solo lectura, 2026-11-04).
4. Revisar la IA: secreto `GEMINI_API_KEY`, logs de la función y una consulta real hasta `completed`.
5. Limpieza: secreto `PET_STORAGE_CLEANUP_SECRET` (≥ 32 caracteres) y, en el editor SQL,
   `select vault.create_secret('https://<ref>.supabase.co', 'kitom_project_url');` y
   `select vault.create_secret('<el mismo secreto>', 'pet_storage_cleanup_secret');`. Primero en modo informe; `PET_STORAGE_CLEANUP_MODE=delete`
   cuando el informe sea correcto. Comprobar `cron.job_run_details`.

**B. Páginas legales**
6. Pages ya está activado (Source = GitHub Actions; 2026-11-04). Falta hacer `push` de `main` para publicar y comprobar las URL: `SETUP_GUIDE.md` §1.
7. Confirmar los supuestos de los textos (España, región UE de Supabase, edad mínima 16) y pedir revisión legal.

**C. Proveedores**
8. Plan de pago de Gemini: los textos legales y el consentimiento lo presuponen.
9. Validación del prompt y de las reglas de IA por un veterinario (`guidance.ts`, `draft-2026-10-23`).
10. Sentry: ✅ proyecto `kitom-app` (organización `kitom`, región UE), errores reales y source maps comprobados y reglas de privacidad
    activas (`[Remove] [Anything] from [$user.geo.**]`, `[$user.id]` y `[contexts.device.id]`, motivo en `PRIVACY.md`; 2026-11-04). Falta:
    - Al crear el proyecto EAS, `EXPO_PUBLIC_SENTRY_DSN` y `SENTRY_AUTH_TOKEN` en sus variables (§4).
    - Comprobar que la retención del plan cumple los 90 días de la política.

**D. Producción**
11. Proyecto Supabase en la UE y pasos de §5, con `SETUP_GUIDE.md` §2-§4 (SMTP propio, plantillas, página puente, `kitom://**`, Google) y la
    lista de `AUTH.md` §3. **Sin SMTP propio, los usuarios reales no reciben los correos de confirmación.**

**E. Google Play**
12. Cuentas de Expo y Play; `eas init` y variables por entorno (§4); build `preview` en móviles reales.
13. Prueba manual en móvil: emails reales, recuperación, Google, fotos, avisos, IA, dos cuentas con co-tutores.
14. Build `production`, Play App Signing, copia del keystore, fichas y Data Safety (borrador en `STORE_LISTING.md`), justificación de
    `SCHEDULE_EXACT_ALARM` y prueba cerrada.
