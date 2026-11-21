# Kitom — Arquitectura SQL v2.2.1 (FINAL antes de frontend)

Esta es la versión de cierre de la base de datos. v2.2.1 es una microversión de seguridad/contrato sobre v2.2 — no una nueva iteración de arquitectura (ver `CHANGELOG_v2.2.1.md` para el detalle exacto de qué cambió). Salvo bugs reales que surjan construyendo el frontend, no debería haber otra revisión de base de datos después de esta.

---

## 1. Arquitectura general

Supabase (Postgres + Auth + Storage + Realtime + Edge Functions) con Row Level Security en todas las tablas de negocio. Tres capas de control de acceso, no solo una:

1. **GRANT/REVOKE por tabla y por columna** — qué puede tocar `authenticated` en absoluto, antes de que se evalúe nada más.
2. **RLS (policies)** — qué filas concretas puede ver/tocar, dado que ya tiene el privilegio de la capa 1.
3. **Triggers y funciones `SECURITY DEFINER`** — reglas de negocio e invariantes que ni el GRANT ni el RLS pueden expresar por sí solos (p. ej. "este campo es inmutable tras crearse", "esta cuota es por usuario y periodo").

Nada crítico depende de una sola de estas capas — ver sección 21 para el caso concreto de `pets.owner_id`.

## 2. Tablas (24, todas con RLS)

> Desde la migración `20261111120000_species_fields.sql` hay una tabla más, `species_fields` (catálogo de
> campos por especie, sección 15.1).

`profiles`, `species`, `catalog_translations`, `pets`, `pet_co_owners`, `daily_logs`, `symptoms_catalog`, `symptom_species`, `ai_analysis_requests`, `ai_analysis_symptoms`, `reminders`, `achievements_catalog`, `pet_achievements`, `pet_streaks`, `subscriptions`, `subscription_events`, `push_tokens`, `notification_preferences`, `vet_clinics`, `clinic_referrals`, `pet_shared_reports`, `analytics_events`, `organizations`, `organization_members`.

## 3. Orden de ejecución

00 extensions → 01 enum_types → 02 utility_functions → 03 species → 04 catalog_translations → 05 profiles → 06 pets → 07 pet_co_owners → 08 pet_access_control → 09 daily_logs → 10 symptoms_catalog → 11 ai_analysis_requests → 12 ai_analysis_symptoms → 13 reminders → 14 achievements_catalog → 15 pet_achievements → 16 pet_streaks → 17 subscriptions → 18 subscription_events → 19 push_tokens → 20 notification_preferences → 21 new_user_trigger → 22 vet_clinics → 23 clinic_referrals → 24 pet_shared_reports → 25 analytics_events → 26 storage_buckets_and_policies → 27 organizations_prep → 28 seed_data

*(Nota técnica: algunas funciones `plpgsql` — `request_ai_analysis`, `recompute_pet_streak` — referencian objetos creados en archivos posteriores. Esto es válido en Postgres: a diferencia de `LANGUAGE SQL`, el cuerpo de una función `plpgsql` no se valida contra el esquema hasta su primera ejecución, así que el orden de archivos no se ve afectado.)*

## 4. RLS — resumen

Todas las tablas tienen `ENABLE ROW LEVEL SECURITY`. Ninguna tabla de negocio queda sin RLS.

## 5. Matriz SELECT / INSERT / UPDATE / DELETE

| Tabla | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `profiles` | propia fila | vía trigger de alta | propia fila (columnas concretas, nunca id/created_at/updated_at) | — |
| `pets` | miembros (owner o co-tutor) | owner (columnas concretas) | editores (columnas concretas, **nunca owner_id**) | owner |
| `pet_co_owners` | la propia fila; las de los demás, solo aceptadas y a miembros (desde `20261030090318`) | — (solo RPC) | — (solo RPC) | — (solo RPC) |
| `daily_logs` | miembros | editores, `logged_by=auth.uid()` (columnas concretas; en la práctica vía RPC `save_daily_log`) | editores (solo columnas de datos, nunca pet_id/logged_by/log_date/created_at) | editores |
| `symptoms_catalog` / `symptom_species` | autenticados | — | — | — |
| `species_fields` (migración `20261111120000`) | autenticados | — (solo migraciones) | — | — |
| `ai_analysis_requests` | miembros (columnas concretas) | — (solo RPC `request_ai_analysis`) | — (solo RPC `submit_ai_feedback`, y solo si `requested_by = auth.uid()` — ver sección 9.1) | — |
| `ai_analysis_symptoms` | miembros | — (solo vía RPC) | — | — |
| `reminders` | miembros | editores, `created_by=auth.uid()` (columnas concretas) | editores (columnas concretas, nunca pet_id/created_by/created_at) | editores |
| `achievements_catalog` | autenticados | — | — | — |
| `pet_achievements` | miembros | — (solo backend, `award_pet_achievement`) | — | — |
| `pet_streaks` | miembros | — (solo backend, `recompute_pet_streak`) | — | — |
| `subscriptions` | propia fila (columnas concretas) | — (solo backend) | — (solo backend) | — |
| `subscription_events` | propia (vía subscriptions, columnas concretas) | — (solo backend) | — | — |
| `push_tokens` | propios | propios | propios | propios |
| `notification_preferences` | propias | propias | propias | propias |
| `vet_clinics` | autenticados (columnas públicas) | — | — | — |
| `clinic_referrals` | propias | — (solo RPC) | — | — |
| `pet_shared_reports` | miembros | — (solo backend) | — | — |
| `analytics_events` | — | propios | — | — |
| `organizations` / `organization_members` | miembros de la org | — | — | — |

> Cambio posterior (migración `20261030090318_abuse_limits_and_db_hardening.sql`): las 22 políticas que
> llamaban a `auth.uid()`/`auth.role()` por fila lo hacen con `(select auth.uid())` (se evalúa una vez por
> consulta; mismos nombres, comandos, roles y semántica, probado en `db_hardening.test.sql`), salvo
> `co_owners: select members or self`, que cambia a propósito (SEC-04): `user_id = auth.uid()` o
> (`status = 'accepted'` y `is_pet_member(pet_id)`). Un miembro ya no lee la fila (ni el `user_id`) de una
> invitación pendiente, rechazada o revocada de otra persona; la app no lee esta tabla directamente.
> `is_pet_member` y `can_edit_pet` son `STABLE`. Longitudes máximas (CHECK, SEC-18): `pets.name` y
> `breed` ≤ 100, `temperament_notes` ≤ 2000, `known_conditions`/`allergies` ≤ 100 elementos de ≤ 200
> (función `private.text_array_within`, con `EXECUTE` para `authenticated` y `service_role`),
> `profiles.full_name` ≤ 200 (`handle_new_user` recorta el nombre de Google), `reminders.title` ≤ 200 y
> `description` ≤ 2000, `ai_analysis_requests.feedback_comment` ≤ 1000, `analytics_events.event_name` ≤ 100
> y `properties` ≤ 8 KB como texto. Infringirlas da `23514` con el nombre del CHECK (`*_length_check`,
> `analytics_events_properties_size_check`). Los límites de la app son menores o iguales (nombre 40, raza
> 60, listas 200 caracteres, notas 2000, perfil 60, recordatorios 80/500).

> Cambio posterior (migración `20261020135440_pets_client_request_id.sql`, decisión en `DECISIONS.md`):
> `pets.client_request_id uuid` (nullable) con índice único parcial `pets_owner_client_request_id_key`
> sobre `(owner_id, client_request_id)` y `GRANT INSERT (client_request_id)` a `authenticated` (sin
> UPDATE). Hace idempotente el alta desde el cliente: la app genera una clave por alta y, si se pierde
> la respuesta, reenviar el mismo `INSERT` da `23505` y la fila se lee por la clave. `pets.id` sigue sin
> GRANT de INSERT (con él, quien conociera el id de una mascota borrada podría recrearla y pasar
> `is_pet_member` sobre sus fotos, que se quedan en Storage). RLS y triggers sin cambios. La edición
> concurrente no necesita cambios: `update … where id = … and updated_at = <base>` es atómico (en READ
> COMMITTED la segunda escritura vuelve a evaluar el `WHERE` y actualiza 0 filas), probado en
> `supabase/tests/concurrency/pets_concurrency.sh`.

