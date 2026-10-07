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
  Loading/Error/Empty (`query-state.tsx`) (mínimos, no es el design system final).
- ESLint configurado (`eslint.config.js`, `eslint-config-expo`).
Esquema de deep links: `kitom` (`app.json`). Cambiarlo rompe los redirects de Auth (Redirect URLs de
Supabase) y exige un nuevo development build. `name`/`slug` siguen siendo `frontend`.
Pendiente: login por teléfono (OTP), cambio de contraseña desde ajustes; en Pets: subida de fotos,
archivar (`is_active`), selector de fecha nativo, gestión de co-tutores y límite de mascotas del plan free.

## Tipos de Supabase
`src/types/database.types.ts` es generado: no editarlo a mano. Regenerar desde la raíz del repo
(lee el remoto `kitom-dev`, requiere aprobación):
`npx supabase gen types typescript --linked --schema public > frontend/src/types/database.types.ts`

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
- `daily_logs`: `upsert` con `onConflict: 'pet_id,log_date'`; `log_date` se calcula al crear el registro.
- `pets.owner_id` nunca por update → RPC `transfer_pet_ownership`.
- Sin escritura directa en `pet_co_owners`, `pet_achievements`, `pet_streaks`, `subscriptions`,
  `ai_analysis_requests` → RPCs o backend.
- Push tokens: siempre `rpc('register_push_token', …)` en login, arranque y refresh del token.
- Storage: guardar paths, nunca URLs; `createSignedUrl` bajo demanda. Paths `{pet_id}/{uuid}.{ext}`
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
