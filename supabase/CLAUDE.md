# KITOM — Supabase

## Estado actual
- Proyecto enlazado: `kitom-dev` (remoto de desarrollo). CLI vía `npx supabase` (2.120.0). Postgres 17.
- Migración base `20261006175453_remote_schema.sql`: volcado del remoto. Equivale a `database/v2.2.1/`
  00–26 (más las funciones), con estas diferencias conocidas:
  - **No desplegado** `27_organizations_prep` (`organizations`, `organization_members`, `is_org_member`).
    Fuera del MVP; no crear migración salvo petición expresa. Hay 22 tablas, no las 24 que citan los docs.
  - No incluye datos. Los catálogos están en `supabase/seed.sql` y `supabase/seeds/breeds.sql` (ver
    `docs/SEED.md`): ejecutados en `kitom-dev` por el usuario (especies y razas probadas desde la
    app; nunca con `db push`). Los buckets de Storage existen en `kitom-dev` pero no en local
    (pendiente: declararlos en `config.toml`).
- Migración `20261007152630_breeds.sql`: catálogo `breeds` (por especie), enum `breed_status` y
  `pets.breed_id`/`pets.breed_status` con FK compuesta `(breed_id, species_id) → breeds (id, species_id)`
  y CHECK `pets_breed_status_check`. Aplicada en `kitom-dev`. Con ella son 23 tablas. Modelo:
  `docs/DECISIONS.md`.
- Migración `20261007172110_pets_select_policy_owner.sql`: la política SELECT de `pets` comprueba
  `owner_id = auth.uid()` antes de `is_pet_member(id)` para que `INSERT … RETURNING` funcione.
  Aplicada en `kitom-dev`.
- Migración `20261007182429_grant_safe_pet_id_from_path.sql`: `grant execute` de
  `safe_pet_id_from_path(text)` a `authenticated`, necesario para que las políticas de los buckets de
  mascota se puedan evaluar. Aplicada en `kitom-dev`.
- Migración `20261008150202_daily_logs_fixes.sql`: corrige `recompute_pet_streak` (`date + bigint`,
  ninguna escritura en `daily_logs` funcionaba) y `trg_recompute_pet_streak_fn` (borrar una mascota con
  registros violaba la FK de `pet_streaks`); RPC `save_daily_log` (SECURITY INVOKER); ventana de
  creación de 7 días; `log_date` inmutable; CHECKs de contenido; grants endurecidos. Validada en local
  con `db reset`; **pendiente de aplicar en `kitom-dev`**. Decisión: `docs/DECISIONS.md`.
- Pruebas de BD: `supabase/tests/database/*.test.sql` (pgTAP, en transacción con `ROLLBACK`; solo
  local). Ejecutar con `npx supabase test db` o con `docker exec -i supabase_db_Kitom psql -U postgres
  -d postgres -f - < <archivo>`. Para actuar como usuario: `request.jwt.claims` + `set role authenticated`.
- Tipos: `gen types --local` (CLI 2.120) usa otro generador que `--linked` (sin
  `__InternalSupabase.PostgrestVersion`, con `ComputedFields`): regenerar siempre con `--linked`.
- Lección Storage: las políticas se evalúan con el rol que consulta; necesita EXECUTE sobre toda
  función que la política invoque (aunque sea `security definer`).
- Lección RLS: en `INSERT … RETURNING` la política SELECT se evalúa sobre la fila nueva **antes** de que
  exista en la tabla; una función que la busque por id (p. ej. `is_pet_member(id)`) no la encuentra.
  Probar siempre los inserts con `RETURNING` (es lo que hace `insert().select()`).
- Lección cascadas: los triggers de la tabla hija se ejecutan durante un `ON DELETE CASCADE`; si escriben
  en otra tabla que referencia al padre, violan su FK. Además el orden de las cascadas depende del
  nombre (OID) de los triggers de FK y varía entre entornos. Probar siempre "borrar el padre con hijos"
  con 2+ filas hijas.
- Lección upsert: PostgREST hace `ON CONFLICT DO UPDATE SET` de todas las columnas enviadas, así que
  necesita UPDATE sobre las columnas inmutables. En tablas con GRANT por columna, usar una RPC.
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
Datos de referencia/catálogo → `supabase/seed.sql`: solo `INSERT … ON CONFLICT DO NOTHING` sobre
constraints reales, sin `DELETE/TRUNCATE/DROP/UPDATE`, sin UUIDs fijos ni datos de usuario. Se aplica
solo en local (`supabase start`/`db reset` local); en `kitom-dev` lo ejecuta el usuario. Ver `docs/SEED.md`.

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
