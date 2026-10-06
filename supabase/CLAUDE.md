# KITOM — Supabase

## Estado actual
- Proyecto enlazado: `kitom-dev` (remoto de desarrollo). CLI vía `npx supabase` (2.120.0). Postgres 17.
- Migración base `20261006175453_remote_schema.sql`: volcado del remoto. Equivale a `database/v2.2.1/`
  00–26 (más las funciones), con estas diferencias conocidas:
  - **No desplegado** `27_organizations_prep` (`organizations`, `organization_members`, `is_org_member`).
    Fuera del MVP; no crear migración salvo petición expresa. Hay 22 tablas, no las 24 que citan los docs.
  - No incluye datos: ni filas de `storage.buckets` ni catálogos semilla. `config.toml` apunta a
    `./seed.sql`, que aún no existe. Buckets y seed: **pendientes**, en tareas separadas con aprobación.
- Edge Functions: **pendientes**. No existe `supabase/functions/` y la carpeta `edge-functions/` que
  citan los docs no está en el repo.
- Esquema v2.2.1 **congelado**: solo cambia por bugs reales detectados construyendo el frontend.

## Congelado (no tocar sin aprobación explícita + migración nueva)
Tablas y enums · GRANT/REVOKE por columna · políticas RLS · funciones SECURITY DEFINER · triggers
(incl. `on_auth_user_created` sobre `auth.users`) · políticas de Storage de `pet-photos`,
`reminder-attachments`, `shared-reports`, `avatars`.
Invariantes: `pets.owner_id` (GRANT + trigger) · entitlement siempre de `auth.uid()` · feedback IA solo
de `requested_by` · cuota IA por usuario y mes · `pet_streaks` es caché de `daily_logs`.

## Qué requiere migración
Cualquier DDL, política, grant, función, trigger, enum, índice, extensión, política de Storage, y los
datos que deben existir en todos los entornos (p. ej. buckets).
Datos de desarrollo/catálogo para local → `supabase/seed.sql` (solo se aplica en local).

## Operaciones con el CLI
- **Remoto**: ninguna operación sin aprobación explícita del usuario (incluye las de lectura como
  `db pull`, `migration list`, `gen types --linked`). Nunca operaciones destructivas.
- **Bloqueado para Claude**: `db push`, `db reset --linked|--db-url`, `migration repair|squash`,
  `migration up|down --linked`, `link|unlink`, `config push`, `functions deploy|delete`,
  `secrets set|unset`, SQL directo al remoto (psql, Studio).
- **`db reset` local**: nunca automático; solo con aprobación explícita (borra los datos locales).
- NUNCA editar migraciones existentes ni `database/v2.2.1/`.

## Flujo para un cambio de base de datos
1. Explicar el problema real y proponer el SQL. Esperar aprobación.
2. Rama `db/<descripcion>`; `npx supabase migration new <descripcion_snake_case>` (con permiso).
3. Escribir el SQL siguiendo los patrones existentes:
   - `enable row level security` en toda tabla nueva.
   - Funciones: `security definer` + `set search_path = public`; `revoke all … from public, anon`
     (y `authenticated` si es backend-only); `grant execute` solo donde toque.
   - Grants por columna en tablas con campos inmutables/auditoría.
   - Validar `auth.uid()` y pertenencia antes de tocar datos; nunca aceptar `user_id` del cliente.
4. Validar en local (`supabase start` / `db reset` local, solo con aprobación).
5. El usuario revisa y aplica al remoto. Claude no ejecuta `db push`.
6. Regenerar tipos (con aprobación, lee el remoto):
   `npx supabase gen types typescript --linked --schema public > frontend/src/types/database.types.ts`
7. Actualizar `docs/README.md` / `docs/FRONTEND_ARCHITECTURE.md` si cambia el contrato. PR propio.

## Edge Functions (futuras: `supabase/functions/<nombre>/index.ts`)
`ai-analysis-process`, `generate-pet-report`, `delete-account`, `revenuecat-webhook`.
Orden obligatorio: validar JWT → `auth.uid()` del JWT (nunca del body) → validar parámetros →
re-autorizar contra la BD → solo entonces `service_role`. Bucket hardcodeado, nunca del cliente.
Proveedor de IA intercambiable. Secretos vía `supabase secrets set`, ejecutado por el usuario.