> Cambio posterior (migración `20261105093545_reminders_client_request_id.sql`, decisión en `DECISIONS.md`;
> probada en local, pendiente de `db push`): `reminders.client_request_id uuid` (nullable) con índice único
> parcial `reminders_creator_client_request_id_key` sobre `(created_by, client_request_id)` y
> `GRANT INSERT (client_request_id)` a `authenticated` (sin UPDATE). Mismo contrato que en `pets`: reenviar la
> misma alta da `23505` y la fila se lee por `(created_by, client_request_id)`. RLS actúa antes que el índice:
> quien ya no puede escribir recibe `42501`. `reminders.id` sigue sin GRANT de INSERT. RLS y triggers sin
> cambios. Edición y borrado con `eq('updated_at', base)`: `supabase/tests/concurrency/reminders_concurrency.sh`.

## 6. RPCs (funciones con `EXECUTE` para `authenticated`)

| Función | Tabla(s) que toca |
|---|---|
| `is_pet_member(uuid)`, `can_edit_pet(uuid)` | lectura, `pets`/`pet_co_owners` |
| `owner_has_pets()` | lectura, `pets` (solo sobre `auth.uid()`, sin parámetro) |
| `invite_pet_member(pet_id, invitee, role)` | `pet_co_owners` |
| `accept_pet_invitation` / `decline_pet_invitation` / `revoke_pet_invitation` / `change_pet_member_role` | `pet_co_owners` |
| `invite_pet_member_by_email(pet_id, email, role)` (migración `20261023082848`) | `pet_co_owners` (vía `invite_pet_member`) |
| `get_my_pet_invitations()` / `get_pet_members(pet_id)` (migración `20261023082848`) | — (lectura) |
| `transfer_pet_ownership(pet_id, new_owner_id)` | `pets`, `pet_co_owners` |
| `get_ai_analysis_entitlement()` | lectura, `subscriptions` + `private.ai_analysis_usage` (siempre sobre `auth.uid()`; desde `20261116160000`, con el plan efectivo `private.is_premium`) |
| `get_my_plan()` (migración `20261116160000_premium_plans`) | lectura: plan guardado y efectivo, estado, fechas, mascotas propias activas y límites (`NULL` = sin límite) de `auth.uid()`. Ver §19 |
| `request_ai_analysis(pet_id, photo_path, symptom_ids[] [, user_context, symptom_onset, symptom_trend])` | `ai_analysis_requests`, `ai_analysis_symptoms`, `pet_achievements`. Los tres últimos, opcionales (migración `20261113134252_ai_guidance_v2`, ver §9) |
| `submit_ai_feedback(analysis_id, feedback, comment)` | `ai_analysis_requests` (solo columnas de feedback) |
| `create_clinic_referral(code, source, campaign)` | `clinic_referrals` |
| `request_generate_report(pet_id, start, end)` | solo validación, no escribe nada |
| `is_org_member(org_id)` | lectura, `organization_members` |
| `register_push_token(token, platform, device_id, app_version, os_version)` | `push_tokens` — reasigna el token al `auth.uid()` actual, ver sección 17.1 |
| `save_daily_log(pet_id, log_date, <7 niveles>, unusual_behavior, unusual_behavior_notes, notes, tags [, expected_updated_at, expect_absent, species_data])` | `daily_logs` — crea o sustituye el registro del día; **SECURITY INVOKER** (aplica RLS y grants de quien llama). Añadida en la migración `20261008150202`; precondiciones opcionales de concurrencia en la `20261010160332`; `p_species_data` (`NULL` = conservar) en la `20261111120000`, ver secciones 15 y 15.1 |

**Nota de taxonomía (v2.2.1):** dentro de esta tabla hay dos tipos distintos, aunque ambos tengan `EXECUTE` para `authenticated`:
- **RPC de producto** (la mayoría): representan una acción real de negocio que el frontend invoca — `request_ai_analysis`, `invite_pet_member`, `transfer_pet_ownership`...
- **Helper interno accesible** (`is_pet_member`, `can_edit_pet`, `is_org_member`): existen sobre todo para usarse DENTRO de policies de RLS; se conceden a `authenticated` porque además son útiles de consultar directamente (p. ej. `generate-pet-report` las usa vía el cliente de usuario, ver sección 8), pero no representan una acción de negocio en sí mismas.

## 7. Funciones exclusivamente backend (sin `EXECUTE` para `authenticated`/`anon`)

`trigger_set_timestamp`, `safe_pet_id_from_path`, `protect_pet_structural_fields`, `validate_pet_birth_date`, `set_last_edited_by`, `validate_daily_log_date`, `protect_daily_log_audit_fields`, `validate_symptom_species_compat`, `sync_reminder_completion`, `protect_reminder_audit_fields`, `validate_reminder_attachment_path`, `recompute_pet_streak`, `trg_recompute_pet_streak_fn`, `award_pet_achievement`, `handle_new_user`, `validate_ai_request_photo_path`, `process_revenuecat_event` (sin uso desde `20261116160000`), `apply_subscription_state` (`20261116160000`, solo `service_role`: Edge Functions de suscripción, §19), `private.enforce_pet_plan_limit` (trigger de `pets`, §19), `validate_profile_timezone` (nueva, v2.2.1), `claim_ai_analysis_for_processing` (nueva, v2.2.1 — exclusiva de la Edge Function `ai-analysis-process` vía `service_role`), `pet_invitation_notifications_claim`/`_complete` (`20261120154210`, solo `service_role`: Edge Function `invitation-notify`, §13.1) y `private.enqueue_pet_invitation_notification` (trigger de `pet_co_owners`, §13.1).

## 8. Edge Functions (fuera del SQL, pero parte del contrato)

| Edge Function | Qué hace | Quién la llama |
|---|---|---|
| `ai-analysis-process` | Llama al proveedor de IA y guarda el resultado (`service_role`) | Mobile, justo después de `request_ai_analysis()` |
| `generate-pet-report` | Genera el PDF, lo sube a Storage, crea la fila de `pet_shared_reports` (`service_role`) | Mobile, justo después de `request_generate_report()` |
| `delete-account` | Vista previa y borrado de la cuenta: transfiere o borra las mascotas propias (con el JWT del usuario), quita sus avatares y borra el usuario de Auth (`service_role`, último paso). Ver §12 | Mobile, desde Ajustes › Eliminar mi cuenta |
| `revenuecat-webhook` | Recibe el webhook de RevenueCat (secreto propio, `verify_jwt = false`), lee en la API de RevenueCat el estado de cada cuenta afectada y lo guarda con `apply_subscription_state()` (`service_role`). Ver §19 | RevenueCat |
| `subscription-sync` | Lo mismo para el usuario del JWT, tras comprar o restaurar (no espera al webhook). Ver §19 | Mobile, desde la pantalla de Premium |
| `invitation-notify` | Envía por email (Resend) y push (Expo) los avisos de las invitaciones de co-tutor que ha hecho el usuario del JWT (`service_role` solo para la cola). Ver §13.1 | Mobile, justo después de `invite_pet_member_by_email()` |

**Contrato de seguridad obligatorio (v2.2.1), aplicado a las tres primeras funciones de la tabla:**

