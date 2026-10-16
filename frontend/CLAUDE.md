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
- `src/lib/supabase.ts` — cliente único (sesión en SecureStore troceado, `src/lib/secure-session-storage.ts`,
  clave `AUTH_STORAGE_KEY` = la de supabase-js por defecto: no cambiarla). Su `fetch` es
  `src/lib/user-token-fetch.ts`: ninguna petición de datos sale como `anon`.
- `src/lib/query-client.ts` — QueryClient único; AuthProvider lo vacía al cerrar sesión o cambiar de usuario.
- `src/features/auth/` — `AuthProvider`/`useAuth`, mapeo de errores (`auth-errors.ts`), validación,
  deep links de Auth (`auth-redirect.ts`, flujo PKCE). Guía y configuración de Supabase/Google: `docs/AUTH.md`.
  Estado de la sesión (fase 6): `auth-state.ts` + `auth-session-controller.ts` (puros) y
  `persisted-session.ts` (identidad local sin red). `status`: `loading` | `signed_in` | `offline` |
  `signed_out`; en `offline` hay `user` pero no `session` ni servidor. Toda query/mutación de servidor
  pasa por `serverCall` de `useAuth()` (falla al instante sin sesión utilizable); nunca comprobar
  `session` para decidir si hay usuario (usar `user`), ni dar por válida una sesión `offline`.
- Rutas de Auth: `(auth)/auth-callback.tsx` recibe los enlaces de email y el retorno de Google;
  `update-password.tsx` solo es accesible con una sesión de recuperación.
- `src/app/_layout.tsx` — único punto de protección de rutas (`Stack.Protected`); nunca comprobar la
  sesión pantalla a pantalla.
- `src/i18n/` — `t(key)` tipado; `es` y `en` con las mismas claves (`Translations`), idioma activo `es`
  (detección del dispositivo pendiente). Ningún texto visible fuera de `src/i18n/locales/`.
- `src/components/ui/` — componentes de marca (F1); lista y reglas en «Tema y diseño» abajo.
- `src/features/daily-logs/` — registro diario (hoy: ruta `(app)/pets/[id]/daily-log`, tarjeta en la
  ficha). Guardar es local + motor de sincronización (nunca llamar a `save_daily_log` desde pantallas);
  "hoy" solo con `useTodayLogDate`/`log-date.ts`;
  lógica pura en `daily-log-form.ts`, `log-date.ts` y `daily-log-errors.ts` (probada con `npm test`).
  Historial: `(app)/pets/[id]/daily-logs` y `daily-logs/[date]`, paginación por cursor en
  `daily-log-history.ts` (recibe el cliente por parámetro: probado con `npm test` y contra Supabase local).
  Contrato: `docs/FRONTEND_ARCHITECTURE.md` §4 «DailyLogScreen» y «HistoryScreen». Pendiente:
  borrado, calendario, gráficos y lo pendiente del modo offline (§5).
- `src/features/daily-logs/offline/` — modo offline: modelo local (`local-daily-log.ts`), contenido,
  fusión, errores y backoff (fase 1) y, en fase 2, `daily-log-repository.ts` (escrituras locales de
  una en una), `daily-log-remote.ts` (única escritura remota, con precondición), el motor
  `daily-log-sync-engine.ts`, `sync-triggers.ts`, `daily-log-view.ts` (vistas combinadas) y
  `daily-log-cache.ts` (coherencia con TanStack). Todo puro y probado; el proveedor React está en
  `features/daily-logs/sync/`. Fase 3: resolución de conflictos en `(app)/pets/[id]/daily-logs/resolve/[date]`
  (`components/conflict-resolution.tsx`, `engine.resolveConflict`, `buildResolvedContent`); nunca
  concatenar notas sin que el usuario revise el texto. Fase 4: `daily-log-version.ts` (orden de
  `updated_at`), marca de lectura en `refreshSnapshot` (nunca retroceder), lecturas a través del
  almacén, `engine.discardLocalChanges` (solo local) y `(app)/daily-logs/unsynced`. Una versión nueva
  no sustituye lo que el usuario está escribiendo (`decideSourceChange`). Fase 5 (sesión): cada
  petición del motor lleva el token del dueño (`features/auth/owner-session.ts`, obligatorio en
  `createDailyLogRemote`; nunca la sesión vigente del cliente compartido); una instancia de almacén y
  motor por usuario (`daily-log-sync-sessions.ts`); todas las query keys de Daily Logs llevan `userId`;
  caché y copias de lecturas solo si `isCurrentUser` (AuthProvider). Cerrar sesión en la zona
  autenticada siempre con `useSignOutFlow` (`features/auth/sign-out-flow.ts`, pantalla `(app)/sign-out`),
  nunca `signOut` directo. Ayudantes de pruebas del motor:
  `offline/sync-test-helpers.mjs` y `fake-daily-log-server.mjs`. `updated_at` siempre como la cadena del servidor (nunca por `Date`).
  Contrato: `docs/FRONTEND_ARCHITECTURE.md` §5.
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
  `src/lib/single-flight.ts` — llamadas simultáneas comparten una ejecución (`signOut` de AuthProvider).
