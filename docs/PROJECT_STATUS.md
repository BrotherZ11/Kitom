# Kitom — Estado del proyecto

Revisión: **2026-10-29** · `main` @ `41d0a07` · app `1.1.0` (Android `versionCode` 2) · 13 migraciones
(iguales en el repo y en `kitom-dev`). Auditoría integral: inventario, frontend, backend, seguridad,
pruebas y preparación para publicar. Detalle por área: [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md),
[`DATABASE.md`](DATABASE.md), [`TESTING.md`](TESTING.md), [`DEPLOYMENT.md`](DEPLOYMENT.md),
[`PRIVACY.md`](PRIVACY.md); plan: [`ROADMAP.md`](ROADMAP.md).

## 1. Estado global

El MVP funcional está construido y es sólido en lo más difícil (registro diario y mascotas con modo
offline, sincronización con conflictos, sesión sin conexión, agenda con avisos locales, consultas con
IA a través de Edge Function, co-tutores). La base de datos aplica RLS en todas las tablas y el
cliente nunca decide plan, propietario ni estado de IA.

**No está lista para usuarios reales.** Bloquean el lanzamiento: falta eliminar la cuenta desde la app,
no hay política de privacidad ni términos, el consentimiento de IA no describe el uso real del proveedor,
la cuota de IA se puede eludir, no hay entorno de producción separado ni firma de release (sin EAS,
sin `ios.bundleIdentifier`) y nunca se ha probado en iOS ni con el pipeline de IA completo en el remoto.

Decisión: **NO PUBLICAR** (ver §7).

### Alcance de la revisión y límites

- Revisado: todo el código de `frontend/src`, `supabase/migrations`, `supabase/functions`, tests,
  configuración y documentación; `kitom-dev` en **solo lectura** (advisors, migraciones, funciones,
  buckets, extensiones, recuentos agregados).
- Ejecutado: ver [`TESTING.md`](TESTING.md) §3 (TypeScript, lint, 749 tests unitarios, 63 de
  integración, pgTAP, concurrencia, Edge Functions, `expo-doctor`, `npm audit`).
- **No** realizado: inspección visual en dispositivo o emulador (el análisis de UX es sobre el código),
  builds nativas, iOS, configuración de Auth del remoto (Dashboard), secretos del remoto, pruebas en
  tiendas.

## 2. Método de clasificación

Estados permitidos: **COMPLETA Y VERIFICADA** · **IMPLEMENTADA, NO VERIFICADA** · **PARCIAL** ·
**INCOMPLETA** · **PENDIENTE** · **BLOQUEADA** · **CON ERRORES**.

«Verificada» exige pruebas automáticas que ejercen el flujo contra el Supabase local (integración,
pgTAP o concurrencia) **y** validación manual documentada en `CLAUDE.md`/`CHANGELOG.md` (emulador
Android o web). Nada está verificado en iOS ni en un dispositivo físico. No se usan porcentajes de
avance: no hay un método reproducible que los respalde.

## 3. Inventario de funcionalidades

