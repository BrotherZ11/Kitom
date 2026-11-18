# Kitom — Estado del proyecto

Revisión: **2026-11-18** · app `1.1.0` · 20 migraciones en el repo, todas aplicadas en `kitom-dev` (la última,
`20261116160000_premium_plans`, Kitom Premium, por el usuario el 2026-11-18; ver §9). Pruebas a fondo y pendientes de esta revisión:
[`QA_2026-11-16.md`](QA_2026-11-16.md). Auditoría inicial del 2026-10-29 y estado tras las correcciones. Detalle por área:
[`SECURITY_AUDIT.md`](SECURITY_AUDIT.md), [`DATABASE.md`](DATABASE.md), [`TESTING.md`](TESTING.md),
[`DEPLOYMENT.md`](DEPLOYMENT.md), [`PRIVACY.md`](PRIVACY.md); plan: [`ROADMAP.md`](ROADMAP.md).

## 1. Estado global

El código de la primera versión (Android, con Kitom Premium desde el 2026-11-16) está prácticamente terminado: registro diario y
mascotas con modo offline, agenda con avisos, consultas con IA, co-tutores, logros, eliminar la cuenta,
descargar los datos, textos legales y selector de idioma automático. Todo el backend aplica RLS y el
cliente nunca decide plan, propietario ni estado de IA.