> Ninguna Edge Function privilegiada confía en que una llamada RPC anterior ya autorizó al usuario. `request_ai_analysis()` y `request_generate_report()` son pasos de validación útiles para dar feedback rápido al cliente (cuota, rango de fechas...), pero la Edge Function que hace el trabajo real **se autoriza a sí misma de forma independiente**, siempre en este orden:
> 1. Valida el JWT recibido (`Authorization` header).
> 2. Obtiene `auth.uid()` a partir de ESE JWT (nunca de un `user_id` en el body).
> 3. Valida el formato de los parámetros recibidos.
> 4. Vuelve a comprobar la regla de autorización correspondiente contra la base de datos (`requested_by = auth.uid()` para IA; `can_edit_pet(pet_id)` para reportes; para el borrado de cuenta, el plan se lee y se ejecuta con el JWT del usuario —RLS de `pets`, `get_pet_members`, `transfer_pet_ownership`— y Auth confirma que el usuario existe).
> 5. Solo entonces usa `service_role` para las operaciones privilegiadas (llamar al proveedor de IA, subir a Storage, borrar el usuario...).
>
> El código de referencia de v2.2.1 vivía en una carpeta `edge-functions/` que nunca llegó a este repositorio; las funciones reales están en `supabase/functions/`.

**Estado (2026-10-23):** `ai-analysis-process` está implementada en `supabase/functions/ai-analysis-process/`
(`index.ts` manejador, `guidance.ts` prompt y validación puros, `providers.ts` Gemini, OpenAI o simulador).
`delete-account` está implementada desde el 2026-10-29 (§12; sin desplegar: lo hace el usuario).
`revenuecat-webhook` y `subscription-sync` están implementadas desde el 2026-11-16 (§19; sin desplegar: lo hace el usuario). `generate-pet-report` sigue pendiente y la carpeta `edge-functions/` no está en el repo. Secretos de `ai-analysis-process`
(los define el usuario con `supabase secrets set`): `GEMINI_API_KEY` obligatoria; opcionales
`GEMINI_MODEL` (por defecto `gemini-3.5-flash-lite`), `AI_PROVIDER` (`gemini` por defecto, `openai` con
`OPENAI_API_KEY` y `OPENAI_MODEL`, o `mock`, que solo vale contra un Supabase local) y
`AI_INPUT_USD_PER_MTOK`/`AI_OUTPUT_USD_PER_MTOK` (sin ellos `cost_usd` queda `NULL`) y, desde el 2026-11-13,
`GEMINI_FALLBACK_MODEL` (modelo de respaldo: ante un `429`/`5xx` se repite una vez con la espera que pida Google y, si
sigue fallando o la espera supera 10 s, se prueba el respaldo; todo en 100 s). Cuerpo: `{ analysis_id, locale? }`
(`locale` `es` | `en`, idioma de la respuesta; cualquier otro valor, español). Respuestas: `401 not_authenticated`,
`400 invalid_request`, `404 not_found`, `403 not_authorized`, `200 { status: 'completed' | 'failed' |
'already_processing_or_done' }`. Una fila `processing` de más de 3 min se marca `failed` (`timeout`).
Desde la migración `20261030090318` (SEC-16; la función actualizada se despliega **después** de aplicarla,
porque lee la columna): la caducidad se cuenta desde el reclamo (`processing_started_at`, que anota
`claim_ai_analysis_for_processing`; sin él, desde `created_at`) y toda escritura de estado exige
`status = 'processing'`. Si otra invocación ya lo cerró, la respuesta es `already_processing_or_done` (la app
vuelve a leer la fila) y no se pisa el resultado.

**Protección contra doble procesamiento de IA:** `ai-analysis-process` reclama el análisis de forma atómica antes de procesarlo (`claim_ai_analysis_for_processing()`: `UPDATE ... SET status='processing' WHERE status='pending'`, backend-only). Si dos invocaciones llegan casi a la vez para el mismo `analysis_id`, como mucho una consigue el cambio de estado — la otra recibe `false` y no vuelve a llamar al proveedor de IA ni a cobrar coste. `ai_request_status` pasa a tener 4 valores: `pending → processing → completed|failed`.

## 9. Flujo de IA

```
Mobile: sube foto a Storage (pet-photos/{pet_id}/{uuid})
  ↓ rpc('request_ai_analysis', { pet_id, photo_path, symptom_ids })
      — valida acceso, especie, síntomas, entitlement, límite (todo en una transacción)
      — used_full_history lo decide el backend, nunca el parámetro del cliente
      — crea la fila con status='pending'
      — devuelve analysis_id
  ↓ invoke('ai-analysis-process', { analysis_id, locale })
      — se autoautoriza (JWT + requested_by = auth.uid(), ver sección 8)
      — reclama el análisis de forma atómica: pending -> processing
      — llama al proveedor de IA, actualiza status/urgency_level/
        recommendations/cost_usd/... con service_role -> completed | failed
      — contexto: perfil sin nombres, señales, texto del tutor, inicio y evolución,
        registros (todas las escalas y notas), recordatorios de salud de los últimos
        30 días y próximos 14, consultas completadas de los últimos 90 días, foto
      — pautas de la especie en el prompt; salida: resumen, nivel, causas, qué hacer,
        señales de alerta, preguntas para el veterinario y lo que se ve en la foto
      — valida la salida (nunca «diagnóstico»/«diagnosis» ni dosis) y aplica el suelo
        de urgencia por especie (urgency.ts; borrador pendiente de validación veterinaria)
  ↓ Mobile hace poll o se suscribe (Realtime) a esa fila hasta ver
    status != 'pending' y status != 'processing'
  ↓ opcional: rpc('submit_ai_feedback', { analysis_id, feedback })
```

### 9.1 Ownership del feedback (v2.2.1)

**El feedback de un análisis pertenece exclusivamente a quien lo solicitó.** `submit_ai_feedback()` exige `req.requested_by = auth.uid()` — no basta con ser miembro de la mascota. Un co-tutor puede seguir **viendo** cualquier análisis de una mascota compartida (la policy de `select` sigue siendo `is_pet_member`), pero no puede escribir feedback sobre un análisis que pidió otra persona. No existe una tabla `ai_analysis_feedback` separada ni se admite más de un feedback por análisis — sigue siendo un único par `feedback`/`feedback_comment` por fila, tal y como ya funcionaba, solo se corrigió quién puede escribirlo. Desde la migración `20261030090318` el comentario tiene como mucho 1000 caracteres (`hint` `ai_feedback_too_long` en la RPC y CHECK en la columna).

## 10. Entitlement de IA

**Regla explícita: el entitlement es siempre del usuario que solicita (`auth.uid()`), nunca del propietario de la mascota.** Si el owner es free y un editor premium pide el análisis, ese análisis usa contexto completo (premium); si es al revés, se queda en modo básico (free). `get_ai_analysis_entitlement()` no recibe ni mira `pets.owner_id` en ningún momento — solo consulta `subscriptions` para `auth.uid()`.

Desde la migración `20261116160000_premium_plans` «premium» es el plan **efectivo** (`private.is_premium`, §19): un plan `premium` caducado vuelve al cupo gratuito (`private.free_plan_limits().ai_monthly`, 3).

## 11. Límites de IA

Por **usuario y periodo** (mes natural), no por mascota — de lo contrario, crear más mascotas permitiría saltarse el límite. Free = 3 análisis/mes por usuario, contando todas sus mascotas. Las solicitudes con `status='failed'` no consumen cupo. **Desde la migración `20261029151011_ai_quota_and_invitation_hardening.sql`** el cupo se cuenta en `private.ai_analysis_usage` (una fila por solicitud, sin FK a `pets`; `counts` sigue al estado mediante el trigger `trg_sync_ai_analysis_usage`), porque las filas de `ai_analysis_requests` desaparecen en cascada al borrar la mascota y borrarla devolvía el cupo. `request_ai_analysis` exige además el aviso veterinario aceptado (`profiles.disclaimer_accepted_at`) y sus errores llevan `hint` estable (mismos mensajes que antes): `ai_disclaimer_required`, `ai_not_allowed`, `ai_pet_unavailable`, `ai_invalid_photo`, `ai_invalid_symptoms`, `ai_quota_exceeded`. Concurrencia: `request_ai_analysis()` toma un advisory lock transaccional por usuario (`pg_advisory_xact_lock`) antes de comprobar y gastar cupo, así que dos dispositivos del mismo usuario pidiendo IA casi a la vez no pueden gastar el mismo crédito — la segunda petición espera a que la primera confirme (o falle) antes de volver a contar.