| # | Funcionalidad | Estado | Evidencia | Qué falta | Prioridad |
|---|---|---|---|---|---|
| 1 | Registro e inicio de sesión con email | COMPLETA Y VERIFICADA | `features/auth/auth-context.tsx`, errores mapeados (`auth-errors.ts`), integración local | reenviar email de confirmación, aceptación de términos, regla visible de longitud | P1 |
| 2 | Inicio de sesión con Google | IMPLEMENTADA, NO VERIFICADA | `auth-context.tsx:141-166`, PKCE (`auth-redirect.ts`); guía `docs/AUTH.md` | configurar cliente OAuth y redirecciones en producción; probar en Android/iOS | P1 |
| 3 | Inicio de sesión con teléfono | PENDIENTE | «Próximamente» en `settings/security.tsx` | OTP SMS, proveedor, verificación de `profiles.phone` | P3 |
| 4 | Recuperación de contraseña | PARCIAL | `forgot-password.tsx`, `update-password.tsx`, `resetPasswordForEmail` | persistir el estado de recuperación (`auth-context.tsx:107`); aceptar el enlace con sesión abierta | P1 |
| 5 | Confirmación de email por deep link | PARCIAL | `(auth)/auth-callback.tsx`, `kitom://auth-callback` | reenviar email; tiempo límite si no llega la URL (spinner infinito) | P1 |
| 6 | Sesión persistente, renovación y arranque sin conexión | COMPLETA Y VERIFICADA | `auth-session-controller.ts`, `persisted-session.ts`, SecureStore; unitarias + integración; validada en emulador Android | iOS; red que vuelve en segundo plano | P2 |
| 7 | Cierre de sesión con cambios pendientes | COMPLETA Y VERIFICADA | `sign-out-flow.ts`, `(app)/sign-out.tsx`; pruebas del flujo | purga de datos locales (SEC-08) | P1 |
| 8 | Configuración inicial (perfil, aviso, privacidad, primera mascota) | IMPLEMENTADA, NO VERIFICADA | `(app)/setup/*`, `useOnboardingGate`; test de onboarding | `profiles.locale` nunca se escribe; validación manual registrada | P2 |
| 9 | Aviso veterinario obligatorio | PARCIAL | `setup/disclaimer.tsx` guarda versión y fecha | el servidor no lo exige (SEC-10) | P0 |
| 10 | Mascotas: crear, ver, editar, borrar (online) | COMPLETA Y VERIFICADA | `features/pets/`, pgTAP, concurrencia, integración | fecha de nacimiento como texto libre (`pet-form.tsx:269`), sin archivar | P2 |
| 11 | Mascotas sin conexión: lectura, altas y ediciones | COMPLETA Y VERIFICADA | motor `pet-sync-engine.ts`, `client_request_id`; fase 8.5 validada a mano | — | — |
| 12 | Mascotas: eliminación sin conexión con deshacer | IMPLEMENTADA, NO VERIFICADA | fase 10; unitarias + concurrencia | validación manual | P2 |
| 13 | Fotos de mascota | IMPLEMENTADA, NO VERIFICADA | `pet-photos-remote.ts`, bucket `pet-photos` | nunca probadas contra un bucket remoto; límites del bucket (SEC-07) | P1 |
| 14 | Catálogo de razas sin conexión | IMPLEMENTADA, NO VERIFICADA | fase 9, `offline/breed-catalog-*` | validación manual | P2 |
| 15 | Limpieza de Storage al borrar una mascota | BLOQUEADA | migraciones aplicadas; Edge Function `pet-storage-cleanup` probada en local | despliegue, secreto y tarea programada: el remoto no tiene `pg_cron` ni `pg_net` | P1 |
| 16 | Registro diario de hoy | COMPLETA Y VERIFICADA | `pets/[id]/daily-log.tsx`, RPC `save_daily_log`, pgTAP (186 casos), concurrencia | — | — |
| 17 | Historial y edición de registros anteriores | COMPLETA Y VERIFICADA | `pet-history.tsx`, paginación por cursor, integración | lista sin virtualizar (rendimiento con meses de datos) | P2 |
| 18 | Sincronización offline y resolución de conflictos (registros) | COMPLETA Y VERIFICADA | `daily-logs/offline/*` (21 archivos de test), pantalla de resolución, «sin sincronizar» | coordinación entre pestañas en web | P3 |
| 19 | Borrar un registro diario | PENDIENTE | documentado como pendiente | UI + motor offline | P2 |
| 20 | Gráficos y calendario del historial (semana / mes) | IMPLEMENTADA, NO VERIFICADA | `pet-history.tsx` usa `TrendChart` y `MonthCalendar`; test de `chart-geometry` | validación manual; `frontend/CLAUDE.md` aún lo da por pendiente | P3 |
| 21 | Rachas | COMPLETA Y VERIFICADA | `recompute_pet_streak` (trigger), pgTAP | — | — |
| 22 | Logros | IMPLEMENTADA, NO VERIFICADA | concedidos por la BD (`award_pet_achievement` desde rachas y consultas); `pets/[id]/achievements.tsx` | pgTAP de concesión; «primera consulta» se concede al pedirla, no al completarla | P2 |
| 23 | Desafíos semanales | PENDIENTE | «Próximamente» en logros | diseño y backend | P3 |
| 24 | Agenda y recordatorios (CRUD, repetición, posponer, activar/desactivar) | COMPLETA Y VERIFICADA | `features/reminders/`, pgTAP `reminders*.test.sql`, fase 13 validada en web y Android | sin conexión (propuesta `docs/proposals/2026-10-28-reminders-offline.md`) | P2 |
| 25 | Avisos locales (incluidas alarmas exactas en Android) | COMPLETA Y VERIFICADA (Android) | `notification-sync.tsx`, módulo `modules/kitom-exact-alarms`; build debug en emulador | iOS sin probar; declaración de `SCHEDULE_EXACT_ALARM` en Play | P1 |
| 26 | Notificaciones push remotas | PENDIENTE | tabla `push_tokens` y RPC sin cliente | solo si el producto las necesita para el lanzamiento | P3 |
| 27 | Adjuntos de recordatorios | PENDIENTE | bucket `reminder-attachments` sin cliente | — | P3 |
| 28 | Co-tutores: invitar por email, aceptar, rol, revocar | IMPLEMENTADA, NO VERIFICADA | `features/co-owners/`, 7 RPC, pgTAP `pet_invitations` | enumeración de cuentas (SEC-04), email sin confirmar (SEC-05), sin límite por plan | P0/P1 |
| 29 | Co-tutor: abandonar mascota / transferir propiedad | PENDIENTE | `transfer_pet_ownership` existe sin cliente; no hay RPC para abandonar | RPC + UI | P2 |
| 30 | Consulta con IA (foto + síntomas) | CON ERRORES | cliente → `request_ai_analysis` → `ai-analysis-process` (desplegada en `kitom-dev`); disclaimer en cada resultado | cuota eludible (SEC-01); fotos huérfanas (SEC-19); spinner infinito si `completed` sin urgencia; 2 análisis del remoto siguen en `pending` y ninguno completado: pipeline remoto sin verificar; prompt sin validar por veterinario | P0 |
| 31 | Valoración de la orientación (útil / no útil) | IMPLEMENTADA, NO VERIFICADA | RPC `submit_ai_feedback` | pgTAP | P2 |
| 32 | Ajustes: nombre, zona horaria, tema, notificaciones, seguridad, privacidad, ayuda, legal | IMPLEMENTADA, NO VERIFICADA | `(app)/settings/*`; pgTAP `profile_timezone` | preferencias de alertas/marketing no editables; textos legales vacíos | P1 |
| 33 | Cambiar contraseña | PARCIAL | `settings/password.tsx` | reautenticación (SEC-17) | P1 |
| 34 | Eliminar cuenta | PENDIENTE | UI oculta, `delete-account` inexistente | **bloqueante de tiendas** (SEC-02) | P0 |
| 35 | Exportar mis datos | PENDIENTE | — | RGPD art. 20 o canal de solicitud | P1 |
| 36 | Premium / suscripción | BLOQUEADA | sin RevenueCat ni paywall; `process_revenuecat_event` en BD sin webhook | decisión de precio y límites; webhook; productos en tiendas | P3 (si se lanza solo gratis) |
| 37 | Informes PDF para el veterinario | PENDIENTE | `request_generate_report` es un esbozo; sin Edge Function | — | P3 |
| 38 | Idiomas | PARCIAL | `es` y `en` con las mismas claves; idioma fijo `es` (`i18n/index.ts`) | detección del dispositivo; textos de permisos solo en español (`app.json`) | P2 |
| 39 | Política de privacidad y términos | BLOQUEADA | `settings/legal.tsx`: «se publicarán antes del lanzamiento» | asesoría legal | P0 |
| 40 | Clínicas y referidos | PENDIENTE | tablas y RPC sin cliente | SEC-13 antes de activarlo | P3 |
| 41 | Analítica de producto | PENDIENTE | `analytics_events` sin cliente | decidir herramienta y consentimiento | P3 |
| 42 | Organizaciones (B2B) | PENDIENTE (fuera del MVP) | archivo 27 no desplegado | — | — |

