@AGENTS.md

# KITOM — Frontend

## Versiones instaladas (verificar en package.json antes de asumir APIs)
Expo SDK 57 · React Native 0.86.3 · React 19.2.3 · TypeScript ~6.0 (strict) · expo-router 57 · Reanimated 4.5.
`reactCompiler` y `typedRoutes` activos: no añadir `useMemo`/`useCallback` por costumbre; rutas tipadas.
Docs de referencia: https://docs.expo.dev/versions/v57.0.0/
Gestor de paquetes: **npm** (hay `package-lock.json`). Dependencias nuevas con `npx expo install`, previa aprobación.

## Estado actual
Vertical base implementada: cliente Supabase, Auth (email/contraseña y Google), sesión, rutas
protegidas y TanStack Query. Primera funcionalidad de producto: **Pets** (lista, alta, detalle,
edición, borrado). `(app)/index.tsx` sigue siendo una pantalla temporal con acceso a «Mis mascotas».
- `src/features/pets/` — `api/` (acceso a Supabase: `pets-api.ts`, `species-api.ts`), `hooks/`
  (TanStack Query), `components/`, `pet-form.ts` (valores, validación y conversión a columnas),
  `pet-errors.ts`, `query-keys.ts`, `types.ts`. Contrato de datos: `docs/FRONTEND_ARCHITECTURE.md` §4 «Pets».
  Fotos: `pet-photo.ts` (límites/path), `pet-photo-picker.ts` (expo-image-picker + expo-image-manipulator),
  `api/pet-photos-api.ts`, `hooks/use-pet-photo.ts`, `components/pet-photo-editor.tsx` (§4 «Pets: fotos»).
  Patrón a seguir en nuevas features: el acceso a datos solo en `api/`, los componentes nunca llaman a
  `supabase` directamente, y las escrituras envían únicamente columnas editables explícitas.
- `src/lib/supabase.ts` — cliente único (sesión en SecureStore troceado, `src/lib/secure-session-storage.ts`).
- `src/lib/query-client.ts` — QueryClient único; AuthProvider lo vacía al cerrar sesión o cambiar de usuario.
- `src/features/auth/` — `AuthProvider`/`useAuth`, mapeo de errores (`auth-errors.ts`), validación,
  deep links de Auth (`auth-redirect.ts`, flujo PKCE). Guía y configuración de Supabase/Google: `docs/AUTH.md`.
- Rutas de Auth: `(auth)/auth-callback.tsx` recibe los enlaces de email y el retorno de Google;
  `update-password.tsx` solo es accesible con una sesión de recuperación.
- `src/app/_layout.tsx` — único punto de protección de rutas (`Stack.Protected`); nunca comprobar la
  sesión pantalla a pantalla.
- `src/i18n/` — `t(key)` tipado; `es` y `en` con las mismas claves (`Translations`), idioma activo `es`
  (detección del dispositivo pendiente). Ningún texto visible fuera de `src/i18n/locales/`.
- `src/components/ui/` — Screen, TextField, Button, FormMessage, OptionGroup y estados
  Loading/Error/Empty (`query-state.tsx`) (mínimos, no es el design system final). El diseño final
  (tokens, componentes, pantallas y fases de implementación) está en `docs/design/`; sin implementar.
- `src/features/daily-logs/` — registro diario, fase 1 (hoy, online; ruta `(app)/pets/[id]/daily-log`,
  tarjeta en la ficha). Guardar solo con `save_daily_log`; "hoy" solo con `useTodayLogDate`/`log-date.ts`;
  lógica pura en `daily-log-form.ts`, `log-date.ts` y `daily-log-errors.ts` (probada con `npm test`).
  Historial: `(app)/pets/[id]/daily-logs` y `daily-logs/[date]`, paginación por cursor en
  `daily-log-history.ts` (recibe el cliente por parámetro: probado con `npm test` y contra Supabase local).
  Contrato: `docs/FRONTEND_ARCHITECTURE.md` §4 «DailyLogScreen» y «HistoryScreen». Pendiente: offline,
  borrado, calendario y gráficos.
