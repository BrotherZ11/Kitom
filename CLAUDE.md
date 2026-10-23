# KITOM — Instrucciones para Claude Code

App móvil (iOS/Android) de bienestar emocional y conductual para perros y gatos: registro diario,
recordatorios, análisis orientativo con IA (foto + síntomas), rachas/logros y co-tutores.
Stack: Expo (React Native) + TypeScript + Supabase. Documentación en español; código e identificadores en inglés.

## Mapa del repo

- `frontend/` — app Expo; único paquete npm del repo. Reglas: `frontend/CLAUDE.md`.
- `supabase/` — config del CLI y `migrations/` (esquema realmente desplegado). Reglas: `supabase/CLAUDE.md`.
- `database/v2.2.1/` — SQL de diseño original. **Histórico, solo lectura.**
- `docs/` — `PRD.md` (producto), `README.md` (arquitectura SQL v2.2.1), `FRONTEND_ARCHITECTURE.md`
  (contrato pantalla ↔ datos/RPC/Storage), `AUTH.md` (Auth, deep links, Google y configuración
  necesaria en Supabase), `SEED.md` (datos de referencia), `DECISIONS.md` (decisiones técnicas), `CHANGELOG_v2.2.1.md` (histórico) y
  `CHANGELOG.md` (cambios actuales).
- `docs/design/` — diseño de la app (identidad «Ritmo», tokens, componentes, prototipo de 90 pantallas,
  inventario `PANTALLAS.md` y `PLAN_DESARROLLO.md`). Recursos de marca para la app en `frontend/assets/brand/`.

## Jerarquía de fuentes de verdad

1. `supabase/migrations/` — lo que existe de verdad en la base de datos.
2. `docs/FRONTEND_ARCHITECTURE.md` y `docs/README.md` — contrato técnico.
3. `docs/PRD.md` — alcance y producto; `docs/design/` — diseño de pantallas.
   Ante una contradicción técnica (p. ej. §11 modelo de datos, §12 stack), ganan 1–2.

Decisiones de stack ya tomadas: **Expo Router + TanStack Query + React Context**. No usar
react-navigation directamente ni Zustand/Redux, aunque los mencione el PRD.
Ante cualquier otra contradicción: detente y pregunta, no elijas tú.

## Estado conocido (no asumir que existe)

- `organizations` / `organization_members` / `is_org_member()` (archivo 27 de `database/v2.2.1/`):
  **no desplegados** en el remoto. Fuera del MVP; no crear migración salvo petición expresa.
- Edge Functions: `ai-analysis-process` implementada en `supabase/functions/` (rama `feat/ai-guidance`,
  OpenAI; prompt y reglas en borrador hasta que los valide un veterinario). Para `kitom-dev` faltan los
  secretos `OPENAI_API_KEY`/`OPENAI_MODEL` y el despliegue, ambos del usuario. `generate-pet-report`,
  `delete-account` y `revenuecat-webhook`: **pendientes**; la carpeta `edge-functions/` que citan los
  docs no está en el repo.
- Migración de razas `20261007152630_breeds.sql`: aplicada en `kitom-dev`.
- Migraciones `20261007172110_pets_select_policy_owner.sql` (crear mascotas) y
  `20261007182429_grant_safe_pet_id_from_path.sql` (Storage de mascotas): aplicadas en `kitom-dev`.
- Migración `20261008150202_daily_logs_fixes.sql` (sin ella no se puede escribir en `daily_logs` ni
  borrar una mascota con registros): aplicada en `kitom-dev`. Frontend de Daily Logs: registro de hoy e
  historial (consulta/edición de registros anteriores), con modo offline (ver abajo); borrado pendiente.
- Migración `20261008155257_profile_timezone.sql` (`profiles.timezone` admite `NULL` = sin configurar;
  la app la inicializa con la zona del dispositivo): aplicada en `kitom-dev`.
- Migración `20261010160332_daily_logs_concurrency.sql` (`save_daily_log` con precondiciones
  opcionales `p_expected_updated_at` / `p_expect_absent`; conflicto = `hint` `daily_log_conflict`):
  aplicada en `kitom-dev` y tipos regenerados. El frontend la usa siempre con precondición.