Totales: 11 COMPLETA Y VERIFICADA · 10 IMPLEMENTADA, NO VERIFICADA · 5 PARCIAL · 0 INCOMPLETA ·
12 PENDIENTE · 3 BLOQUEADA · 1 CON ERRORES (42 funcionalidades; la nº 25 cuenta como verificada solo en Android).

## 4. Bugs y limitaciones conocidas

Defectos demostrables por código (no reproducidos en dispositivo salvo que se indique):

| ID | Problema | Dónde |
|---|---|---|
| BUG-01 | Cuota de IA eludible borrando la mascota (SEC-01) | `get_ai_analysis_entitlement` |
| BUG-02 | Resultado de IA `completed` sin `urgency_level` → spinner infinito (el sondeo ya se detuvo) | `consult/[analysisId].tsx` |
| BUG-03 | Un reintento manual de IA que falla no muestra error | `consult/[analysisId].tsx` |
| BUG-04 | Foto de consulta subida antes de la RPC; si falla queda huérfana y cada reintento sube otra | `use-ai-analysis.ts`, `consult/new.tsx` |
| BUG-05 | Errores de `request_ai_analysis` mapeados por texto en español del servidor | `ai-analysis-model.ts:57-66` |
| BUG-06 | `auth-callback` sin tiempo límite: spinner infinito si no llega la URL | `(auth)/auth-callback.tsx` |
| BUG-07 | Estado de recuperación de contraseña solo en memoria | `auth-context.tsx:107` |
| BUG-08 | UUID de fotos con `Math.random` (contradice la regla del proyecto; no es un riesgo de seguridad) | `features/pets/pet-photo.ts:59` |
| BUG-09 | Recordatorios en la zona del dispositivo y «hoy» en la del perfil: pueden no coincidir cerca de medianoche si difieren (decisión documentada) | `features/reminders/` |
| BUG-10 | Comentarios obsoletos que dicen que consultas y co-tutores no existen | `pet-profile.tsx:69`, `settings/privacy.tsx:26` |
| TEST-01 | pgTAP `daily_logs` caso 121 falla según los OID del entorno: el escenario «cascada desfavorable» no se reproduce en el local actual | `supabase/tests/database/daily_logs.test.sql:702-711` |
| TEST-02 | Integración de `pet-storage-cleanup` falla si la cola local tiene trabajos vencidos de otras pruebas (392 en el local actual) | `cleanup.integration.test.mjs:161-162` |