- `src/features/daily-logs/offline/` — base del modo offline, **sin conectar** a hooks ni pantallas:
  `local-daily-log.ts` (modelo local, validación y transiciones), `daily-log-content.ts`,
  `daily-log-merge.ts` (fusión a tres bandas), `sync-errors.ts`, `sync-backoff.ts`. Todo puro y probado.
  `updated_at` siempre como la cadena del servidor (nunca por `Date`); sincronizar siempre con
  precondición (`toSyncPrecondition`). Contrato: `docs/FRONTEND_ARCHITECTURE.md` §5.
- `src/lib/local-store/` — `createLocalStore(storage, userId)`: datos locales por usuario, validados
  al leer (`local-store.ts`); adaptadores `device-storage.ts` (AsyncStorage) y `memory-storage.ts`
  (tests). **Sin cifrar**: nunca tokens ni credenciales; no registrar contenido en logs.
  `local-store-check.ts` (`checkLocalStore`) es la comprobación manual contra el almacenamiento real;
  pasar los tests en memoria no equivale a probar en dispositivo.
- `src/lib/operation-id.ts` + `device-operation-id.ts` — único generador de identificadores de
  operación (`createOperationId`, UUID v4 de `expo-crypto`). Nunca `Math.random` ni otro generador.
- `src/lib/connectivity.ts` — señal de red de `expo-network` para `onlineManager` (conectada en
  `query-client.ts`). Es una señal, no una garantía. Opciones del QueryClient en `query-defaults.ts`:
  en móvil `networkMode: 'always'` (conserva el comportamiento previo a la señal); no cambiarlo ni
  fijar otro por feature sin revisar `docs/DECISIONS.md` (2026-10-13).
- `src/lib/submit-guard.ts` — evita envíos dobles (toques antes de que el botón se deshabilite).
- `src/features/profile/` — zona horaria del perfil (lectura: `useProfileTimeZone`, `['profile','timezone']`): `timezone.ts` (detección con `Intl`, validación
  IANA e inicialización; módulo puro, sin imports), `api/profile-api.ts`,
  `hooks/use-profile-timezone-sync.ts` (montado en `(app)/_layout.tsx`). Inicializa `profiles.timezone`
  solo si es `NULL` y nunca la sobrescribe. Contrato: `docs/FRONTEND_ARCHITECTURE.md` §9.
- ESLint configurado (`eslint.config.js`, `eslint-config-expo`).
- Tests unitarios: `npm test` (runner de Node 24, sin dependencias). Archivos `*.test.mjs` junto al
  módulo; importan el `.ts` directamente (type stripping de Node), así que el módulo probado debe ser
  puro (sin `@/`, React Native ni `__DEV__`). Son `.mjs` porque TypeScript 6 no incluye `@types/node`.
  `import type` con `@/` sí vale (se elimina); un módulo puro que importa otro en ejecución usa ruta
  relativa con extensión (`./otro.ts`).
Esquema de deep links: `kitom` (`app.json`). Cambiarlo rompe los redirects de Auth (Redirect URLs de
Supabase) y exige un nuevo development build. `name`/`slug` siguen siendo `frontend`.
Pendiente: login por teléfono (OTP), cambio de contraseña desde ajustes; en Pets: limpieza de fotos huérfanas,
archivar (`is_active`), selector de fecha nativo, gestión de co-tutores y límite de mascotas del plan free.

## Tipos de Supabase
`src/types/database.types.ts` es generado: no editarlo a mano. Regenerar desde la raíz del repo
(lee el remoto `kitom-dev`, requiere aprobación):
`npx supabase gen types typescript --linked --schema public > frontend/src/types/database.types.ts`
**Ejecutarlo desde Bash (Git Bash), no desde Windows PowerShell 5.1:** allí `>` escribe UTF-16 LE con
BOM; git lo trata como binario y ESLint falla ("File appears to be binary"). Comprobar con
`file frontend/src/types/database.types.ts` (debe ser texto ASCII/UTF-8). `--local` usa otro generador
(otro formato): solo para comprobar, no para sustituir el archivo.