**Todavía no se puede publicar.** Lo que falta ya no es código, sino acciones con cuentas y terceros
(`DEPLOYMENT.md` §8): proyecto de producción, verificar la IA en el remoto (y su plan de pago antes de usuarios
del EEE), publicar las páginas legales, revisión legal y veterinaria, cuenta de Google Play, build firmada con EAS y
pruebas en móviles reales.

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
| 1 | Registro e inicio de sesión con email | COMPLETA Y VERIFICADA | `features/auth/`, integración local y emulador Android (registro, aviso legal único, regla de 8 caracteres, redirección); plantillas y página puente de email probadas en local | SMTP propio y Redirect URLs (`SETUP_GUIDE.md`); confirmar el email real en producción | P0 |
| 2 | Inicio de sesión con Google | IMPLEMENTADA, NO VERIFICADA | Android: selector nativo (`google-native-sign-in.ts`, `signInWithIdToken`, 2026-11-16); web, Expo Go y builds sin `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`: navegador con PKCE (`auth-redirect.ts`); guía `docs/AUTH.md` §4 | falta el cliente Android en Google Cloud, el ID web en Supabase y en la build y probarlo en un móvil; después, quitar la URI de supabase.co y pedir la verificación de marca (`SETUP_GUIDE.md`) | P1 |
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
| 24 | Agenda y recordatorios (CRUD, repetición, posponer, activar/desactivar) | COMPLETA Y VERIFICADA | `features/reminders/`, pgTAP `reminders*.test.sql`, fase 13 validada en web y Android; sin conexión (fase 14) con pruebas unitarias y de integración | probar la fase 14 en web | P2 |
| 25 | Avisos locales (incluidas alarmas exactas en Android) | COMPLETA Y VERIFICADA (Android) | `notification-sync.tsx`, módulo `modules/kitom-exact-alarms`; build debug en emulador | iOS sin probar; declaración de `SCHEDULE_EXACT_ALARM` en Play | P1 |
| 26 | Notificaciones push remotas | PENDIENTE | tabla `push_tokens` y RPC sin cliente | solo si el producto las necesita para el lanzamiento | P3 |
| 27 | Adjuntos de recordatorios | PENDIENTE | bucket `reminder-attachments` sin cliente | — | P3 |
| 28 | Co-tutores: invitar por email, aceptar, rol, revocar | IMPLEMENTADA, NO VERIFICADA | `features/co-owners/`, 7 RPC, pgTAP; solo a cuentas confirmadas; límite de 20/24 h e identidad oculta de pendientes en `20261030090318` | `db push`; prueba manual con dos cuentas; riesgo residual SEC-04 | P1 |
| 29 | Co-tutor: abandonar mascota / transferir propiedad | PENDIENTE | `transfer_pet_ownership` existe sin cliente; no hay RPC para abandonar | RPC + UI | P2 |
| 30 | Consulta con IA (foto + señales + contexto del tutor; v2 del 2026-11-13: 9 especies, 72 señales, resumen, señales de alerta, preguntas para el veterinario, compartir) | BLOQUEADA | cliente → `request_ai_analysis` → `ai-analysis-process`; cupo a prueba de borrados, foto rechazada ya no queda huérfana, sin indicadores infinitos, límites de abuso en `20261030090318` | verificar una consulta real hasta `completed` en `kitom-dev` (v2 desplegada el 2026-11-15); **plan de pago de Gemini** antes de usuarios del EEE (hoy, gratuito: §8); validación del prompt, señales y reglas por un veterinario. Recorrido completo probado en local con el simulador (web y emulador) | P0 |
| 31 | Valoración de la orientación (útil / no útil) | IMPLEMENTADA, NO VERIFICADA | RPC `submit_ai_feedback` | pgTAP | P2 |
| 32 | Ajustes: nombre, zona horaria, tema, notificaciones, seguridad, privacidad, ayuda, legal | COMPLETA Y VERIFICADA | `(app)/settings/*` recorridos en emulador; pgTAP `profile_timezone` | preferencias de alertas/marketing no editables | P3 |
| 33 | Cambiar contraseña | IMPLEMENTADA, NO VERIFICADA | pide la actual con un cliente de Auth aparte (integración local), código de reautenticación, «Crear contraseña» para cuentas de Google | prueba manual; reautenticación con el Dashboard configurado | P1 |
| 34 | Eliminar cuenta | COMPLETA Y VERIFICADA (local) | `delete-account` + pantalla; integración local (9/9) y de punta a punta en emulador contra el Supabase local | producción | P0 |
| 35 | Exportar mis datos | COMPLETA Y VERIFICADA (Android) | `settings/export`, menú de compartir y JSON revisado en emulador; lógica con pruebas | — | — |
| 36 | Kitom Premium (suscripción) | IMPLEMENTADA, NO VERIFICADA | decisión 2026-11-16; migración `20261116160000` (pgTAP 72, concurrencia), `revenuecat-webhook` y `subscription-sync` (unitarias e integración local), `features/subscription/` y `/premium`; límites comprobados en web con una compra simulada | `db push`; Play Console, RevenueCat, secretos y despliegue (`SETUP_GUIDE.md` §7); compra real con un tester de licencia; revisión legal (`QA_2026-11-16.md` §4) | P0 |
| 37 | Informes PDF para el veterinario | PENDIENTE | `request_generate_report` es un esbozo; sin Edge Function | — | P3 |
| 38 | Idiomas | COMPLETA Y VERIFICADA | idioma del dispositivo (`i18n/locale.ts`): inglés en emulador, español en web | textos de permisos de iOS (al publicar en iOS) | P3 |
| 39 | Política de privacidad y términos | PARCIAL | `site/` (es/en), copia dentro de la app (`/legal/[doc]`), aviso único en el registro, consentimiento de IA exacto | publicar `site/` con un `push` (Pages ya activado); revisión legal | P0 |
| 40 | Clínicas y referidos | PENDIENTE | tablas y RPC sin cliente | SEC-13 antes de activarlo | P3 |
| 41 | Analítica de producto | PENDIENTE | `analytics_events` sin cliente | decidir herramienta y consentimiento | P3 |
| 42 | Organizaciones (B2B) | PENDIENTE (fuera del MVP) | archivo 27 no desplegado | — | — |
| 43 | Señales de cambio respecto a lo normal | COMPLETA Y VERIFICADA | `change-signals.ts` (pruebas unitarias), tarjeta en Hoy comprobada en emulador con historial sembrado | umbrales sin validar por un veterinario | P2 |
| 44 | Campos por especie (9 especies) en la ficha y el registro diario | IMPLEMENTADA, NO VERIFICADA (Android; ficha y registro de una gata recorridos en el emulador el 2026-11-13) | migración `20261111120000_species_fields` (pgTAP; aplicada en `kitom-dev` el 2026-11-12), `features/species/`, paridad app/BD en integración; recorrido en web contra el Supabase local | revisión veterinaria de los campos; redesplegar `ai-analysis-process`; validación en Android | P1 |
| 45 | Resumen de bienestar (resumen, evolución, observaciones) | IMPLEMENTADA, NO VERIFICADA (Android) | `features/wellness/` (pruebas unitarias), lectura por rango con cobertura local; recorrido en web | revisión veterinaria del texto de las observaciones; prueba sin conexión en Android | P1 |