**Límites de abuso (migración `20261030090318_abuse_limits_and_db_hardening.sql`, SEC-06/SEC-21)**, para todos los planes y bajo el mismo bloqueo, después del cupo mensual: (1) con **3 análisis fallidos en el día UTC** (`private.ai_analysis_usage.failed_at`, que anota el trigger al pasar a `failed`, con `failure_code` = `error_message`), ninguno más ese día: `hint` `ai_failure_limit`. No cuenta `ai_misconfigured` (clave o proveedor mal configurados: no hay coste ni culpa del usuario). (2) **Una solicitud por minuto** por usuario (cualquier fila del registro de los últimos 60 s): `hint` `ai_rate_limited`. Un fallo sigue sin gastar cupo mensual, y los fallos, como el cupo, sobreviven al borrado de la mascota. La firma no cambia; los mensajes anteriores tampoco. Probado en `abuse_limits.test.sql` y, con sesiones simultáneas, en `supabase/tests/concurrency/abuse_limits_concurrency.sh`.

**Orientación v2 (migración `20261113134252_ai_guidance_v2.sql`, 2026-11-13).** `request_ai_analysis` admite tres
parámetros opcionales al final: `p_user_context` (texto del tutor; se recortan los espacios de los extremos, en blanco =
`NULL`, más de 1000 caracteres: `hint` `ai_context_too_long`), `p_symptom_onset` (`today` | `days_1_3` |
`days_4_7` | `over_week`) y `p_symptom_trend` (`better` | `same` | `worse`); un valor fuera de lista:
`ai_invalid_context`. Se comprueban tras la foto y antes de las señales y del cupo (un contexto inválido no gasta cupo
ni cuenta para la frecuencia). La firma de 3 parámetros se borró (sin sobrecarga): una app anterior que llama con
`target_pet_id`, `p_photo_path` y `symptom_ids` usa la nueva. Columnas nuevas de `ai_analysis_requests`, con SELECT
por columna para `authenticated` y sin escritura desde el cliente: entrada `user_context`, `symptom_onset`,
`symptom_trend`; resultado (las escribe la Edge Function) `summary` (≤ 600), `warning_signs` (≤ 6 × 240),
`vet_questions` (≤ 5 × 240) y `photo_observations` (≤ 600, `NULL` sin foto). Los co-tutores ven el contexto como ven
la foto y las señales. La misma migración pone `species.ai_guidance_enabled = true` en las 9 especies; las señales de
cada una están en `supabase/seed.sql` (`docs/SEED.md`). Pruebas: `ai_guidance_v2.test.sql`.

## 12. Ownership

`pets.owner_id` es la única fuente de verdad de propiedad — `pet_co_owners.role` nunca ha admitido el valor `'owner'`. El cambio de propietario tiene **dos capas independientes de protección**, no solo una:
1. `authenticated` no tiene privilegio de `UPDATE` sobre la columna `owner_id` en absoluto (GRANT por columna).
2. Un trigger bloquea cualquier cambio de `owner_id` salvo que la transacción haya sido marcada explícitamente por `transfer_pet_ownership()`.

`transfer_pet_ownership()` bloquea la fila con `SELECT ... FOR UPDATE`, valida que el nuevo propietario existe y es co-tutor con invitación aceptada, y es atómica (todo ocurre en una sola función = una sola transacción).

Borrado de cuenta: `pets.owner_id` usa `ON DELETE RESTRICT` — Postgres rechaza el borrado de un perfil mientras siga siendo propietario de alguna mascota, así que las mascotas propias se resuelven antes. El contrato de v2.2.1 (`409 has_pets` y transferir a mano) queda **sustituido** (2026-10-29, decisión del propietario) por la Edge Function `delete-account` (`supabase/functions/delete-account/`: `deletion.ts` lógica pura, `rest.ts` llamadas HTTP, `index.ts` manejador):

