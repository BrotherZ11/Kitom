# KITOM — Supabase

## Estado actual
- Proyecto enlazado: `kitom-dev` (remoto de desarrollo). CLI vía `npx supabase` (2.120.0). Postgres 17.
- Migración base `20261006175453_remote_schema.sql`: volcado del remoto. Equivale a `database/v2.2.1/`
  00–26 (más las funciones), con estas diferencias conocidas:
  - **No desplegado** `27_organizations_prep` (`organizations`, `organization_members`, `is_org_member`).
    Fuera del MVP; no crear migración salvo petición expresa. Hay 22 tablas, no las 24 que citan los docs.
  - No incluye datos. Los catálogos están en `supabase/seed.sql` y `supabase/seeds/breeds.sql` (ver
    `docs/SEED.md`): ejecutados en `kitom-dev` por el usuario (especies y razas probadas desde la
    app; nunca con `db push`). Los buckets de Storage existen en `kitom-dev`; en local solo
    `pet-photos`, declarado en `config.toml` (privado; 5 MB e `image/jpeg`, como fija la migración
    `20261029151011`; en `kitom-dev` los 4 buckets son privados y sin límites hasta aplicarla) y creado
    con `npx supabase seed buckets --local`. Los demás, pendientes.
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
  con `db reset`; aplicada en `kitom-dev`. Decisión: `docs/DECISIONS.md`.
- Migración `20261008155257_profile_timezone.sql`: `profiles.timezone` admite `NULL` (= sin configurar)
  y no tiene default; `validate_profile_timezone` deja pasar `NULL`, valida solo si el valor cambia y
  exige `UTC` o Área/Ubicación; los `'UTC'` existentes (siempre el default) pasan a `NULL`. RLS y grants
  sin cambios. Validada en local con `db reset`; aplicada en `kitom-dev`.
- Migración `20261010160332_daily_logs_concurrency.sql`: `save_daily_log` pasa de 13 a 15 parámetros
  (se borra la firma anterior, sin sobrecarga) con las precondiciones opcionales
  `p_expected_updated_at` / `p_expect_absent`; conflicto = `P0001` + `hint` `daily_log_conflict`. Sin
  cambios de tablas, triggers, RLS ni grants. Validada en local con `db reset`; aplicada en
  `kitom-dev` y tipos regenerados. Decisión: `docs/DECISIONS.md`.
- Migración `20261020135440_pets_client_request_id.sql`: `pets.client_request_id uuid` (nullable),
  índice único parcial `pets_owner_client_request_id_key` sobre `(owner_id, client_request_id)` y
  `GRANT INSERT (client_request_id)` a `authenticated` (sin UPDATE): alta idempotente para Pets offline
  (fase 8). Sin cambios de RLS, triggers ni `pets.id` (sigue sin GRANT de INSERT: ver la decisión).
  Validada en local con `migration up` (sin `db reset`); aplicada en `kitom-dev` (`db push` del usuario,
  2026-10-21) y tipos regenerados. Decisión: `docs/DECISIONS.md`.
- Migración `20261023082848_pet_invitations_by_email.sql` (rama `db/pet-invitations-by-email`): RPC
  `invite_pet_member_by_email` (solo el propietario; no revela si un email tiene cuenta),
  `get_my_pet_invitations` y `get_pet_members`, `SECURITY DEFINER`, sin EXECUTE para anon. Sin cambios de
  tablas, RLS ni triggers. Validada en local con `migration up` (sin `db reset`) y pgTAP; aplicada en
  `kitom-dev` (`db push` del usuario, 2026-10-23) y tipos añadidos. Contrato: `docs/README.md` §13.
- Migraciones `20261027194904_pets_photo_path_own_pet.sql` (CHECK `pets_photo_path_own_pet`: NULL o
  `{id propio}/{nombre}.jpg`; aborta sin cambios si alguna fila no cumple) y
  `20261027194908_pet_storage_cleanup.sql` (esquema `private` sin USAGE, cola
  `private.pet_storage_cleanup_jobs`, trigger `AFTER DELETE` en `pets` y RPC `pet_storage_cleanup_*`
  `SECURITY DEFINER`, `search_path` vacío, solo `service_role`) y `20261028114317_pet_storage_cleanup_guards.sql`
  (las RPC no trabajan si su propietario no ve `storage.objects` entero o falta el CHECK) (rama
  `db/pet-storage-cleanup`, fase 12B): validadas en local con `migration up --local` (sin `db reset`) y
  desde cero con `db diff --local`; aplicadas en `kitom-dev` el 2026-10-28 (`db push` del usuario) y tipos regenerados. La Edge Function
  `pet-storage-cleanup`, desplegada (2026-11-04), sin secretos de Vault comprobados. Diseño,
  revisión y despliegue: `docs/proposals/2026-10-26-pet-photos-cleanup.md`.