- Daily Logs offline: guardado local + motor de sincronización integrados en el registro de hoy y el
  historial, con pantalla de resolución de conflictos, descarte de la copia local y «Registros sin
  sincronizar» en inicio (`docs/FRONTEND_ARCHITECTURE.md` §5). Fase 5: cierre de sesión con pendientes
  (sincronizar / conservar / cancelar) y aislamiento entre cuentas (cada envío con el token del dueño).
  Fase 6: arranque en frío sin conexión (estado de sesión `offline`: datos locales del usuario de la
  sesión guardada, nada se envía ni se lee del servidor hasta renovarla). Fase 6.5: sin conexión no se
  intenta renovar (temporizador de auth-js y app), recuperación inmediata al volver la red, sesión
  rechazada sin reintentos; verificada en emulador Android con Expo Go (SecureStore nativo) salvo la
  red que vuelve en segundo plano. Fase 7 (Pets offline, solo lectura): copia por usuario de la lista y
  las fichas en `LocalStore` (lista, ficha, pestañas y nombre en los registros sin conexión); crear,
  editar, borrar y fotos siguen necesitando conexión (`docs/FRONTEND_ARCHITECTURE.md` §5 «Pets sin
  conexión (fase 7)»). Fase 8: crear y editar mascotas sin conexión (operación local por mascota, motor
  con alta idempotente por `client_request_id` y edición con precondición `updated_at`, conflictos que
  decide el usuario); fotos y borrado siguen online; una mascota aún sin crear en el servidor no tiene
  registros diarios (§5 «Pets: altas y ediciones sin conexión (fase 8)»). Fase 8.5: validada a mano en
  el emulador Android y en web; el cierre de sesión cuenta Daily Logs y Pets
  (`features/auth/sign-out-provider.tsx`). Pendiente: la limpieza (no automática) de datos locales de
  cuentas que no vuelven, la copia del catálogo de razas, la coordinación entre pestañas en web y una
  columna de versión para la edición (fase `db/`). En móvil las queries caducadas se vuelven a pedir al reconectar
  (`refetchOnReconnect`, 2026-10-20).
- Diseño v2 (`docs/design/`): F0–F5 implementadas en la rama `feat/ui-brand-implementation`: tokens,
  tema claro/oscuro según el sistema y fuentes (`frontend/src/theme/`), componentes
  (`frontend/src/components/ui/`), bienvenida y acceso, mascotas, registro e historial, pestañas
  (Hoy · Historial · Registrar · Agenda · Perfil) y Hoy (`frontend/CLAUDE.md` › «Tema y diseño»,
  `docs/FRONTEND_ARCHITECTURE.md` §1). MVP (rama `feat/mvp-completion`, 2026-10-21, sin migraciones):
  configuración inicial (`(app)/setup/*`, `onboarding_completed_at`, aviso veterinario obligatorio),
  agenda (`reminders`: CRUD, repetición, posponer), avisos locales (`expo-notifications`, aprobado; no
  disponibles en Expo Go 57.0.9, sí en builds nativas; exactos en Android con `SCHEDULE_EXACT_ALARM` y el
  módulo local `frontend/modules/kitom-exact-alarms`), logros (`pet_achievements`), ajustes completos
  (tema del dispositivo, notificaciones, seguridad, privacidad, ayuda, legal) y «Próximo» en Hoy
  (`docs/FRONTEND_ARCHITECTURE.md` §1, §2, §4 y §7). Sin implementar (backend o decisión pendiente):
  teléfono, adjuntos de la agenda, señales y alertas, co-tutores, Premium, exportar/eliminar
  cuenta, clínica propia y voz de la mascota; del acceso, texto legal, reenviar el email, repetir la
  contraseña y la regla visible de longitud (`docs/DECISIONS.md`).
  Marca enlazada en `app.json` (nombre «Kitom», icono iOS/Android, splash y favicon desde
  `frontend/assets/brand/app-icon/`); `slug` (`frontend`) y esquema (`kitom`) sin cambiar.
  `android.package` = `com.kitom.app` (2026-10-20, no cambiarlo: otra APK no actualizaría la
  instalada); `ios.bundleIdentifier` sin definir. APK de prueba compilada en local
  (`npx expo prebuild --platform android` + `gradlew assembleRelease`; `/android` está ignorado por git
  y la release va firmada con la clave de depuración: no vale para Google Play). Sin EAS.
- Migración `20261020135440_pets_client_request_id.sql` (alta idempotente de mascotas para Pets offline,
  fase 8): aplicada en `kitom-dev` (`db push` del usuario) y tipos regenerados.