- **Qué hace.** Cada mascota de la que el usuario es propietario pasa al co-tutor con rol `editor` e invitación `accepted` más antigua (`accepted_at`; a igualdad, `invited_at` y el id) con `transfer_pet_ownership`; si no tiene, se borra con todo lo suyo (cascada; sus fotos las encola el trigger `AFTER DELETE` de `pets` para `pet-storage-cleanup`). Lectores y pendientes no cuentan. Las mascotas que otros comparten con él solo se dejan (sus filas de `pet_co_owners` caen con el perfil). Después se quitan sus objetos de `avatars` (`{user_id}/…`) y, si ya no es propietario de ninguna mascota, se borra el usuario con `auth.admin.deleteUser`: el perfil y lo que cuelga de él va en cascada o queda a `NULL` (`daily_logs.logged_by`, `reminders.created_by`, `ai_analysis_requests.requested_by`…).
- **Seguridad.** El usuario sale solo del JWT (la pasarela lo verifica, `verify_jwt = true`, y la función pregunta a Auth). El plan se lee y se ejecuta **con el JWT del usuario**: RLS de `pets` y `pet_co_owners`, `get_pet_members`, `transfer_pet_ownership` y las políticas de `avatars` deciden; la clave de servicio solo se usa para `auth.admin.deleteUser`, al final. No se acepta ningún id de usuario en el body.
- **Petición** (POST, JSON estricto, sin campos de más): `{ "mode": "preview" }` o `{ "mode": "delete", "confirm": "DELETE", "expected": [{ "pet_id", "action": "transfer", "new_owner_id" } | { "pet_id", "action": "delete" }] }` (`expected` = el plan que el usuario vio, máx. 200).
- **Respuestas.** `200 { status: 'preview', plan: { transfer: [{ pet_id, pet_name, new_owner_id, new_owner_name }], delete: [{ pet_id, pet_name }], leave_shared } }` · `200 { status: 'deleted', transferred, deleted, avatars_removed }`. Errores `{ error: <código> }`: `401 not_authenticated` · `410 account_not_found` (el JWT es válido pero el usuario ya no existe: la cuenta ya se borró; respuesta final) · `400 invalid_request` · `405 method_not_allowed` · `409 plan_changed` (+ `plan` nuevo: lo que sigue siendo suyo no coincide con lo confirmado, y entonces no se ha tocado nada; o apareció una mascota durante el borrado, y entonces lo anterior ya está hecho y la cuenta sigue) · `409 too_many_pets` (más de 200 propias) · `500 server_misconfigured` · `500 server_error` (no se pudo leer el plan) · `500 deletion_incomplete` (+ `step`: `transfer` | `delete_pet` | `avatars` | `billing` | `delete_user`, y los recuentos de lo hecho). Desde el 2026-11-18, si la función tiene `REVENUECAT_SECRET_API_KEY`, justo antes de borrar el usuario de Auth borra su cliente de RevenueCat (`DELETE /v1/subscribers/{id}`; 404 = hecho); si falla, `step: 'billing'` y la cuenta sigue (el reintento lo repite).
- **Reintentos.** Cada llamada vuelve a planificar desde el estado actual: tras un fallo a medias lo transferido ya no es suyo y lo borrado ya no existe, así que repetir con el mismo `expected` converge (lo confirmado que ya no aparece no cuenta). Orden: transferencias, borrados, avatares, comprobación de que no queda ninguna mascota suya y, por último, el usuario.
- **Lo que no es atómico.** `auth.admin.deleteUser` es una sola transacción: si falla, ninguna referencia cambia y la cuenta sigue. Los pasos anteriores (cada transferencia, cada borrado de mascota, los avatares) se confirman uno a uno y no se deshacen: un fallo, una respuesta perdida o la muerte de la función dejan hecho lo anterior, y el reintento converge desde ahí (comprobado en cada paso, `docs/TESTING.md`). Si el usuario no reintenta, nada lo completa: la cuenta sigue, sin las mascotas ya resueltas.
- **Autoría.** Lo que la cuenta escribió en mascotas que siguen existiendo se queda, con el autor a `NULL`. Los triggers de auditoría permiten ese único cambio y solo si el perfil ya no existe (migración `20261105122353`, `docs/DECISIONS.md`): ni el rol ni `auth.uid()` sirven para reconocerlo. `last_edited_by` se conserva si lo editó otra persona. `updated_at` cambia en esas filas: una edición sin conexión con la versión anterior se trata como conflicto.
- **Registros**: solo códigos y recuentos (ni nombres, ni ids, ni rutas). Fuera de alcance: objetos de `reminder-attachments` y `shared-reports` (sin uso todavía).
- **Pruebas**: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON supabase/functions/delete-account/*.test.mjs` y, contra el Supabase local, `node supabase/functions/delete-account/run-integration.mjs`, `supabase/tests/database/account_deletion_audit.test.sql` y `supabase/tests/concurrency/account_deletion_concurrency.sh`.

`owner_has_pets()` sigue existiendo, pero la app ya no lo usa para este flujo.

## 13. Co-tutores

`UNIQUE(pet_id, user_id)` se mantiene. Transiciones soportadas: `pending→accepted`, `pending→declined`, `accepted→revoked`, y reinvitación (`declined→pending`, `revoked→pending`) vía `invite_pet_member()`, que reutiliza la fila existente en vez de intentar un segundo `INSERT` que chocaría con el `UNIQUE`. Ningún camino permite `viewer→editor→owner` por `UPDATE` directo: no hay policy de `UPDATE` para `authenticated` sobre `pet_co_owners`, todo pasa por RPCs que validan la transición y quién puede pedirla. Un usuario con invitación `pending` puede ver su propia fila (`user_id = auth.uid()` en la policy de select) aunque `is_pet_member()` todavía no lo considere miembro.

**Invitar por email (migración `20261023082848_pet_invitations_by_email.sql`).** `invite_pet_member_by_email` comprueba primero que quien llama es el propietario de una mascota activa (`hint` `not_pet_owner`) y que el email tiene forma válida (`invalid_email`); después responde igual si el email no tiene cuenta, es el del propio usuario o ya tiene una invitación activa, para no revelar qué emails están registrados. Desde la migración `20261029151011` solo cuentan las cuentas con el email confirmado, no baneadas, no borradas y no anónimas (una cuenta registrada con el email de otra persona sin confirmarlo no recibe sus invitaciones). Límite conocido: el propietario sigue pudiendo deducir si un email tiene cuenta porque solo entonces aparece una fila pendiente (`docs/SECURITY_AUDIT.md` SEC-04). `get_my_pet_invitations()` da las invitaciones pendientes del usuario con el nombre de la mascota y de quien invita (que RLS no le deja leer todavía); `get_pet_members(pet_id)` da los co-tutores pendientes y aceptados con su nombre, solo a miembros (`not_pet_member`).

**Desde la migración `20261030090318` (SEC-04, sin rediseñar el esquema):** `invite_pet_member_by_email` admite **20 intentos por propietario en 24 h** (ventana móvil; `hint` `invite_rate_limited`, mensaje «Has enviado demasiadas invitaciones…»), contados en `private.pet_invitation_attempts` (solo quién y cuándo, nunca el email; cuentan también los emails sin cuenta, el propio y los ya invitados; no cuentan un email mal formado ni una mascota ajena; sin FK a `pets`; se purgan los de más de 2 días). `get_pet_members` devuelve `user_id` y `full_name` **NULL en las invitaciones pendientes** (salvo a la propia persona invitada); `invitation_id`, rol, estado y fechas siguen, así que la app puede anularlas. La política SELECT de `pet_co_owners` deja de mostrar a los miembros las filas no aceptadas de otros (sección 5). **Riesgo residual:** la fila pendiente solo aparece si el email tiene una cuenta confirmada, así que el propietario puede seguir deduciendo si un email está registrado (no quién es); el límite lo reduce a 20 emails al día por cuenta. Eliminarlo del todo exige invitaciones por email en una tabla propia, sin crear la fila hasta aceptar (SEC-04, P1-07). `invite_pet_member` (por id) no tiene el límite, pero exige conocer el `user_id`, que la app ya no puede ver.

## 13.1 Avisos de invitación: email y push (migración `20261120154210_invitation_notifications.sql`)

Problema (QA-07): la persona invitada solo veía la invitación si abría la app. Ahora recibe un **email** (Resend) y un
**push** (servicio de push de Expo; en Android, por FCM) en su idioma (`profiles.locale`: `en…` → inglés; si no, español).

- **Cola** `private.pet_invitation_notifications` (RLS, sin grants; una fila por invitación, `ON DELETE CASCADE` desde
  `pet_co_owners`). La escribe el trigger `trg_enqueue_pet_invitation_notification` (`AFTER INSERT OR UPDATE OF status,
  invited_at`) cuando una invitación pasa a `pending` o se renueva, en la misma transacción. Sin cuenta no hay fila ni aviso,
  así que `invite_pet_member_by_email` sigue respondiendo igual exista o no el email.
- **Edge Function `invitation-notify`** (`verify_jwt = true`): la app la llama tras invitar (POST sin cuerpo, JWT de quien
  invita). Comprueba el JWT con Auth y, con la clave de servicio, reserva **solo los avisos de las invitaciones de ese usuario**
  (`pet_invitation_notifications_claim(p_inviter_id, p_limit)`: pendientes, mascota activa, menos de 7 días, menos de 3 reservas,
  reserva de 5 min con `FOR UPDATE SKIP LOCKED`). Devuelve el email (solo de una cuenta confirmada y vigente), el idioma, los
  nombres, el rol, si la persona invitada tiene los avisos activos (`notification_preferences.alert_notifications_enabled`, por
  defecto `true`), qué canales faltan y hasta 5 tokens activos. Anota cada canal con
  `pet_invitation_notifications_complete(…, p_invalid_tokens)` (códigos `[a-z_]`; desactiva los tokens que Expo da por no
  registrados, solo de la persona invitada). Cada canal se envía como mucho una vez; uno que falla se reintenta en la siguiente
  llamada de ese usuario (hasta 3 reservas). El email lleva una clave de idempotencia de Resend.
- **Respuestas:** `200 { status: 'ok' }` haya avisos o no (no revela nada), `401 not_authenticated`, `405`, `500
  server_misconfigured | server_error`. La app la llama en segundo plano: la invitación ya está hecha aunque falle.
- **Estados por canal:** `sent`, `rejected` (Resend no acepta el mensaje), `not_configured` (sin `RESEND_API_KEY`/
  `INVITATION_EMAIL_FROM`), `no_email`, `no_devices`, `opted_out` (avisos apagados en Ajustes › Notificaciones);
  reintentables: `network`, `resend_http`, `expo_http`, `expo_error`.
- **Secretos** (los pone el usuario: `supabase/functions/deploy-template.sh`): `RESEND_API_KEY`, `INVITATION_EMAIL_FROM`
  (dominio verificado en Resend) y, opcional, `EXPO_ACCESS_TOKEN`. El push en Android necesita además la clave FCM V1 en EAS y
  el `google-services.json` en la build (`docs/SETUP_GUIDE.md` §8).
- **Contenido:** nombre de quien invita (o «Alguien»), nombre de la mascota y el permiso; el push abre `/invitations`. Ningún
  registro de la función lleva emails, nombres ni tokens.

## 14. Timezone

`daily_logs.log_date` representa el día **local según la zona horaria del propietario principal** de la mascota (`pets.owner_id → profiles.timezone`), nunca la del dispositivo que registra ni la del servidor. Con mascotas compartidas entre tutores de distintos husos horarios, hay un único calendario por mascota, no uno por persona. El cliente calcula y envía `log_date`; el servidor solo valida que no sea futuro respecto al "hoy" del propietario.

**Validación de `profiles.timezone` (nueva en v2.2.1):** un trigger (`validate_profile_timezone`) rechaza en `INSERT`/`UPDATE` cualquier valor que no exista en `pg_timezone_names` — no podía ser un `CHECK` porque Postgres no permite que un `CHECK` consulte otra tabla/vista, así que un trigger es la única vía correcta, no una preferencia de estilo. **El frontend debe enviar siempre nombres IANA** (`Europe/Madrid`, `America/New_York`, `Asia/Tokyo`), nunca abreviaturas ambiguas como `CET` o `PST` — esas fallarían la validación.

> Cambio posterior (migración `20261008155257_profile_timezone.sql`): `profiles.timezone` admite `NULL` = sin configurar, sin default; el trigger ya no convierte `NULL` en `'UTC'` y los `'UTC'` existentes (siempre el default, no había forma de elegirlo) pasaron a `NULL`. El servidor sigue usando `UTC` donde necesita un "hoy" (`coalesce`). El trigger solo valida cuando el valor cambia y exige `UTC` o Área/Ubicación: `pg_timezone_names` incluye `CET`, `GMT+0`, `EST5EDT` o `posix/…`, que antes pasaban y ahora se rechazan. La app inicializa la zona con la del dispositivo sin sobrescribir nunca un valor existente (`FRONTEND_ARCHITECTURE.md` §9).

## 15. Daily logs

`UNIQUE(pet_id, log_date)`: un registro por mascota y día (el cliente hace upsert, no insert repetido). `pet_id`, `logged_by` y `created_at` son inmutables tras la creación (GRANT por columna + trigger). `last_edited_by` y `updated_at` se gestionan solos vía trigger. No se permiten fechas futuras respecto al "hoy" del propietario (sección 14), pero un registro de un día pasado que llega tarde por estar offline se acepta sin problema.

> Cambios posteriores (migración `20261008150202_daily_logs_fixes.sql`, decisión en `DECISIONS.md`):
> - El cliente guarda con la RPC `save_daily_log` (SECURITY INVOKER), no con upsert: el `ON CONFLICT DO UPDATE` de PostgREST incluye `pet_id`/`logged_by`, que no tienen GRANT de UPDATE. La RPC hace UPDATE y, si no existe, INSERT, porque los triggers BEFORE INSERT se ejecutan antes de detectar el conflicto.
> - Al **crear**, `log_date` debe estar entre hoy y hoy − 7 en la zona del propietario; un registro offline más antiguo se rechaza (`hint` `log_date_too_old`). Al **editar** no hay límite. `log_date` es inmutable (sin GRANT de UPDATE + trigger `protect_daily_log_audit_fields`).
> - CHECKs: `tags` ⊆ {`vet_visit`, `home_change`, `new_pet`}; `notes` ≤ 2000 y `unusual_behavior_notes` ≤ 1000 caracteres; `daily_logs_not_empty_check` (al menos un nivel, comportamiento inusual, una nota con texto o una etiqueta).
> - Grants: `anon` sin privilegios; `authenticated` sin TRUNCATE/REFERENCES/TRIGGER/MAINTAIN.
>
> Concurrencia optimista (migración `20261010160332_daily_logs_concurrency.sql`, decisión en `DECISIONS.md`):
> - `save_daily_log` acepta dos precondiciones opcionales: `p_expected_updated_at` (edita solo si `updated_at` sigue siendo el que leyó el cliente) y `p_expect_absent` (crea solo si no hay registro de ese día). Si no se cumplen: `P0001`, `hint` `daily_log_conflict`, `detail` `version_mismatch` | `row_missing` | `row_exists`; no se escribe nada. Los permisos se comprueban antes.
> - La versión es `updated_at` (la pone el trigger `set_timestamp_daily_logs`). La comprobación está en el `WHERE` del `UPDATE` y en `UNIQUE (pet_id, log_date)`: es atómica.
> - La comparación de versión es exacta (microsegundos): el cliente reenvía la cadena de `updated_at` tal como la recibió.
> - Sin precondiciones se mantiene el comportamiento anterior (sustituye sin comprobar: gana el último guardado), solo por compatibilidad con builds anteriores: el frontend envía siempre una precondición desde la fase 2 del modo offline. No sirve para la sincronización offline.
> - Una sola función: se borró la firma de 13 parámetros y se creó la de 15 (los dos nuevos con default), para no dejar una sobrecarga sin protección.

## 15.1 Campos por especie (migración `20261111120000_species_fields.sql`)

Diseño y decisiones: `docs/proposals/2026-11-11-species-fields.md` y `DECISIONS.md` (2026-11-11).

- **Especies:** las 9 del catálogo están activas. `species.ai_guidance_enabled` (solo `dog` y `cat`):
  `request_ai_analysis` rechaza las demás con `hint` `ai_species_unsupported` (después de los permisos y antes
  del cupo). «Ave (otra)» y «Reptil (otro)» se llaman «Ave» y «Reptil»; los códigos no cambian.
- **`species_fields`** (lectura para `authenticated`; la escriben solo las migraciones): por especie y ámbito
  (`profile` = ficha, `daily` = registro diario), `code`, `kind` (`scale3` 2/3/4, `choice`, `multi_choice`,
  `boolean`, `integer`, `decimal`, `date`, o `core` = una de las 7 escalas comunes), `options`, `min_value`/`max_value`,
  `unit`, `position`, `is_primary` (escalas comunes obligatorias al crear) e `is_active`. Copia de la app:
  `frontend/src/features/species/species-fields.ts` (prueba de paridad contra el Supabase local).
- **`pets.species_data` y `daily_logs.species_data`** (`jsonb NOT NULL DEFAULT '{}'`, objeto plano, ≤ 4096 bytes;
  GRANT de INSERT/UPDATE para `authenticated`). Las claves son códigos del catálogo de la especie **actual** de la
  mascota y del ámbito; sin texto libre. Lo valida el trigger `validate_species_data` (SECURITY DEFINER): tipo,
  opciones, rango y fecha no futura (`private.species_value_is_valid`). **Solo se validan las claves que cambian**:
  los datos de otra especie (tras cambiarla) o de un campo retirado se conservan y el registro se sigue pudiendo
  editar. Error: `P0001`, `hint` `species_data_invalid`, `detail` = código del campo (o `species_data`).
- **Cambiar la especie** de una mascota sin enviar datos nuevos vacía `pets.species_data`; con datos, se validan
  contra la especie nueva. Los registros diarios conservan los suyos.
- **`save_daily_log(…, p_species_data jsonb DEFAULT NULL)`:** `NULL` (o sin el parámetro, como las versiones
  anteriores de la app) **conserva** lo guardado; `'{}'` lo vacía. Firma de 16 parámetros, sin sobrecarga.
- **`daily_logs_not_empty_check`:** también vale un registro que solo tiene datos de especie.

## 16. Streaks

`daily_logs` es la fuente de verdad; `pet_streaks` es una caché reconstruible en cualquier momento desde `daily_logs` (nunca al revés). `longest_streak` nunca decrece aunque se borren registros (`greatest()` sobre el valor ya guardado). `recompute_pet_streak()` recalcula la racha COMPLETA cada vez (no incrementa sobre el valor anterior), lo que la hace correcta ante registros retroactivos y ante sincronización offline sin importar el orden de llegada; un advisory lock por mascota serializa recálculos concurrentes de dos dispositivos. El cliente no puede escribir en `pet_streaks` bajo ningún concepto.

> Correcciones posteriores (migración `20261008150202_daily_logs_fixes.sql`): `recompute_pet_streak()` sumaba `date + bigint` (operador inexistente), así que ninguna escritura en `daily_logs` funcionaba; ahora usa `rn::integer`, misma lógica. Y `trg_recompute_pet_streak_fn()` ya no recalcula al borrar un registro si la mascota ya no existe (borrado en cascada): reinsertaba `pet_streaks` de una mascota borrada y violaba su FK, así que borrar una mascota con 2+ registros fallaba.

## 17. Reminders

`pet_id`, `created_by`, `created_at` inmutables tras la creación (misma doble protección que `daily_logs`). `status`/`completed_at` se mantienen coherentes automáticamente vía trigger: `status='completed'` sin `completed_at` se autocompleta con `now()`; cualquier otro estado limpia `completed_at`. `attachment_path` se valida contra el `pet_id` del propio recordatorio (no se puede referenciar el archivo de otra mascota). `recurrence_rule` solo tiene una validación de formato básica en SQL — el parser RRULE completo vive en el backend.

> Corrección posterior (migración `20261028200659_reminders_is_active.sql`, aplicada en `kitom-dev` el 2026-10-29): `is_active boolean NOT NULL DEFAULT true` para activar y desactivar un recordatorio sin borrarlo ni cambiar `status` (un desactivado sigue `pending`). `GRANT INSERT/UPDATE (is_active)` a `authenticated`; RLS sin cambios (solo editores). Sin efecto en el servidor: la app no avisa ni cuenta como vencido uno inactivo. Permisos de la tabla probados en `supabase/tests/database/reminders.test.sql` y la columna en `reminders_is_active.test.sql`.

## 18. Storage

Los 4 buckets (`pet-photos`, `reminder-attachments`, `shared-reports`, `avatars`) son **privados**. Nunca se persisten URLs, solo `*_path` — las URLs firmadas se generan bajo demanda (`createSignedUrl`). Convención de rutas: `{pet_id}/{object_uuid}` para los 3 buckets de mascota, `{user_id}/{object_uuid}` para avatars. Las policies validan el formato del path con `safe_pet_id_from_path()` antes de castear a UUID, en vez de castear directamente y arriesgarse a un error de tipo. Ningún bucket concede `UPDATE` (se borra y se vuelve a subir si hace falta reemplazar un archivo).

> Corrección posterior (migración `20261007182429_grant_safe_pet_id_from_path.sql`): las policies se evalúan con el rol `authenticated`, que necesita `EXECUTE` sobre `safe_pet_id_from_path()`; el diseño original se lo revocaba y ninguna operación en los buckets de mascota podía funcionar. La función solo interpreta el texto del path.

## 19. RevenueCat y Kitom Premium

**Migración `20261116160000_premium_plans.sql` (2026-11-16; decisión en `DECISIONS.md`; aplicada en `kitom-dev` por el usuario el 2026-11-18, tipos regenerados con `--linked`).**

- **Plan efectivo:** `private.is_premium(uid)` = `subscriptions.plan = 'premium'`, `status` en `active`/`trialing`/`past_due` y `current_period_end` nulo o futuro. Límites del plan gratuito en `private.free_plan_limits()`: 2 mascotas propias activas, 30 días de historial (solo la app los oculta: la BD no) y 3 consultas de IA al mes.
- **`get_my_plan()`** (authenticated): `plan`, `is_premium`, `status`, `current_period_end`, `trial_end`, `cancel_at_period_end`, `owned_pets`, `max_owned_pets`, `history_days`, `can_invite_co_owners`, `ai_monthly_used`, `ai_monthly_limit` (`NULL` = sin límite). La app nunca calcula el plan.
- **Mascotas:** trigger `trg_enforce_pet_plan_limit` (`BEFORE INSERT` en `pets`, `private.enforce_pet_plan_limit`): con sesión de usuario y sin Premium, como mucho 2 propias activas (`hint` `pet_limit_reached`). Bloqueo por usuario; el reenvío de un alta existente (misma `client_request_id`) sigue dando 23505. Transferencias y procesos sin `auth.uid()` no se limitan.
- **Co-tutores:** `invite_pet_member` e `invite_pet_member_by_email` exigen Premium (`hint` `premium_required`) justo después de comprobar la propiedad y antes de mirar el email. Aceptar no exige Premium.
- **`apply_subscription_state(p_user_id, p_source_event_id, p_event_type, p_state_at, p_is_premium, p_status, p_current_period_start, p_current_period_end, p_trial_end, p_cancel_at_period_end, p_provider, p_provider_subscription_id, p_raw_payload)`** (solo `service_role`): registra el evento en `subscription_events` (idempotente por `provider_event_id`) y guarda el estado si no es más antiguo que el guardado (`subscriptions.provider_state_at`, sin GRANT al cliente). Devuelve `applied`, `duplicate`, `stale` o `unknown_user` (cuenta que ya no existe). Si la compra pasa a otra cuenta, suelta su `provider_subscription_id` de la anterior.
- **Privilegios:** se retiran los de escritura de tabla de `anon` y `authenticated` sobre `subscriptions` y `subscription_events`; `authenticated` conserva su SELECT por columna.
- **Edge Functions** (`supabase/functions/_shared/subscription-*.ts`, probadas con `node --test`): `revenuecat-webhook` exige `Authorization` = `REVENUECAT_WEBHOOK_AUTH` (≥ 32 caracteres; también con «Bearer ») y, para cada cuenta del evento (`app_user_id`, alias y transferencias; solo UUID de Kitom), lee `GET https://api.revenuecat.com/v1/subscribers/{id}` con `REVENUECAT_SECRET_API_KEY`, calcula el estado con el entitlement `REVENUECAT_ENTITLEMENT_ID` (por defecto `premium`) y llama a `apply_subscription_state` con el id `<evento>:<cuenta>`. Respuestas: `200 { status: 'processed', applied, duplicate, stale, unknown_user }` · `200 { status: 'ignored' }` (evento `TEST` o sin cuenta de Kitom) · `401 unauthorized` · `400 invalid_request` · `405` · `500 server_misconfigured | provider_unavailable | server_error` (RevenueCat reintenta). `subscription-sync` (JWT del usuario, `verify_jwt = true`): `200 { status }` · `401 not_authenticated` · `502 provider_unavailable` · `500 server_misconfigured | server_error`. El `app_user_id` de RevenueCat es el id de Supabase del usuario (`Purchases.configure`/`logIn` en la app).

Diseño original (v2.2.1, sin uso desde 2026-11-16):

`subscription_events.provider_event_id UNIQUE` + `process_revenuecat_event()` (una sola función = una sola transacción: comprobar idempotencia, registrar el evento y actualizar `subscriptions`, todo o nada). Un mismo evento recibido dos veces es un no-op la segunda vez. `subscriptions.provider_subscription_id` tiene un índice único parcial (ignorando `NULL`): una misma suscripción de RevenueCat no puede quedar asociada a dos usuarios. No se ha añadido una columna `received_at` separada de `occurred_at` — decisión explícita, no necesaria para el MVP (`CHANGELOG_v2.2.md` no se conserva; ver `CHANGELOG_v2.2.1.md`).

## 20. Organizations

Solo preparación (`organizations`, `organization_members`), sin recursión de RLS (`is_org_member()`). Sin portal, sin alta desde la app, sin vínculo desde `pets`, sin billing empresarial. Nada de esto bloquea el MVP ni añade complejidad al frontend actual.

## 20.1 Push tokens — ciclo de vida (nuevo en v2.2.1)

`push_tokens.token` es `UNIQUE` a nivel global (es un identificador físico de dispositivo/instalación, no algo propio de una sola cuenta). Esto genera un caso concreto a resolver: el mismo dispositivo puede tener sesiones de distintos usuarios a lo largo del tiempo (usuario A cierra sesión, usuario B entra en el mismo teléfono).

- **login / app launch:** llamar siempre a `rpc('register_push_token', { token, platform, device_id, app_version, os_version })`. Es un upsert que reasigna el token al `auth.uid()` actual sin importar a quién perteneciera antes — seguro porque el token lo emite el sistema operativo/servicio de push para ESE dispositivo, no es un secreto de otro usuario.
- **token refresh** (el SO puede rotar el token): volver a llamar a `register_push_token` con el nuevo valor.
- **logout:** recomendado (no obligatorio) borrar la fila propia (`delete from push_tokens where token = ...`, permitido por la policy `manage own`) antes de cerrar sesión, como buena práctica — pero `register_push_token` cubre el caso igualmente aunque esto falle (cierre sin red, cierre forzado de la app).
- **cambio de usuario en el mismo dispositivo:** no requiere lógica especial más allá de repetir el paso de login — `register_push_token` ya reasigna correctamente.

No se creó ninguna tabla nueva ni se cambió la restricción `UNIQUE(token)`.

**En la app (2026-11-20):** `PushRegistration` registra el token de Expo con sesión, conexión y el permiso de avisos concedido (una vez por ejecución y cuenta) y el cierre de sesión borra la fila propia (como mucho 3 s). Los usa `invitation-notify` (§13.1), que desactiva (`is_active = false`) los tokens que Expo da por no registrados.

## 20.2 Storage — semántica de paths por campo (aclarado en v2.2.1)

| Columna | Bucket | Convención de ruta |
|---|---|---|
| `pets.photo_path` | `pet-photos` | `{pet_id}/{object_uuid}.{ext}` |
| `ai_analysis_requests.photo_path` | `pet-photos` (mismo bucket que arriba) | `{pet_id}/{object_uuid}.{ext}` |
| `reminders.attachment_path` | `reminder-attachments` | `{pet_id}/{object_uuid}.{ext}` |
| `pet_shared_reports.file_path` | `shared-reports` | `{pet_id}/{object_uuid}.pdf` |
| `profiles.avatar_path` | `avatars` | `{user_id}/{object_uuid}.{ext}` |

> Corrección posterior (migración `20261027194904_pets_photo_path_own_pet.sql`, aplicada en `kitom-dev` el 2026-10-28): `pets.photo_path` no tenía validación (a diferencia de `ai_analysis_requests.photo_path` y `reminders.attachment_path`). Ahora un CHECK solo admite NULL o `{id de la propia mascota}/{nombre}.jpg` (un nivel, `.jpg`, lo que genera la app). Y la migración `20261027194908_pet_storage_cleanup.sql` añade la limpieza de `pet-photos` de las mascotas borradas: cola privada llenada por un trigger, RPC solo para `service_role` y la Edge Function `pet-storage-cleanup` (`docs/proposals/2026-10-26-pet-photos-cleanup.md`). `reminder-attachments` y `shared-reports` quedan fuera.

> Programación (migración `20261030090318_abuse_limits_and_db_hardening.sql`, P1-04): `pg_cron` (en
> `pg_catalog`) y `pg_net` (en `extensions`) y dos tareas de `cron.job` como `postgres`:
> `kitom-pet-storage-cleanup` (`*/30 * * * *`, `{"task":"process"}`) y `kitom-pet-storage-cleanup-audit`
> (`17 4 * * *`, `{"task":"audit"}`). Ambas llaman a `private.invoke_pet_storage_cleanup(task)`, que lee de
> Vault (por nombre) `kitom_project_url` (`https://<ref>.supabase.co`, sin barra final) y
> `pet_storage_cleanup_secret` (el mismo valor que el secreto `PET_STORAGE_CLEANUP_SECRET` de la función,
> ≥ 32 caracteres) y hace `net.http_post` a `{url}/functions/v1/pet-storage-cleanup` con la cabecera
> `x-kitom-cleanup-secret` (60 s). Sin Vault, sin `pg_net` o sin alguno de los dos secretos (o con una URL
> o un secreto no válidos) no hace nada y devuelve `NULL`, sin error. Ningún secreto está en la migración.
> Qué se borra lo sigue decidiendo la función (modo informe salvo `PET_STORAGE_CLEANUP_MODE=delete`).
> `pg_net` concede `EXECUTE` sobre `net.*` a `anon`/`authenticated` (lo hace Supabase y `postgres` no
> puede revocarlo); el esquema `net` no está expuesto por la API.

