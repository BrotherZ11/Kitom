@AGENTS.md

# KITOM — Frontend

## Versiones instaladas (verificar en package.json antes de asumir APIs)
Expo SDK 57 · React Native 0.86.3 · React 19.2.3 · TypeScript ~6.0 (strict) · expo-router 57 · Reanimated 4.5.
`reactCompiler` y `typedRoutes` activos: no añadir `useMemo`/`useCallback` por costumbre; rutas tipadas.
Docs de referencia: https://docs.expo.dev/versions/v57.0.0/
Gestor de paquetes: **npm** (hay `package-lock.json`). Dependencias nuevas con `npx expo install`, previa aprobación.

## Estado actual
Plantilla de create-expo-app. `src/app/index.tsx`, `explore.tsx` y `src/components/*` son de ejemplo
y se sustituirán. Aún NO instalados: supabase-js, TanStack Query, i18n, ESLint config
(`npx expo lint` la crea e instala en su primera ejecución: pedir permiso antes).
`app.json` sigue con `name`/`slug`/`scheme` = `frontend`; el `scheme` afectará a los redirects de Auth.

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