Totales: 17 COMPLETA Y VERIFICADA · 15 IMPLEMENTADA, NO VERIFICADA · 1 PARCIAL · 0 INCOMPLETA · 10 PENDIENTE · 2 BLOQUEADA · 0 CON ERRORES (45 funcionalidades; «verificada» con la matización de cada fila, nada en iOS ni en un móvil físico).

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

Limitaciones de diseño: sin coordinación entre pestañas en web; copia
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
| Supabase `kitom-dev` (desarrollo) | operativo; 19 migraciones; `ai-analysis-process` (prompt v2, 2026-11-15), `delete-account` y `pet-storage-cleanup` desplegadas |
| Supabase de producción | **no existe** |
| Google AI Studio (Gemini) | función desplegada; secreto no verificable desde aquí; **cuota gratuita** (decisión 2026-11-15): vale para pruebas, pero sus términos solo permiten servicios de pago en apps para usuarios del EEE (§8) |
| Google Cloud OAuth (login con Google) | cliente web creado; faltan los clientes Android (SHA-1 de depuración, de EAS y de Play), el ID web en Supabase y la prueba en un móvil; la URI de supabase.co se retira tras esa prueba. Pasos: `SETUP_GUIDE.md` |
| Correo (SMTP propio) | Resend configurado en `kitom-dev` (el usuario, 2026-11-15); falta en producción y comprobar cada plantilla. Pasos: `SETUP_GUIDE.md` §2 |
| Google Play Console / Expo (EAS) | `eas.json` preparado; faltan las cuentas. Apple, tras la v1 (Android primero) |
| RevenueCat | integrado en el código (2026-11-16); falta el proyecto, la app de Play, los secretos y desplegar las funciones (`SETUP_GUIDE.md` §7) |
| Asesoría legal y veterinario asesor | necesarios: textos legales y validación del prompt |

## 6. Riesgos pendientes

1. Coste de IA sin control (SEC-01, SEC-06) y pipeline remoto no verificado.
2. Rechazo en tiendas por falta de eliminación de cuenta, política de privacidad y declaraciones.
3. Tratamiento de datos (fotos y salud de mascotas, notas del dueño) sin base legal documentada.
4. iOS: nunca compilado ni probado (fuera de la v1).
5. Monitorización: Sentry comprobado con errores reales, source maps y reglas de privacidad en APK locales (2026-11-04).
   Falta llevar el DSN y el token a EAS cuando exista el proyecto (`DEPLOYMENT.md` §8, paso 10).
6. Mantenimiento: documentación muy extensa (`FRONTEND_ARCHITECTURE.md` 1663 líneas, `DECISIONS.md`
   1166) que hay que mantener sincronizada.

## 7. Decisión de lanzamiento

**NO PUBLICAR todavía.** Los bloqueantes de código están resueltos; quedan los externos de
`DEPLOYMENT.md` §8. Con ellos hechos, el objetivo es **CANDIDATA A BETA** cerrada en la prueba cerrada de
Google Play, y producción tras esa beta en móviles reales. Esta decisión se basa en pruebas automáticas y
en un emulador Android: no hay validación en dispositivos físicos ni del pipeline de IA en el remoto.

## 9. Revisión del 2026-11-16: pruebas a fondo y Kitom Premium

Detalle en [`QA_2026-11-16.md`](QA_2026-11-16.md). Todas las suites automáticas en verde (pgTAP 803, integración 85,
unitarias 1029, Edge Functions 112); recorrido con conexión en web y sin conexión en el emulador Android contra el
Supabase local, sin fallos bloqueantes. Hallazgos: QA-01…QA-13 (P1: QA-02 por verificar en un móvil, QA-04 parches de
Expo). Kitom Premium pasa a formar parte de la prueba cerrada (decisión 2026-11-16): **bloqueantes nuevos** para ella
son el `db push` de `20261116160000`, la configuración de Play y RevenueCat (`SETUP_GUIDE.md` §7) y la prueba de
compra con un tester de licencia.