El bucket nunca viaja como parámetro desde el cliente — cada Edge Function y cada policy de Storage tiene su bucket fijo hardcodeado (p. ej. `PHOTO_BUCKET = 'pet-photos'` en `supabase/functions/ai-analysis-process/index.ts`). Los paths guardados en columnas `*_path` son siempre internos, nunca una URL — ni pública ni firmada. Las URLs firmadas se generan bajo demanda en el momento de mostrarlas (`createSignedUrl`), nunca se persisten.

## 21. Seguridad — resumen de las capas usadas

- **GRANT por columna** en `pets` (nunca `owner_id`/vía UPDATE), `profiles` (nunca `id`/`created_at`/`updated_at`), `daily_logs` y `reminders` (nunca sus campos de auditoría), `ai_analysis_requests` y `subscriptions` (columnas internas nunca expuestas ni por SELECT).
- **RLS** en las 24 tablas, sin excepciones.
- **`SECURITY DEFINER` auditadas una a una**: todas con `SET search_path = public`, todas con `EXECUTE` revocado explícitamente de `public` **y** `anon` (no solo de `anon` — revocar de un rol concreto no anula lo heredado de `PUBLIC`, que Postgres concede por defecto al crear cualquier función; esto se corrigió en v2.2.1 para `is_pet_member`, `can_edit_pet` e `is_org_member`, las únicas que tenían el patrón incompleto), y concedido solo donde corresponde. Ninguna permite acceso cross-user ni cross-pet (todas validan `auth.uid()` y pertenencia antes de tocar nada).
- **Sin recursión de RLS** en `pet_co_owners` ni `organization_members`.
- **Sin doble fuente de verdad**: propiedad (`pets.owner_id`), roles (`pet_co_owners.role` sin `'owner'`), racha (`pet_streaks` como caché), entitlement (siempre `auth.uid()`).

## 22. Limitaciones conocidas (documentadas, no resueltas a propósito)

- Los co-tutores no pueden ver el avatar de otro co-tutor (bucket privado, solo lectura propia). Si hace falta, se resuelve con una Edge Function que emita signed URLs comprobando membresía compartida — no ampliando la policy de RLS del bucket.
- `recurrence_rule` solo tiene validación de formato básica en SQL.
- `catalog_translations` es una asociación polimórfica: Postgres no puede garantizar una FK real hacia la tabla correcta según `entity_type`; la integridad depende del seed/backend.
- No existe `received_at` separado de `occurred_at` en `subscription_events`.
- `organizations` es solo estructura, sin ningún flujo de producto construido encima.
- `generatePdf()` (en `generate-pet-report`) es un contrato definido, pendiente de la librería de generación de PDF. El proveedor de IA de `ai-analysis-process` ya está integrado (Gemini, con OpenAI como alternativa; 2026-10-23); su prompt y las reglas de urgencia son un borrador a validar por un veterinario (`docs/DECISIONS.md`).
- Ver `CHANGELOG_v2.2.1.md` (el de v2.2 no se conserva) para el historial de decisiones de diseño; el estado desplegado, en `DATABASE.md`.