- `src/features/profile/` — zona horaria del perfil (lectura: `useProfileTimeZone`, `['profile','timezone']`): `timezone.ts` (detección con `Intl`, validación
  IANA e inicialización; módulo puro, sin imports), `api/profile-api.ts`,
  `hooks/use-profile-timezone-sync.ts` (montado en `(app)/_layout.tsx`). Inicializa `profiles.timezone`
  solo si es `NULL` y nunca la sobrescribe. Contrato: `docs/FRONTEND_ARCHITECTURE.md` §9.
- ESLint configurado (`eslint.config.js`, `eslint-config-expo`).
- Tests de integración: `npm run test:integration` ejecuta `src/**/*.integration.test.mjs` contra el
  Supabase **local** (`scripts/test-integration.mjs` lee URL y clave anónima de `npx supabase status` y
  se niega si no es local). En `npm test` se omiten.
- Tests unitarios: `npm test` (runner de Node 24, sin dependencias; `--test-timeout` de 30 s: un test
  colgado falla. Las pruebas del motor usan temporizadores falsos). Archivos `*.test.mjs` junto al
  módulo; importan el `.ts` directamente (type stripping de Node), así que el módulo probado debe ser
  puro (sin `@/`, React Native ni `__DEV__`). Son `.mjs` porque TypeScript 6 no incluye `@types/node`.
  `import type` con `@/` sí vale (se elimina); un módulo puro que importa otro en ejecución usa ruta
  relativa con extensión (`./otro.ts`).
  Esquema de deep links: `kitom` (`app.json`). Cambiarlo rompe los redirects de Auth (Redirect URLs de
  Supabase) y exige un nuevo development build. `name`/`slug` siguen siendo `frontend`.
  Pendiente: login por teléfono (OTP), cambio de contraseña desde ajustes; en Pets: limpieza de fotos huérfanas,
  archivar (`is_active`), selector de fecha nativo, gestión de co-tutores y límite de mascotas del plan free.

## Tema y diseño (diseño v2, `docs/design/`)

- Referencia: `docs/design/PLAN_DESARROLLO.md` (fases), `PANTALLAS.md` (tablero de cada pantalla),
  `GUIA-DE-MARCA.md` y `componentes/`. Implementación por fases F0–F5; F0 (base) y F1 (componentes) hechas.
- `src/theme/tokens.ts` — copia de `docs/design/tokens/tokens.ts` (generado: no editar a mano; se cambia
  `docs/design/fuente/brand.py`, se regenera y se vuelve a copiar). Colores, tipografía, espaciado,
  radios, elevación, movimiento y urgencias.
- `src/theme/theme-provider.tsx` — `AppThemeProvider` (layout raíz): claro/oscuro según el sistema,
  tema de Expo Router y fondo de la ventana nativa. `useAppTheme()` da `{ scheme, colors }`.
- `src/theme/fonts.ts` — Hanken Grotesk 400/500/600 e IBM Plex Mono 500, importadas por peso; el
  layout raíz mantiene el splash hasta que cargan (si fallan, sigue con las del sistema). El peso va en
  `fontFamily` (tokens), nunca en `fontWeight`.
- Código nuevo: colores de `useTheme()` por nombre de token (`ink`, `inkMuted`, `primary`, `surface`…),
  texto con `Text` (`variant` de `typography`), espaciado y radios de los tokens. Ningún color fijo.
- **Transitorio** (hasta adaptar cada pantalla, F2–F4): `useTheme()` también acepta los nombres
  anteriores (`text`, `textSecondary`, `tint`, `border`…, mapeados a tokens en `hooks/use-theme.ts`;
  ninguno puede llamarse como un token: lo comprueba el compilador),
  `ThemedText` traduce sus `type` a la escala de marca y `constants/theme.ts` conserva `Spacing`. No
  usarlos en código nuevo; se retiran cuando ninguna pantalla los use.
