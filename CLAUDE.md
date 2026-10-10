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

## Jerarquía de fuentes de verdad
1. `supabase/migrations/` — lo que existe de verdad en la base de datos.
2. `docs/FRONTEND_ARCHITECTURE.md` y `docs/README.md` — contrato técnico.
3. `docs/PRD.md` — alcance y producto. Ante una contradicción técnica (p. ej. §11 modelo de datos,
   §12 stack), ganan 1–2.

Decisiones de stack ya tomadas: **Expo Router + TanStack Query + React Context**. No usar
react-navigation directamente ni Zustand/Redux, aunque los mencione el PRD.
Ante cualquier otra contradicción: detente y pregunta, no elijas tú.

## Estado conocido (no asumir que existe)
- `organizations` / `organization_members` / `is_org_member()` (archivo 27 de `database/v2.2.1/`):
  **no desplegados** en el remoto. Fuera del MVP; no crear migración salvo petición expresa.
- Edge Functions (`ai-analysis-process`, `generate-pet-report`, `delete-account`, `revenuecat-webhook`):
  **pendientes**. La carpeta `edge-functions/` que citan los docs no está en el repo.
- Migración de razas `20261007152630_breeds.sql`: aplicada en `kitom-dev`.
- Migraciones `20261007172110_pets_select_policy_owner.sql` (crear mascotas) y
  `20261007182429_grant_safe_pet_id_from_path.sql` (Storage de mascotas): aplicadas en `kitom-dev`.
- Migración `20261008150202_daily_logs_fixes.sql` (sin ella no se puede escribir en `daily_logs` ni
  borrar una mascota con registros): aplicada en `kitom-dev`. Frontend de Daily Logs: registro de hoy e
  historial (consulta/edición de registros anteriores), online; offline y borrado pendientes.
- Migración `20261008155257_profile_timezone.sql` (`profiles.timezone` admite `NULL` = sin configurar;
  la app la inicializa con la zona del dispositivo): aplicada en `kitom-dev`.
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
- Pruebas de BD (solo local): `supabase/tests/database/*.test.sql` (pgTAP, ver `supabase/CLAUDE.md`).
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