- Migración `20261028200659_reminders_is_active.sql` (rama `db/reminders-active`, fase 13):
  `reminders.is_active boolean NOT NULL DEFAULT true` y `GRANT INSERT/UPDATE (is_active)` a
  `authenticated`. Sin cambios de RLS, triggers ni políticas. Validada en local con `migration up --local`
  (sin `db reset`), desde cero con `db diff --local` y pgTAP; aplicada en `kitom-dev` el 2026-10-29
  (`db push` del usuario) y tipos regenerados con `--linked` (solo `reminders.is_active`). Decisión:
  `docs/DECISIONS.md`.
- Migración `20261029151011_ai_quota_and_invitation_hardening.sql` (rama `db/ai-quota-and-invitations`,
  auditoría 2026-10-29): registro de uso `private.ai_analysis_usage` (cupo de IA a prueba de borrar la
  mascota; trigger `trg_sync_ai_analysis_usage`), `request_ai_analysis` con aviso veterinario obligatorio
  y `hint` estables, `invite_pet_member_by_email` solo a cuentas confirmadas y vigentes, sin
  `TRUNCATE/TRIGGER/REFERENCES/MAINTAIN` para `anon`/`authenticated` (también por defecto),
  `trigger_set_timestamp` con `search_path` y `pet-photos` a 5 MB/`image/jpeg`. Sin cambios de firmas
  (tipos iguales). Validada en local con `migration up --local`, pgTAP (`ai_quota.test.sql`, 406 casos en
  total) y desde cero con `db diff --local` (sin diferencias de sus objetos; el motor `pg-delta` lista como
  `CREATE OR REPLACE` funciones anteriores que no cambian). Aplicada en `kitom-dev` (`db push` del
  usuario). Decisión: `docs/DECISIONS.md`.
- Migración `20261030090318_abuse_limits_and_db_hardening.sql` (rama `db/hardening-2`, segunda
  migración de endurecimiento): `request_ai_analysis` con 1 solicitud/min (`ai_rate_limited`) y 3 fallos
  por día UTC (`ai_failure_limit`; `ai_misconfigured` no cuenta), en `private.ai_analysis_usage`
  (`failed_at`, `failure_code`); `invite_pet_member_by_email` con 20 intentos/24 h (`invite_rate_limited`,
  `private.pet_invitation_attempts`); `get_pet_members` y la política SELECT de `pet_co_owners` sin la
  identidad de las invitaciones pendientes de otros; CHECK de longitud (SEC-18; `handle_new_user` recorta
  el nombre); `submit_ai_feedback` ≤ 1000 (`ai_feedback_too_long`); `(select auth.uid())` en 22
  políticas; `is_pet_member`/`can_edit_pet` `STABLE`; 12 índices de FK;
  `ai_analysis_requests.processing_started_at` (la anota el reclamo); `pg_cron` + `pg_net` y las tareas
  `kitom-pet-storage-cleanup*` (`private.invoke_pet_storage_cleanup`, secretos de Vault
  `kitom_project_url` y `pet_storage_cleanup_secret`; sin ellos no hace nada). Sin cambios de firmas (tipos:
  solo la columna nueva). Validada en local con `migration up --local`, pgTAP (`abuse_limits`,
  `db_hardening`; 510 casos en total), concurrencia (`abuse_limits_concurrency.sh`) y `db diff --local` (sin
  diferencias de sus objetos). Aplicada en `kitom-dev` (`db push` del usuario, 2026-11-04), con
  `ai-analysis-process` desplegada; falta crear los secretos de Vault. Contrato: `docs/README.md`
  §5, §8, §11, §13 y §20.2.
