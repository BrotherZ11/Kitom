# Kitom — Estado del proyecto

Revisión: **2026-11-03** · app `1.1.0` · 15 migraciones en el repo (14 aplicadas en `kitom-dev`; falta
`20261030090318`). Auditoría inicial del 2026-10-29 y estado tras las correcciones. Detalle por área:
[`SECURITY_AUDIT.md`](SECURITY_AUDIT.md), [`DATABASE.md`](DATABASE.md), [`TESTING.md`](TESTING.md),
[`DEPLOYMENT.md`](DEPLOYMENT.md), [`PRIVACY.md`](PRIVACY.md); plan: [`ROADMAP.md`](ROADMAP.md).

## 1. Estado global

El código de la primera versión (Android, gratuita) está prácticamente terminado: registro diario y
mascotas con modo offline, agenda con avisos, consultas con IA, co-tutores, logros, eliminar la cuenta,
descargar los datos, textos legales y selector de idioma automático. Todo el backend aplica RLS y el
cliente nunca decide plan, propietario ni estado de IA.

**Todavía no se puede publicar.** Lo que falta ya no es código, sino acciones con cuentas y terceros
(`DEPLOYMENT.md` §8): proyecto de producción, aplicar la última migración, desplegar las Edge Functions,
verificar la IA en el remoto con plan de pago, activar las páginas legales, revisión legal y veterinaria,
cuenta de Google Play, build firmada con EAS y pruebas en móviles reales.

Decisión: **NO PUBLICAR todavía**; **CANDIDATA A BETA** cerrada en cuanto se completen esos pasos (§7).

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
| 1 | Registro e inicio de sesión con email | COMPLETA Y VERIFICADA | `features/auth/`, integración local y emulador Android (registro, casilla de términos, regla de 8 caracteres, redirección) | confirmar el email real en producción | P1 |
| 2 | Inicio de sesión con Google | IMPLEMENTADA, NO VERIFICADA | `auth-context.tsx:141-166`, PKCE (`auth-redirect.ts`); guía `docs/AUTH.md` | configurar cliente OAuth y redirecciones en producción; probar en Android/iOS | P1 |
| 3 | Inicio de sesión con teléfono | PENDIENTE (retirada del alcance, decisión 2026-10-29) | fila y textos eliminados de la app | nada: no se va a implementar | — |
| 4 | Recuperación de contraseña | IMPLEMENTADA, NO VERIFICADA | marca persistente por usuario (`password-recovery.ts`), enlace válido con la sesión iniciada, pruebas unitarias | probar con un email real y matando la app | P1 |
| 5 | Confirmación de email por deep link | IMPLEMENTADA, NO VERIFICADA | `app/auth-callback.tsx`, «Reenviar email» con espera de 60 s, salida a los 15 s; reenvío comprobado contra el Auth local | probar con email real en un móvil | P1 |
| 6 | Sesión persistente, renovación y arranque sin conexión | COMPLETA Y VERIFICADA | `auth-session-controller.ts`, `persisted-session.ts`, SecureStore; unitarias + integración; validada en emulador Android | iOS; red que vuelve en segundo plano | P2 |
| 7 | Cierre de sesión con cambios pendientes | COMPLETA Y VERIFICADA | `sign-out-flow.ts`, `(app)/sign-out.tsx`; pruebas del flujo | purga de datos locales (SEC-08) | P1 |
| 8 | Configuración inicial (perfil, aviso, privacidad, primera mascota) | IMPLEMENTADA, NO VERIFICADA | `(app)/setup/*`, `useOnboardingGate`; test de onboarding | `profiles.locale` nunca se escribe; validación manual registrada | P2 |
| 9 | Aviso veterinario obligatorio | COMPLETA Y VERIFICADA | `setup/disclaimer.tsx` + `request_ai_analysis` lo exige (`ai_disclaimer_required`, pgTAP, aplicado en `kitom-dev`); probado en emulador | — | — |
| 10 | Mascotas: crear, ver, editar, borrar (online) | COMPLETA Y VERIFICADA | `features/pets/`, pgTAP, concurrencia, integración; selector de fecha nativo probado en emulador | sin archivar | P3 |
| 11 | Mascotas sin conexión: lectura, altas y ediciones | COMPLETA Y VERIFICADA | motor `pet-sync-engine.ts`, `client_request_id`; fase 8.5 validada a mano | — | — |
| 12 | Mascotas: eliminación sin conexión con deshacer | IMPLEMENTADA, NO VERIFICADA | fase 10; unitarias + concurrencia | validación manual | P2 |
| 13 | Fotos de mascota | IMPLEMENTADA, NO VERIFICADA | `pet-photos-remote.ts`, bucket `pet-photos` | nunca probadas contra un bucket remoto; límites del bucket (SEC-07) | P1 |
| 14 | Catálogo de razas sin conexión | IMPLEMENTADA, NO VERIFICADA | fase 9, `offline/breed-catalog-*` | validación manual | P2 |
| 15 | Limpieza de Storage al borrar una mascota | BLOQUEADA | Edge Function probada en local; `pg_cron`/`pg_net` y tareas en la migración `20261030090318`, inactivas sin secretos en Vault | `db push`, desplegar la función y crear los secretos (`DEPLOYMENT.md` §8) | P1 |
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
| 28 | Co-tutores: invitar por email, aceptar, rol, revocar | IMPLEMENTADA, NO VERIFICADA | `features/co-owners/`, 7 RPC, pgTAP; solo a cuentas confirmadas; límite de 20/24 h e identidad oculta de pendientes en `20261030090318` | `db push`; prueba manual con dos cuentas; riesgo residual SEC-04 | P1 |
| 29 | Co-tutor: abandonar mascota / transferir propiedad | PENDIENTE | `transfer_pet_ownership` existe sin cliente; no hay RPC para abandonar | RPC + UI | P2 |
| 30 | Consulta con IA (foto + síntomas) | BLOQUEADA | cliente → `request_ai_analysis` → `ai-analysis-process`; cupo a prueba de borrados, foto rechazada ya no queda huérfana, sin indicadores infinitos, límites de abuso en `20261030090318` | **verificar el pipeline en `kitom-dev`** (2 análisis `pending`, ninguno completado: secreto y logs), plan de pago de Gemini, validación del prompt por un veterinario | P0 |
| 31 | Valoración de la orientación (útil / no útil) | IMPLEMENTADA, NO VERIFICADA | RPC `submit_ai_feedback` | pgTAP | P2 |
| 32 | Ajustes: nombre, zona horaria, tema, notificaciones, seguridad, privacidad, ayuda, legal | COMPLETA Y VERIFICADA | `(app)/settings/*` recorridos en emulador; pgTAP `profile_timezone` | preferencias de alertas/marketing no editables | P3 |
| 33 | Cambiar contraseña | IMPLEMENTADA, NO VERIFICADA | pide la actual con un cliente de Auth aparte (integración local), código de reautenticación, «Crear contraseña» para cuentas de Google | prueba manual; reautenticación con el Dashboard configurado | P1 |
| 34 | Eliminar cuenta | COMPLETA Y VERIFICADA (local) | `delete-account` + pantalla; integración local (6/6) y de punta a punta en emulador contra el Supabase local | desplegar en `kitom-dev`/producción | P0 |
| 35 | Exportar mis datos | COMPLETA Y VERIFICADA (Android) | `settings/export`, menú de compartir y JSON revisado en emulador; lógica con pruebas | — | — |
| 36 | Premium / suscripción | PENDIENTE (fuera de la v1, decisión 2026-10-29) | retirado de la interfaz; `process_revenuecat_event` en BD sin webhook | decisión de precio y límites; webhook; productos en tiendas | P3 |
| 37 | Informes PDF para el veterinario | PENDIENTE | `request_generate_report` es un esbozo; sin Edge Function | — | P3 |
| 38 | Idiomas | COMPLETA Y VERIFICADA | idioma del dispositivo (`i18n/locale.ts`): inglés en emulador, español en web | textos de permisos de iOS (al publicar en iOS) | P3 |
| 39 | Política de privacidad y términos | PARCIAL | `site/` (es/en), enlaces en registro y ajustes, consentimiento de IA exacto | activar GitHub Pages; revisión legal; plan de pago de Gemini | P0 |
| 40 | Clínicas y referidos | PENDIENTE | tablas y RPC sin cliente | SEC-13 antes de activarlo | P3 |
| 41 | Analítica de producto | PENDIENTE | `analytics_events` sin cliente | decidir herramienta y consentimiento | P3 |
| 42 | Organizaciones (B2B) | PENDIENTE (fuera del MVP) | archivo 27 no desplegado | — | — |