## Rutas tipadas
`typedRoutes` genera `.expo/types/router.d.ts` (ignorado por git) al arrancar `npx expo start`.
Si `tsc` falla con rutas nuevas, arrancar el dev server una vez para regenerarlo.

## Arquitectura objetivo (fuente: docs/FRONTEND_ARCHITECTURE.md)
- Navegación: **Expo Router** (no react-navigation directo). Grupos de rutas `(auth)`, `(onboarding)`,
  `(app)`; redirección según `AuthState` derivado de la sesión + `profiles.onboarding_completed_at`.
- Server state: **TanStack Query**. Sesión y mascota activa: **React Context**. Sin Redux ni Zustand.
- Estructura: `src/lib/supabase.ts` (cliente único) · `src/types/database.types.ts` (generado, no editar)
  · `src/features/<dominio>/{api,hooks,components}` · `src/i18n/`. Código no-ruta fuera de `src/app/`.
- Orden de construcción: Auth+Profile → Onboarding+Pet → Home → Daily logs+offline → Reminders → IA
  → Co-tutores → Logros → Paywall → Reportes. Cada fase deja la app usable de punta a punta.

## Supabase desde el cliente
- Solo `EXPO_PUBLIC_SUPABASE_URL` y `EXPO_PUBLIC_SUPABASE_ANON_KEY`, en `frontend/.env` (Expo no lee el
  `.env` de la raíz). Todo `EXPO_PUBLIC_*` se embebe en el bundle: nunca secretos.
- Tipos generados desde el esquema; nunca interfaces manuales para tablas/RPC.
- `ai_analysis_requests`: seleccionar columnas explícitas (`select('*')` falla a propósito).
- `daily_logs`: guardar siempre con `rpc('save_daily_log', …)` (nunca `upsert`: falla por los GRANT por
  columna); `log_date` se calcula al crear el registro y no se puede cambiar. Contrato:
  `docs/FRONTEND_ARCHITECTURE.md` §4 «DailyLogScreen».
- `pets.owner_id` nunca por update → RPC `transfer_pet_ownership`.
- Sin escritura directa en `pet_co_owners`, `pet_achievements`, `pet_streaks`, `subscriptions`,
  `ai_analysis_requests` → RPCs o backend.
- Push tokens: siempre `rpc('register_push_token', …)` en login, arranque y refresh del token.
- Storage: guardar paths, nunca URLs; `createSignedUrl` bajo demanda (nunca `getPublicUrl`). Paths `{pet_id}/{uuid}.{ext}`
  (`avatars`: `{user_id}/{uuid}.{ext}`). Sin update: borrar y volver a subir.
- Timezone: nombre IANA vía `Intl.DateTimeFormat().resolvedOptions().timeZone`, nunca abreviaturas.
- Las Edge Functions (`ai-analysis-process`, `generate-pet-report`, `delete-account`) pueden devolver
  403/409 aunque la RPC previa haya ido bien: es el contrato, manejarlo. (Aún no implementadas.)
- Errores: mapear según la tabla §6 de FRONTEND_ARCHITECTURE.md.
- Ocultar botones por permisos es UX; la seguridad real está en la BD.
- `organizations` no está desplegado: no usarlo.

## Producto
- i18n desde el día 1 con fallback a inglés: ningún texto visible hardcodeado.
- Accesibilidad: `accessibilityLabel`, tipografía escalable, nunca solo color para indicar estado.
- Copy médico: nunca "diagnóstico". Disclaimer en cada resultado de IA.
- Registro diario completable en <45 s y offline (cola de sincronización).

## Documentación
- Seguir las reglas generales de documentación de `../CLAUDE.md`.
- Para cambios de frontend, mantener alineados `docs/FRONTEND_ARCHITECTURE.md`, `docs/AUTH.md` y
  cualquier guía afectada con el comportamiento real. Registrar allí los cambios de contrato y
  actualizar `docs/CHANGELOG.md` cuando el cambio sea relevante.