- Migración `20261105093545_reminders_client_request_id.sql` (rama `db/integration-account-deletion-reminders`, fase 14):
  `reminders.client_request_id uuid` (nullable), índice único parcial
  `reminders_creator_client_request_id_key` sobre `(created_by, client_request_id)` y `GRANT INSERT
  (client_request_id)` a `authenticated` (sin UPDATE): alta idempotente para la agenda sin conexión. Sin cambios
  de RLS, triggers ni `reminders.id`. Validada en local con `migration up --local`, pgTAP
  (`reminders_client_request_id`), concurrencia (`reminders_concurrency.sh`) y `db diff --local` (sin
  diferencias de sus objetos). Aplicada en `kitom-dev` (`db push` del usuario, 2026-11-06) y tipos regenerados. Decisión: `docs/DECISIONS.md`.
- Migración `20261105122353_account_deletion_audit_triggers.sql` (rama `db/integration-account-deletion-reminders`, D-11): los
  triggers de auditoría permiten `created_by`/`logged_by` a `NULL` solo si el perfil ya no existe (la FK al borrar la cuenta);
  `set_last_edited_by` y `trg_recompute_pet_streak_fn` reconocen ese estado. Sin cambios de firmas, tablas, GRANT, RLS ni tipos.
  Validada desde cero en un Supabase local desechable, con pgTAP, concurrencia, Auth real y `db diff`; aplicada en
  `kitom-dev` (`db push` del usuario, 2026-11-06). Decisión: `docs/DECISIONS.md`.
- Migración `20261111120000_species_fields.sql` (rama `feat/species-fields-wellness`, fases 15–16): las 9 especies
  activas (las inserta si faltan) y `species.ai_guidance_enabled` (perro y gato; `request_ai_analysis` lo exige,
  `hint` `ai_species_unsupported`), «Ave»/«Reptil», catálogo `species_fields` (escrito por la migración; copia de la app en
  `frontend/src/features/species/species-fields.ts`), `pets/daily_logs.species_data` (`jsonb`, ≤ 4096 bytes) con el
  trigger `validate_species_data` (solo valida las claves que cambian; `hint` `species_data_invalid`, `detail` = campo),
  `daily_logs_not_empty_check` nuevo y `save_daily_log` de 16 parámetros (`p_species_data NULL` = conservar). Validada en
  local con `migration up --local` y pgTAP (`species_fields`, `daily_logs_read_access`; 681 en total); aplicada en
  `kitom-dev` (`db push` del usuario, 2026-11-12), `seeds/breeds.sql` reejecutado y tipos regenerados con `--linked`.
  Contrato: `docs/README.md` §15.1.
- Migración `20261113134252_ai_guidance_v2.sql` (rama `db/ai-guidance-v2`, 2026-11-13): `ai_analysis_requests` con contexto del
  tutor (`user_context` 1–1000, `symptom_onset`, `symptom_trend`) y resultado ampliado (`summary`, `warning_signs`,
  `vet_questions`, `photo_observations`), CHECK de longitud y SELECT por columna; `request_ai_analysis` de 6 parámetros (los 3
  nuevos con `DEFAULT NULL`; firma de 3 borrada; hints `ai_context_too_long`, `ai_invalid_context`); `ai_guidance_enabled` en las 9
  especies. Señales por especie en `seed.sql` (72, con categoría). Validada en local con `migration up --local`, pgTAP
  (`ai_guidance_v2`, 731 en total), `abuse_limits_concurrency.sh` y `db diff --local`. Aplicada en `kitom-dev` con el seed reejecutado
  y `ai-analysis-process` desplegada (el usuario, 2026-11-15); tipos regenerados con `--linked`. Contrato: `docs/README.md` §11.
