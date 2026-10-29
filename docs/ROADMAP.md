# Kitom — Roadmap hacia producción

Backlog priorizado tras la auditoría del 2026-10-29 ([`PROJECT_STATUS.md`](PROJECT_STATUS.md),
[`SECURITY_AUDIT.md`](SECURITY_AUDIT.md)). Sustituye, para el lanzamiento, a la sección 18 del PRD y a
`docs/design/PLAN_DESARROLLO.md`, que siguen siendo la referencia de producto y de diseño.

Prioridades: **P0** bloqueante (seguridad, datos, cumplimiento, publicación) · **P1** imprescindible
para el lanzamiento · **P2** estabilidad y calidad · **P3** posterior. Esfuerzo en días de una persona.
«Local» = se puede hacer en el repo; «Externo» = necesita cuentas, servicios, dinero o terceros.

## Hitos

| Hito | Contenido | Criterio de salida |
|---|---|---|
| H1 — Seguro en desarrollo | P0-01, P0-05 | migración aplicada en `kitom-dev`; pgTAP verde |
| H2 — Beta cerrada | todo P0 + P1-01 … P1-05 | builds firmadas en Play (prueba cerrada) y TestFlight; 10–20 testers; sin fallos bloqueantes en 2 semanas |
| H3 — Producción | resto de P1 | checklist de `DEPLOYMENT.md` §6 completa; decisión **CANDIDATA A PRODUCCIÓN** |
| H4 — Post-lanzamiento | P2, P3 | — |

## P0 — Bloqueantes

| ID | Problema | Solución | Archivos | Dep. | Esfuerzo | Riesgo si no | Criterio de aceptación | Prueba | Tipo |
|---|---|---|---|---|---|---|---|---|---|
| P0-01 | Cuota de IA eludible (SEC-01); invitación a email sin confirmar (SEC-05); aviso solo en cliente (SEC-10); grants sobrantes (SEC-11); `search_path` (SEC-12); buckets sin límites (SEC-07) | migración nueva con registro de uso privado, comprobaciones y límites | `supabase/migrations/`, `supabase/tests/database/` | — | 1–1,5 | coste de IA ilimitado; acceso a datos ajenos | borrar y recrear la mascota no devuelve cupo; email sin confirmar no recibe invitaciones; sin aviso no hay consulta; `pet-photos` rechaza >5 MB y no-JPEG | pgTAP nuevo + suite completa en verde; `db push` del usuario | Local + `db push` |
| P0-02 | Sin eliminación de cuenta (SEC-02) | Edge Function `delete-account` (contrato en `docs/README.md` §12: 409 `has_pets` o transferir/borrar mascotas), pantalla en ajustes, página web de solicitud | `supabase/functions/delete-account/`, `settings/`, docs | P0-04 (prod) para publicarla | 3–4 | rechazo en tiendas; incumplimiento RGPD | un usuario borra su cuenta desde la app; quedan 0 filas y 0 objetos suyos; reintento idempotente | integración local + manual | Local + despliegue |
| P0-03 | Sin política de privacidad/términos; consentimiento de IA inexacto (SEC-03) | asesoría legal; plan de pago del proveedor de IA; enlaces en registro, ajustes y tienda; texto de consentimiento exacto | `i18n/locales/*`, `settings/legal.tsx`, `PRIVACY.md` | decisión de proveedor | 1 técnico + legal | rechazo en tiendas; sanción RGPD | textos publicados en una URL accesible sin sesión y enlazados; consentimiento revisado por legal | revisión legal y manual | Externo |
| P0-04 | Sin entorno de producción ni Auth endurecido (SEC-09) | proyecto Supabase de producción (UE), migraciones, catálogos, buckets, Auth (confirmación, ≥8, filtradas, SMTP, Google), secretos | `DEPLOYMENT.md` §5 | P0-01 | 1–2 | datos reales en un entorno de pruebas | checklist §5 completa; advisors sin avisos de seguridad | registro real de punta a punta en producción | Externo |
| P0-05 | Pipeline de IA remoto sin verificar (2 análisis `pending`, 0 completados en `kitom-dev`) y prompt en borrador | revisar logs y secreto de `ai-analysis-process`; validación del prompt y reglas con veterinario | `supabase/functions/ai-analysis-process/` | P0-03 (proveedor) | 1 + veterinario | la función estrella no funciona o da orientación insegura | consultas reales completadas en `kitom-dev`; prompt aprobado por escrito | manual + revisión | Externo |
| P0-06 | Sin firma de release ni iOS | EAS (o firma propia), `eas.json`, `ios.bundleIdentifier`, credenciales y copia del keystore | `frontend/app.json`, `frontend/eas.json` | cuentas de tiendas | 1–2 | no se puede publicar | AAB e IPA firmadas instaladas en dispositivos de prueba | manual | Externo |

## P1 — Imprescindible para el lanzamiento