Totales: 16 COMPLETA Y VERIFICADA · 12 IMPLEMENTADA, NO VERIFICADA · 1 PARCIAL · 0 INCOMPLETA · 11 PENDIENTE · 2 BLOQUEADA · 0 CON ERRORES (42 funcionalidades; «verificada» con la matización de cada fila, nada en iOS ni en un móvil físico).

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
| Google AI Studio (Gemini) | función desplegada; secreto no verificable desde aquí; plan gratuito no apto para usuarios reales (los textos legales describen el plan de pago) |
| Google Cloud OAuth (login con Google) | por verificar en producción |
| Google Play Console / Expo (EAS) | `eas.json` preparado; faltan las cuentas. Apple, tras la v1 (Android primero) |
| RevenueCat | no integrado |
| Asesoría legal y veterinario asesor | necesarios: textos legales y validación del prompt |
| SMTP propio para emails de Auth | no configurado (el SMTP por defecto de Supabase tiene límites muy bajos) |

## 6. Riesgos pendientes

1. Coste de IA sin control (SEC-01, SEC-06) y pipeline remoto no verificado.
2. Rechazo en tiendas por falta de eliminación de cuenta, política de privacidad y declaraciones.
3. Tratamiento de datos (fotos y salud de mascotas, notas del dueño) sin base legal documentada.
4. iOS: nunca compilado ni probado (fuera de la v1).
5. Monitorización: Sentry integrado en el código, inactivo hasta tener DSN.
6. Mantenimiento: documentación muy extensa (`FRONTEND_ARCHITECTURE.md` 1663 líneas, `DECISIONS.md`
   1166) que hay que mantener sincronizada.

## 7. Decisión de lanzamiento

**NO PUBLICAR todavía.** Los bloqueantes de código están resueltos; quedan los externos de
`DEPLOYMENT.md` §8. Con ellos hechos, el objetivo es **CANDIDATA A BETA** cerrada en la prueba cerrada de
Google Play, y producción tras esa beta en móviles reales. Esta decisión se basa en pruebas automáticas y
en un emulador Android: no hay validación en dispositivos físicos ni del pipeline de IA en el remoto.