- Migración `20261116160000_premium_plans.sql` (rama `db/premium`, 2026-11-16, Kitom Premium): `private.free_plan_limits()`,
  `private.is_premium()` (plan efectivo), `get_ai_analysis_entitlement` con él, `get_my_plan()`, trigger
  `trg_enforce_pet_plan_limit` (`pet_limit_reached`; respeta el 23505 de `client_request_id`), `premium_required` en las dos
  RPC de invitar (antes de mirar el email), `subscriptions.provider_state_at` + `apply_subscription_state()` (solo
  `service_role`) y retirada de los privilegios de escritura de tabla sobre `subscriptions`/`subscription_events`. Validada en
  local con `migration up --local`, pgTAP (`premium_plans`, 803 en total), `premium_concurrency.sh` y las demás suites.
  Aplicada en `kitom-dev` (`db push` del usuario, 2026-11-18) y tipos regenerados con `--linked`. Desde ella, las pruebas que invitan o crean más de 2 mascotas por cuenta hacen Premium a sus
  usuarios (pgTAP: `update public.subscriptions set plan = 'premium'`; integración: `frontend/scripts/integration-premium.mjs`).
  Edge Functions `revenuecat-webhook` (`verify_jwt = false`, secreto `REVENUECAT_WEBHOOK_AUTH`) y `subscription-sync`
  (`verify_jwt = true`), con la lógica común en `functions/_shared/subscription-*.ts` (sin Deno; `subscription.test.mjs` y
  `run-integration.mjs`). Las despliega el usuario. Contrato: `docs/README.md` §19. `delete-account` borra también el cliente de
  RevenueCat si tiene `REVENUECAT_SECRET_API_KEY` (paso `billing`, 2026-11-18). Las tres, desplegadas por el usuario el 2026-11-20.
- Migración `20261120154210_invitation_notifications.sql` (rama `db/invitation-notifications`, QA-07): cola
  `private.pet_invitation_notifications` (RLS, sin grants; `ON DELETE CASCADE` desde `pet_co_owners`), trigger
  `trg_enqueue_pet_invitation_notification` (`AFTER INSERT OR UPDATE OF status, invited_at`: encola al pasar a `pending` o
  renovarse) y RPC `pet_invitation_notifications_claim`/`_complete` (`SECURITY DEFINER`, `search_path` vacío, solo
  `service_role`). Sin cambios de RLS ni de tablas existentes; `push_tokens`/`register_push_token` son los del esquema base.
  Validada en local con `migration up --local`, pgTAP (`invitation_notifications`, 833 en total) y las 8 suites de
  concurrencia. Aplicada en `kitom-dev` (`db push` del usuario, 2026-11-20) y tipos regenerados con `--linked` (2026-11-21).
  Edge Function `invitation-notify` (`verify_jwt = true`; secretos `RESEND_API_KEY`, `INVITATION_EMAIL_FROM`, opcional
  `EXPO_ACCESS_TOKEN`), desplegada por el usuario con sus secretos. Contrato: `docs/README.md` §13.1.
- Lección pgTAP y seeds: `npx supabase test db` solo monta `supabase/tests`, así que un `\ir` a `seeds/` no funciona.
  Para probar un seed, una copia temporal dentro de `supabase/tests/database/` (y borrarla después).
- Lección triggers genéricos: una función de trigger usada en dos tablas no puede leer `new.<columna>` de solo una en
  una expresión con `or`/`and`: PL/pgSQL no garantiza el cortocircuito. Usar `if` anidados.
- Pruebas de BD: `supabase/tests/database/*.test.sql` (`daily_logs`, `profile_timezone`,
  `pets_client_request_id`, `pet_invitations`, `pets_photo_path`, `pet_storage_cleanup`, `ai_quota`,
  `abuse_limits`, `db_hardening`, `account_deletion_audit`, `ai_guidance_v2`, `premium_plans`, `invitation_notifications`, `reminders`
  (permisos de la tabla con el esquema base), `reminders_is_active`, `reminders_client_request_id`, `species_fields`,
  `daily_logs_read_access`; pgTAP, en
  transacción con `ROLLBACK`; solo local). Ejecutar con `npx supabase test db` o con `docker exec -i supabase_db_Kitom psql -U postgres
  -d postgres -f - < <archivo>`. Para actuar como usuario: `request.jwt.claims` + `set role authenticated`.