Limitaciones de diseño: agenda solo con conexión; sin coordinación entre pestañas en web; copia
local sin cifrar y sin limpieza de cuentas que no vuelven; listas renderizadas con `ScrollView` + `map`
(sin `FlatList`); componentes grandes (`pet-operation.ts` 781 líneas, `pet-sync-engine.ts` 684,
`pet-history.tsx` 588).

### Estado tras las correcciones de esta auditoría (2026-10-29)

| Rama | Corrige | Verificación | Falta |
|---|---|---|---|
| `db/ai-quota-and-invitations` | BUG-01 (SEC-01), SEC-05, SEC-07 (`pet-photos`), SEC-10, SEC-11, SEC-12 (`search_path`), TEST-01 | pgTAP 406/406, concurrencia, integración 63/63, `db diff --local` | PR, `db push` del usuario en `kitom-dev` |
| `fix/audit-hardening` | BUG-02, BUG-03, BUG-04, BUG-05, BUG-06, BUG-08, BUG-10 | `tsc`, lint, 752/752 unitarias, 63/63 integración | PR; validación manual (consulta con foto rechazada, enlace de Auth sin respuesta) |

Siguen abiertos: BUG-07, BUG-09, TEST-02 y todo lo demás de este documento. El inventario del §3
describe `main`: la funcionalidad nº 30 (consulta con IA) seguirá **CON ERRORES** en `kitom-dev`
hasta aplicar la migración.

## 5. Dependencias externas

| Dependencia | Estado |
|---|---|
| Supabase `kitom-dev` (desarrollo) | operativo; 13 migraciones; `ai-analysis-process` desplegada (v1, `verify_jwt`) |
| Supabase de producción | **no existe** |
| Google AI Studio (Gemini) | función desplegada; secreto no verificable desde aquí; plan gratuito no apto para usuarios reales |
| Google Cloud OAuth (login con Google) | por verificar en producción |
| Apple Developer / Google Play Console | sin evidencia de cuentas; sin `eas.json` |
| RevenueCat | no integrado |
| Asesoría legal y veterinario asesor | necesarios: textos legales y validación del prompt |
| SMTP propio para emails de Auth | no configurado (el SMTP por defecto de Supabase tiene límites muy bajos) |

## 6. Riesgos pendientes

1. Coste de IA sin control (SEC-01, SEC-06) y pipeline remoto no verificado.
2. Rechazo en tiendas por falta de eliminación de cuenta, política de privacidad y declaraciones.
3. Tratamiento de datos (fotos y salud de mascotas, notas del dueño) sin base legal documentada.
4. Primer contacto con iOS en el momento del lanzamiento (nunca compilado ni probado).
5. Sin monitorización de errores en producción (no hay Sentry ni equivalente).
6. Mantenimiento: documentación muy extensa (`FRONTEND_ARCHITECTURE.md` 1663 líneas, `DECISIONS.md`
   1166) que hay que mantener sincronizada.

## 7. Decisión de lanzamiento

**NO PUBLICAR.** Hay bloqueantes de cumplimiento (SEC-02, SEC-03), de coste (SEC-01) y de
distribución (firma, iOS, entorno de producción). Tras cerrar P0 de [`ROADMAP.md`](ROADMAP.md) y la
validación en dispositivos reales, el objetivo es **CANDIDATA A BETA** cerrada (testers de Play y
TestFlight).