| ID | Problema | Solución | Dep. | Esfuerzo | Criterio / prueba | Tipo |
|---|---|---|---|---|---|---|
| P1-01 | Errores del flujo de IA: foto huérfana, mapeo por texto, spinner infinito, reintento sin error (BUG-02…05) | correcciones en `features/ai-analysis` + `hint` del servidor (P0-01) | P0-01 | 0,5–1 | tests unitarios del modelo; manual | Local (rama `fix/…` en curso) |
| P1-02 | Primera prueba en iOS | build de desarrollo y repaso de todos los flujos (avisos, cámara, SecureStore, deep links, Google) | P0-06 | 2–3 | lista de flujos de `TESTING.md` §5 en iPhone físico | Externo |
| P1-03 | Sin informes de errores ni canal de soporte | Sentry (o similar, decisión) en app y Edge Functions, sin datos personales; email de soporte en ayuda | decisión | 1 | un error forzado aparece en el panel sin PII | Local + cuenta |
| P1-04 | Limpieza de Storage sin programar | `pg_cron` + `pg_net` (o programador externo), secreto, despliegue en modo informe y luego borrado | P0-04 | 0,5–1 | trabajos `pending` llegan a `completed` en remoto | Externo |
| P1-05 | Auth: reenviar confirmación, tiempo límite en `auth-callback`, recuperación persistida, reautenticación al cambiar contraseña (BUG-06/07, SEC-17) | `features/auth`, `settings/password.tsx` | — | 1–2 | tests + manual | Local |
| P1-06 | Fallos de IA con coste no limitados (SEC-06), sin límite por minuto (SEC-21) | límite diario de fallos con coste y 1 solicitud/min (decisión de cifras) | decisión, P0-01 | 0,5 | pgTAP | Local |
| P1-07 | Enumeración de cuentas con invitaciones (SEC-04) | invitaciones pendientes por email sin revelar cuenta; límite diario | — | 2–3 | pgTAP: mismo estado con email existente o no | Local (`db/` + `feat/`) |
| P1-08 | Exportación de datos (RGPD art. 20) | exportación JSON por Edge Function o procedimiento documentado de solicitud | P0-02 | 1–2 | el usuario obtiene sus datos | Local |
| P1-09 | Datos locales sin cifrar tras cerrar sesión (SEC-08) | purgar al cerrar sesión sin pendientes; «borrar datos del dispositivo»; limpiar cuentas que no vuelven | — | 1–2 | tests del flujo; `checkLocalStore` en dispositivo | Local |
| P1-10 | Idioma fijo y permisos solo en español | detección del idioma del dispositivo (`expo-localization`, requiere permiso para instalar), `locales` de permisos en `app.json` | decisión de mercados | 1 | app en inglés con el dispositivo en inglés | Local |
| P1-11 | Fichas de tienda y declaraciones | capturas, textos, Data Safety, App Privacy, justificación de alarmas exactas | P0-03 | 1–2 | fichas aprobadas | Externo |
| P1-12 | Fotos nunca probadas contra un bucket real | prueba manual en `kitom-dev` (subir, ver, cambiar, borrar, consulta) | P0-01 | 0,5 | registrado en `CHANGELOG.md` | Externo (manual) |

## P2 — Estabilidad y calidad

| ID | Tarea | Esfuerzo |
|---|---|---|
| P2-01 | Arreglar pruebas frágiles TEST-01 (orden de FK) y TEST-02 (cola de limpieza compartida) | 0,5 |
| P2-02 | pgTAP de las superficies sin probar (`DATABASE.md` §3) | 2–3 |
| P2-03 | Integración de `ai-analysis-process` con `AI_PROVIDER=mock`; estado condicionado a `processing` (SEC-16) | 1 |
| P2-04 | Rendimiento de BD: `(select auth.uid())` en 22 políticas, `STABLE` en `is_pet_member`/`can_edit_pet`, índices de FK | 1 |
| P2-05 | Listas virtualizadas (`FlatList`) en historial, agenda y consultas | 1–2 |
| P2-06 | Parches del SDK 57 (`npx expo install --check`) y revisión de `npm audit` (SEC-20) | 0,5 |
| P2-07 | E2E (Maestro) de los flujos críticos en CI | 3–5 |
| P2-08 | Accesibilidad: TalkBack/VoiceOver, texto grande, contraste de tokens | 2 |
| P2-09 | Agenda sin conexión (propuesta `docs/proposals/2026-10-28-reminders-offline.md`) | 3–5 |
| P2-10 | Borrar registros diarios; co-tutor que abandona; transferir propiedad en la UI | 2–3 |
| P2-11 | Selector de fecha nativo para el nacimiento; límites de longitud en BD (SEC-18) | 1 |
| P2-12 | DELETE de Storage solo del autor o del dueño (SEC-15); `pg_trgm` fuera de `public` (SEC-12) | 1 |
| P2-13 | CI (GitHub Actions): tsc, lint, unitarias; pgTAP con Supabase en Docker | 1–2 |
| P2-14 | Quitar `dev-components` de producción, licencia, `reset-project` y versión de `package.json` | 0,5 |

## P3 — Posterior

Premium con RevenueCat y webhook (decisión de precio/límites) · informes PDF para el veterinario ·
teléfono con OTP · notificaciones push remotas · adjuntos de recordatorios · desafíos semanales ·
clínicas y referidos (tras SEC-13) · analítica de producto · coordinación entre pestañas en web ·
organizaciones B2B.

## Orden recomendado

1. P0-01 (rama `db/…`, ya en preparación) → `db push` del usuario en `kitom-dev`.
2. P1-01 (rama `fix/…`, en preparación), que usa los `hint` de P0-01.
3. En paralelo, lo externo: cuentas de tiendas, proyecto de producción, asesoría legal, veterinario,
   plan de pago del proveedor de IA (P0-03, P0-04, P0-05, P0-06).
4. P0-02 eliminación de cuenta (antes que P1-08 exportación, que reutiliza su recorrido de datos).
5. P1-05, P1-09, P1-03, P1-10 y P2-01 (pruebas fiables antes de añadir CI).
6. Builds firmadas → P1-02 iOS → P1-12 fotos reales → beta cerrada (H2).
7. P1-07, P1-06, P1-11 → producción (H3).

Evitar rehacer trabajo: no empezar las fichas de tienda (P1-11) antes de cerrar los textos legales
(P0-03), ni la exportación (P1-08) antes de la eliminación de cuenta (P0-02).
