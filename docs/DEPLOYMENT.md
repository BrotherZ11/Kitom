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

## 3. App: configuración actual (`frontend/app.json`)

| Campo | Valor | Problema |
|---|---|---|
| `name` / `slug` | Kitom / `frontend` | el `slug` se usa en EAS y URLs de Expo: decidir antes de crear el proyecto EAS (decisión) |
| `version` | 1.1.0 | `package.json` dice 1.0.0 |
| `android.package` | `com.kitom.app` | fijado; no cambiar |
| `android.versionCode` | 2 | gestionarlo con EAS (`autoIncrement`) |
| `ios` | **ausente** | falta `bundleIdentifier` y `buildNumber` (decisión: p. ej. `com.kitom.app`) |
| `scheme` | `kitom` | deep links de Auth |
| `permissions` | `SCHEDULE_EXACT_ALARM` | Play exige justificarlo (recordatorios de medicación) |
| plugins | router, splash, secure-store, notifications, image-picker | textos de permisos solo en español |
| `runtimeVersion` / `updates` | ausentes | necesarios si se usa EAS Update |

Expo Go no sirve para producción ni para probar avisos (el módulo `kitom-exact-alarms` y
`expo-notifications` necesitan build nativa).

## 4. Compilación

### Estado actual (solo pruebas)

`npx expo prebuild --platform android` + `cd android && ./gradlew assembleRelease`: APK firmada con
la **clave de depuración**, `/android` ignorado por git. No vale para Google Play.

### Camino propuesto (EAS)

1. Cuenta Expo y `npx eas-cli init` en `frontend/` (añade `extra.eas.projectId`) — requiere permiso para usar EAS.
2. `eas.json` con perfiles `development` (development client), `preview` (APK/IPA interna) y
   `production` (AAB / IPA de tienda), `autoIncrement` y variables por entorno.
3. Firma: dejar que EAS genere y custodie el keystore de Android (o subir uno propio) y las
   credenciales de Apple. **Copia de seguridad del keystore**: perderlo impide actualizar la app.
4. `eas build -p android --profile preview` → instalar en dispositivos reales.
5. iOS: cuenta de Apple Developer, `bundleIdentifier`, `eas build -p ios`. Nunca se ha compilado para iOS.
6. Opcional: EAS Update con `runtimeVersion` (`policy: appVersion` o `fingerprint`); una actualización
   OTA no puede cambiar código nativo (módulo de alarmas, plugins).

Alternativa sin EAS: firma propia con Gradle (upload key + Play App Signing) y Xcode; más trabajo
manual y menos reproducible.

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
| Eliminación de cuenta desde la app (y URL web en Play) | obligatorio | PENDIENTE (P0-02) |
| Política de privacidad pública y enlazada | obligatorio | BLOQUEADO (asesoría legal) |
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
con un servicio de errores (p. ej. Sentry, a decidir) y un canal de feedback (email de soporte).

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