- Pruebas de concurrencia: `bash supabase/tests/concurrency/daily_logs_concurrency.sh`,
  `pets_concurrency.sh` (alta con la misma clave y edición con la misma versión base),
  `pets_delete_concurrency.sh`, `pet_storage_cleanup_concurrency.sh` (reservas simultáneas, caducadas y
  caídas, informes duplicados, subida durante el borrado; necesita el bucket local),
  `abuse_limits_concurrency.sh` (solicitudes de IA e invitaciones simultáneas en el límite),
  `reminders_concurrency.sh` (alta con la misma clave; edición y borrado con la misma versión base) y
  `account_deletion_concurrency.sh` (borrar una cuenta, conectado como `supabase_auth_admin`, mientras otros escriben) y
  `premium_concurrency.sh` (altas simultáneas en el límite de mascotas del plan gratuito) (solo local, vía
  `docker exec`; varias sesiones de psql a la vez; crea datos con ids fijos y los borra al terminar).
  `.gitattributes` fuerza LF en `*.sh` (con `core.autocrlf=true` saldrían con CRLF y bash fallaría).
  pgTAP corre en una transacción y no puede probar carreras: toda lógica que dependa de bloqueos o
  de la versión de una fila necesita un caso aquí.
- Lección versiones: en una transacción `now()` no avanza, así que en pgTAP dos escrituras seguidas
  dejan el mismo `updated_at`. Sembrar las filas "leídas antes" con un `updated_at` anterior.
- Lección firmas: añadir parámetros con `CREATE OR REPLACE` crea otra función (la identidad son los
  tipos de entrada). Borrar la firma anterior y volver a aplicar `revoke`/`grant` a la nueva.
- Tipos: `gen types --local` (CLI 2.120) usa otro generador que `--linked` (sin
  `__InternalSupabase.PostgrestVersion`, con `ComputedFields`): regenerar siempre con `--linked`.
- Lección Storage: las políticas se evalúan con el rol que consulta; necesita EXECUTE sobre toda
  función que la política invoque (aunque sea `security definer`). Y una función `security definer` que
  lea `storage.objects` lo hace con RLS salvo que su propietario se la salte: si no, ve 0 filas sin error.
- Lección pgTAP: `rollback to savepoint` también deshace los resultados que pgTAP ya anotó (plan
  descuadrado); para probar algo destructivo, hacerlo al final del archivo sin savepoint.
- Lección RLS: en `INSERT … RETURNING` la política SELECT se evalúa sobre la fila nueva **antes** de que
  exista en la tabla; una función que la busque por id (p. ej. `is_pet_member(id)`) no la encuentra.
  Probar siempre los inserts con `RETURNING` (es lo que hace `insert().select()`).
- Lección cascadas: los triggers de la tabla hija se ejecutan durante un `ON DELETE CASCADE`; si escriben
  en otra tabla que referencia al padre, violan su FK. Además el orden de las cascadas depende del
  nombre (OID) de los triggers de FK y varía entre entornos. Probar siempre "borrar el padre con hijos"
  con 2+ filas hijas.
- Lección FK y triggers: una acción `ON DELETE SET NULL` dispara los `BEFORE UPDATE` de la tabla hija y se ejecuta como
  dueño de esa tabla: `current_user = postgres` aunque borre `supabase_auth_admin`, con `auth.uid()` a `NULL`. El rol no
  la distingue de un `UPDATE` sin JWT; el estado sí (la fila referenciada ya no existe). Además, un trigger que recalcula
  por fila se vuelve cuadrático: medir con volumen. En pgTAP la fila creada en la misma transacción hace que Postgres
  compruebe también la otra FK (`RI_FKey_fk_upd_check_required`); probar dos FK a la misma cuenta con filas confirmadas.
- Lección límites de frecuencia: en pgTAP `now()` no avanza, así que dos `request_ai_analysis` seguidas
  chocan con el límite de 1/min; adelantar antes las filas de `private.ai_analysis_usage` 61 s
  (`test_helpers.age_ai_usage()`, `SECURITY DEFINER`). Las carreras del límite, en
  `abuse_limits_concurrency.sh`.
- Lección CHECK con función: quien escribe necesita `EXECUTE` sobre toda función que use un CHECK (como
  en las políticas). `private.text_array_within` lo concede a `authenticated` y `service_role`; sin
  `USAGE` del esquema `private` no se puede llamar por nombre.
- Lección pg_net: `pg_net` concede `EXECUTE` sobre `net.*` a `anon`/`authenticated` como
  `supabase_admin`; `postgres` no puede revocarlo (solo avisa). El esquema `net` no está expuesto por la API.