**Actualización 2026-11-18:** migración aplicada en `kitom-dev` y tipos regenerados; corregidos QA-01, QA-04, QA-06, QA-08,
QA-09, QA-10, QA-12 y QA-13 (`QA_2026-11-16.md` §2); ramas integradas en `main`. Siguen: el despliegue de las funciones y la
configuración de Play, RevenueCat y EAS (cuentas del responsable).

## 8. Revisión del 2026-11-13 (actualizada el 2026-11-15): camino a Google Play

Revisado: documentación, código de `frontend/src`, migraciones, Edge Functions y seed; pruebas automáticas (`TESTING.md`) y
recorrido en web (320 y 360 px) y en el emulador Android (320 y 360 dp) con letra al 100 % y al 130 %. Sin acceso a `kitom-dev` en
esta revisión (ni lectura).

**Hecho en esta revisión (integrado en `main` el 2026-11-15, ramas `db/ai-guidance-v2` y `feat/ai-guidance-v2`):**
orientación con IA v2 (`DECISIONS.md` 2026-11-13), señales por especie, ocho correcciones de pantallas pequeñas y letra
grande, textos de «perro o gato» generalizados, política y términos con los datos nuevos que se envían a la IA y sin
depender del plan de Gemini (`DECISIONS.md` 2026-11-15). En `kitom-dev`, el usuario aplicó la migración, reejecutó el
seed y desplegó la función (2026-11-15); SMTP con Resend configurado.

**Bloqueantes para cualquier usuario externo (incluida la prueba cerrada):**

1. **Plan de pago de Gemini antes de testers o usuarios del EEE.** Decisión 2026-11-15: cuota gratuita de momento. Como el
   responsable está en España, Google aplica también a la cuota gratuita las condiciones de datos del servicio de pago (no
   usa el contenido para mejorar sus productos), y la política lo dice así. Pero los términos de la Gemini API solo
   permiten **servicios de pago** en apps ofrecidas a usuarios del EEE, Suiza o Reino Unido, y la cuota gratuita no aguanta
   tráfico real. Al activarlo, fijar `AI_INPUT_USD_PER_MTOK`/`AI_OUTPUT_USD_PER_MTOK` para medir el coste por consulta.
2. **Verificar la v2 en `kitom-dev`** (desplegada el 2026-11-15): una consulta real con foto y otra sin foto hasta
   `completed` (nunca se ha completado una allí) y los logs de la función.
3. **Proyecto Supabase de producción** (UE) con migraciones, seeds, buckets con límites, Auth endurecido, **SMTP propio**
   (Resend, como en `kitom-dev`; sin él no llegan los emails de confirmación), Redirect URLs y Google OAuth de producción
   (`SETUP_GUIDE.md`).
4. **Revisión veterinaria** del prompt, las 72 señales por especie, las reglas de urgencia (`urgency.ts`), los campos por
   especie y las observaciones del resumen de bienestar. **Revisión legal** de `site/` y publicarlo (`push` a `main`).
5. **Cuentas y build**: Expo (`eas init`, variables por entorno, DSN y token de Sentry), Google Play Console (cuenta de
   desarrollador; las cuentas personales nuevas exigen una prueba cerrada con testers antes de producción), build
   `production` (AAB) con Play App Signing y copia del keystore.
6. **Ficha y declaraciones de Play** (`STORE_LISTING.md`): capturas, Data Safety (incluye ahora el texto libre de la
   consulta), justificación de `SCHEDULE_EXACT_ALARM`, clasificación de contenido, declaración de IA generativa, URL de
   eliminación de cuenta.
7. **Prueba en móviles físicos** con la build `preview`: emails reales, Google, fotos contra el bucket real (nunca
   probadas), avisos, IA, co-tutores con dos cuentas, sin conexión.

**Recomendado antes de producción (no bloquea la beta):** CI con `tsc`/lint/unitarias (P2-13), listas virtualizadas
(P2-05), coordinación del arranque en frío (al abrir con el token caducado salen 3 peticiones `401` antes de renovarlo;
se repiten bien, pero ensucian Sentry), retirar `dev-components` del bundle (P2-14), borrar registros diarios (P2-10).