- Iconos: Lucide, **solo** desde `@/components/ui/icons` (uno a uno; importar la raíz de
  `lucide-react-native` mete ~1.900 iconos en el bundle y ESLint lo prohíbe) y con `<Icon>` (trazo 2,
  `iconSize`, oculto a lectores de pantalla). Gráficas y anillos: `react-native-svg`.
- Componentes (`src/components/ui/`, fichas en `docs/design/componentes/`): `Text`, `Button` (primary,
  secondary, ghost, danger, dangerGhost; lg/md/sm; `loading`/`loadingLabel`), `IconButton`, `TextField`
  (+ `FieldError`), `SegmentedControl`, `Chip`, `OptionGroup` (chips de selección única),
  `StepSelector`, `Switch`, `Card`, `ListItem`, `Alert`, `Banner`, `Tag`, `Avatar`, `KitomSymbol`,
  `Skeleton`, `LoadingState`/`ErrorState`/`EmptyState` (`query-state.tsx`), `FormMessage`, `Dialog`,
  `BottomSheet`, `Toast` (`useToast`, proveedor en el layout raíz) y `Screen` (con `footer` para el
  botón principal). Cabeceras de `Stack`: `useStackScreenOptions()`. Elevación: `useElevation()`
  (`boxShadow` en claro, filete en oscuro; nunca `shadow*`).
- Movimiento: pulsación (`usePressFeedback`, 120 ms) y entradas de superposiciones (`motion.ts`,
  200 ms); todo con `ReduceMotion.System` o `useReducedMotion`. Sin gestos nuevos (las hojas se cierran
  con botón, velo o «atrás»). Escrituras de valores compartidos de Reanimated con `.set()` (React
  Compiler no admite asignar `.value` fuera de worklets).
- Galería de componentes **solo de desarrollo**: ruta `/dev-components` (`src/app/dev-components.tsx`,
  protegida con `__DEV__` en el layout raíz). Es la única excepción a «ningún texto fuera de i18n»
  (contenido de muestra del prototipo, nunca visible para usuarios). Útil para revisar cambios de
  componentes en dispositivo. Comprobado en un export de producción: la ruta redirige al login y no
  hace peticiones, pero su código va en el bundle y `expo export` genera `dev-components.html` (sin la
  galería). Antes de la entrega final se decide excluirla del build o retirarla.
- Marca (`app.json`): icono, icono adaptativo de Android (fondo `#0E3B39`, monocromo), splash
  (`splash-icon.png` sobre `#F2F5F3`, `imageWidth` 230 ≈ 84 dp de símbolo, como el tablero 1.0) y
  favicon desde `assets/brand/app-icon/`. Expo Go no muestra icono ni splash propios: se ven en una
  build nativa (pendiente) y el favicon en web. iOS usa el `icon` general (PNG): en SDK 57 `ios.icon`
  solo admite un directorio `.icon` de Icon Composer (iOS 26); crearlo requiere macOS (pendiente).

## Probar contra el Supabase local (`npm run start:local`)

- `npm run start:local` (o `npm run start:local -- --web --port 8091`; los argumentos van a
  `expo start`). Requiere el Supabase local arrancado (`npx supabase start` desde la raíz).
- No modifica `.env`: pasa la URL y la clave **anónima** locales (de `npx supabase status`) como
  variables del proceso, que tienen prioridad sobre los `.env*`. Antes de arrancar Metro comprueba que
  la API es `http://127.0.0.1`/`localhost`, que el endpoint efectivo tras cargar los `.env*` con
  `@expo/env` (el cargador de Expo) sigue siendo el local y que la API responde; si algo falla, termina
  sin arrancar. Nunca imprime claves. Siempre con `--clear` (Metro incrusta los `EXPO_PUBLIC_*`).
- Emulador Android: dentro del emulador `127.0.0.1` es el propio emulador; para llegar al Supabase
  local, `adb reverse tcp:54321 tcp:54321` (y `adb reverse tcp:8081 tcp:8081` para Metro). Un móvil
  físico no puede usar `start:local` (necesitaría la IP de la red local, que el script rechaza).
- Cuentas de prueba: crearlas desde la propia app (el Supabase local no pide confirmar el email).
- Si ya hay otro Metro en el puerto 8081 (p. ej. un `npx expo start` normal, que usa el `.env`
  remoto), usar otro puerto (`-- --port 8083`) y no abrir Expo Go contra el 8081.

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