- Lección comparaciones en pgTAP: columnas de tipo `name` (catálogos) convertidas a `text` conservan la
  intercalación `C`; compararlas con `results_eq` contra `values (...)` da «could not determine which
  collation»: añadir `collate "default"`.
- Lección upsert: PostgREST hace `ON CONFLICT DO UPDATE SET` de todas las columnas enviadas, así que
  necesita UPDATE sobre las columnas inmutables. En tablas con GRANT por columna, usar una RPC.
- Plantillas de email: `templates/`, enlazadas en `config.toml` para el stack local (reiniciarlo para aplicarlas:
  `npx supabase stop` + `start`, sin borrar datos). En el remoto las pega el usuario: `docs/SETUP_GUIDE.md` §3.
- Edge Functions: `functions/ai-analysis-process/`, `functions/delete-account/` y
  `functions/pet-storage-cleanup/` implementadas (ver abajo); las demás, **pendientes** (la carpeta
  `edge-functions/` que citan los docs no está en el repo). En `kitom-dev` (solo lectura, 2026-11-04): las tres
  desplegadas. Estado de la base y cobertura de pruebas: `docs/DATABASE.md`; hallazgos:
  `docs/SECURITY_AUDIT.md`.
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

## Edge Functions (`supabase/functions/<nombre>/index.ts`)
Hechas: `ai-analysis-process`, `pet-storage-cleanup`, `delete-account`, `revenuecat-webhook`, `subscription-sync` e
`invitation-notify` (lógica en `notify.ts`/`rest.ts`, sin Deno: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON
supabase/functions/invitation-notify/notify.test.mjs`; contra el local: `node supabase/functions/invitation-notify/run-integration.mjs`).
Pendiente: `generate-pet-report`.
- `delete-account` (contrato en `docs/README.md` §12): la llama la app con el JWT del usuario
  (`verify_jwt = true` en `config.toml`). Vista previa y borrado; transfiere o borra las mascotas propias,
  quita sus `avatars` y borra el usuario de Auth. Todo con el JWT del usuario salvo
  `auth.admin.deleteUser` (clave de servicio, último paso). Secreto opcional `REVENUECAT_SECRET_API_KEY` (paso `billing`). Lógica en
  `deletion.ts`/`rest.ts` (sin Deno): `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON
  supabase/functions/delete-account/*.test.mjs`; contra el local (crea y borra sus usuarios `it-del-…`,
  y el bucket `avatars` si no existe): `node supabase/functions/delete-account/run-integration.mjs`.
  Desplegarla (`functions deploy delete-account`) lo hace el usuario.
- `pet-storage-cleanup` es de servicio, no de usuario: la invoca una tarea programada con la cabecera
  `x-kitom-cleanup-secret` (`PET_STORAGE_CLEANUP_SECRET`, ≥ 32 caracteres, nunca en el repo ni en
  `config.toml`) y `verify_jwt = false`; modo informe salvo `PET_STORAGE_CLEANUP_MODE=delete`. Lógica en
  `cleanup.ts`/`rest.ts` (sin Deno): `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON
  supabase/functions/pet-storage-cleanup/cleanup.test.mjs`; contra el local (Storage real, usa la clave
  de servicio local y SQL por `docker exec` para adelantar plazos):
  `node supabase/functions/pet-storage-cleanup/run-integration.mjs`. Probar la función servida:
  `npx supabase functions serve pet-storage-cleanup --env-file <archivo fuera del repo>`.
Orden obligatorio: validar JWT → `auth.uid()` del JWT (nunca del body) → validar parámetros →
re-autorizar contra la BD → solo entonces `service_role`. Bucket hardcodeado, nunca del cliente.
Proveedor de IA intercambiable. Secretos vía `supabase secrets set` y despliegue con `functions deploy`:
los ejecuta el usuario (bloqueados para Claude).
- Módulos sin imports de Deno (`guidance.ts`, `providers.ts` con `fetch` simulado), probados con
  `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON supabase/functions/ai-analysis-process/*.test.mjs`.
- Probar en local sin clave ni coste: archivo de entorno fuera del repo con `AI_PROVIDER=mock` y
  `npx supabase functions serve ai-analysis-process --env-file <archivo>` (el simulador se niega si
  `SUPABASE_URL` no es local). Nunca poner claves reales en archivos del repo.