- `supabase/seed.sql` y `supabase/seeds/breeds.sql` (catálogos): ejecutados en `kitom-dev` por el usuario
  (ver `docs/SEED.md`). Buckets de Storage: existen en `kitom-dev`, no en local (pendiente).

## Reglas absolutas

- **Remoto (`kitom-dev`)**: ninguna operación contra el proyecto remoto sin aprobación explícita del
  usuario, y nunca operaciones destructivas. `db push` está bloqueado: lo ejecuta el usuario.
  Prohibido también `migration repair|squash`, `link|unlink`, `config push`, `functions deploy|delete`,
  `secrets set|unset` y SQL directo (psql, Studio).
- **`db reset`**: nunca de forma automática. Solo contra Supabase local y solo tras aprobación explícita
  (borra los datos locales). Jamás con `--linked` ni `--db-url`.
- NUNCA modificar migraciones existentes ni `database/v2.2.1/`.
- Todo cambio de esquema, RLS, grants, funciones, triggers o políticas de Storage requiere una migración
  NUEVA y aprobación explícita previa (ver `supabase/CLAUDE.md`).
- NUNCA leer, mostrar ni commitear `.env`/secretos. La `service_role` key jamás en el frontend.
- No instalar/desinstalar paquetes sin permiso. En `frontend/` usar `npx expo install <pkg>`, nunca `npm install <pkg>`.
- No hacer commit, push, merge ni rebase si no se pide explícitamente.
- No borrar archivos ni ejecutar `npm run reset-project` sin permiso.

## Comandos

- Desde `frontend/`: `npx expo start` · `npx expo lint` · `npx tsc --noEmit` · `npx expo-doctor` · `npm test`
  · `npm run test:integration` (solo contra el Supabase local; se niega si la URL no es local)
  · `npm run start:local` (app contra el Supabase local sin tocar `.env`; ver `frontend/CLAUDE.md`)
- Pruebas de BD (solo local): `supabase/tests/database/*.test.sql` (pgTAP) y
  `supabase/tests/concurrency/*.sh` (sesiones simultáneas); ver `supabase/CLAUDE.md`.
- Desde la raíz: Supabase CLI siempre como `npx supabase ...` (no hay instalación global).
- Entorno Windows: hay herramientas Bash y PowerShell; las restricciones de `.claude/settings.json` cubren ambas.

## Definición de "terminado"

`npx expo lint` y `npx tsc --noEmit` sin errores · sin secretos en el diff · docs actualizados si
cambia un contrato (RPC, tabla, código de error, ruta de Storage).

## Estructura y documentación

- Mantener el repositorio limpio, coherente y documentado como parte de cada tarea; colocar los
  archivos nuevos en la ubicación arquitectónicamente correcta y reutilizar documentación existente
  en vez de duplicar contenido.
- Actualizar la documentación relacionada cuando cambien arquitectura, contratos, configuración,
  decisiones o flujos. Registrar las decisiones técnicas importantes en `docs/DECISIONS.md` y los
  cambios relevantes en `docs/CHANGELOG.md`.
- Mantener estas instrucciones y las guías específicas actualizadas cuando cambien las reglas del
  proyecto. Corregir o retirar documentación obsoleta cuando corresponda, sin alterar fuentes
  históricas de solo lectura.
- Antes de terminar, comprobar la coherencia de la estructura y la documentación. No crear
  documentación para cambios triviales; al finalizar, resumir qué documentación se actualizó y por
  qué.

## Git

- `main` siempre estable; no se trabaja directamente sobre ella.
- Ramas: `feat/…`, `fix/…`, `chore/…`, `docs/…`, `db/…`.
- Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `db:`.
- Integración a `main` siempre vía PR. Los cambios de base de datos van en un PR propio (`db/…`),
  nunca mezclados con UI.

## Reglas de dominio que no se pueden romper

- Kitom NO diagnostica. Prohibido "diagnóstico"/"diagnostica" en copy; usar "orientación",
  "posibles causas", "señales de alerta". Disclaimer visible en cada resultado de IA.
- Las llamadas al proveedor de IA solo desde Edge Functions, nunca desde el cliente.
- RLS/RPC son la autoridad: el cliente nunca decide owner, plan, entitlement ni estado de IA.
