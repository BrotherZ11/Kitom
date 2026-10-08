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
| `pet_co_owners` | miembros o el propio invitado | — (solo RPC) | — (solo RPC) | — (solo RPC) |
| `daily_logs` | miembros | editores, `logged_by=auth.uid()` (columnas concretas; en la práctica vía RPC `save_daily_log`) | editores (solo columnas de datos, nunca pet_id/logged_by/log_date/created_at) | editores |
| `symptoms_catalog` / `symptom_species` | autenticados | — | — | — |
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

## 6. RPCs (funciones con `EXECUTE` para `authenticated`)

| Función | Tabla(s) que toca |
|---|---|
| `is_pet_member(uuid)`, `can_edit_pet(uuid)` | lectura, `pets`/`pet_co_owners` |
| `owner_has_pets()` | lectura, `pets` (solo sobre `auth.uid()`, sin parámetro) |
| `invite_pet_member(pet_id, invitee, role)` | `pet_co_owners` |
| `accept_pet_invitation` / `decline_pet_invitation` / `revoke_pet_invitation` / `change_pet_member_role` | `pet_co_owners` |
| `transfer_pet_ownership(pet_id, new_owner_id)` | `pets`, `pet_co_owners` |
| `get_ai_analysis_entitlement()` | lectura, `subscriptions` + `ai_analysis_requests` (siempre sobre `auth.uid()`) |
| `request_ai_analysis(pet_id, photo_path, symptom_ids[])` | `ai_analysis_requests`, `ai_analysis_symptoms`, `pet_achievements` |
| `submit_ai_feedback(analysis_id, feedback, comment)` | `ai_analysis_requests` (solo columnas de feedback) |
| `create_clinic_referral(code, source, campaign)` | `clinic_referrals` |
| `request_generate_report(pet_id, start, end)` | solo validación, no escribe nada |
| `is_org_member(org_id)` | lectura, `organization_members` |
| `register_push_token(token, platform, device_id, app_version, os_version)` | `push_tokens` — reasigna el token al `auth.uid()` actual, ver sección 17.1 |
| `save_daily_log(pet_id, log_date, <7 niveles>, unusual_behavior, unusual_behavior_notes, notes, tags)` | `daily_logs` — crea o sustituye el registro del día; **SECURITY INVOKER** (aplica RLS y grants de quien llama). Añadida en la migración `20261008150202`, ver sección 15 |

**Nota de taxonomía (v2.2.1):** dentro de esta tabla hay dos tipos distintos, aunque ambos tengan `EXECUTE` para `authenticated`:
- **RPC de producto** (la mayoría): representan una acción real de negocio que el frontend invoca — `request_ai_analysis`, `invite_pet_member`, `transfer_pet_ownership`...
- **Helper interno accesible** (`is_pet_member`, `can_edit_pet`, `is_org_member`): existen sobre todo para usarse DENTRO de policies de RLS; se conceden a `authenticated` porque además son útiles de consultar directamente (p. ej. `generate-pet-report` las usa vía el cliente de usuario, ver sección 8), pero no representan una acción de negocio en sí mismas.

## 7. Funciones exclusivamente backend (sin `EXECUTE` para `authenticated`/`anon`)

`trigger_set_timestamp`, `safe_pet_id_from_path`, `protect_pet_structural_fields`, `validate_pet_birth_date`, `set_last_edited_by`, `validate_daily_log_date`, `protect_daily_log_audit_fields`, `validate_symptom_species_compat`, `sync_reminder_completion`, `protect_reminder_audit_fields`, `validate_reminder_attachment_path`, `recompute_pet_streak`, `trg_recompute_pet_streak_fn`, `award_pet_achievement`, `handle_new_user`, `validate_ai_request_photo_path`, `process_revenuecat_event`, `validate_profile_timezone` (nueva, v2.2.1), `claim_ai_analysis_for_processing` (nueva, v2.2.1 — exclusiva de la Edge Function `ai-analysis-process` vía `service_role`).

## 8. Edge Functions (fuera del SQL, pero parte del contrato)

| Edge Function | Qué hace | Quién la llama |
|---|---|---|
| `ai-analysis-process` | Llama al proveedor de IA y guarda el resultado (`service_role`) | Mobile, justo después de `request_ai_analysis()` |
| `generate-pet-report` | Genera el PDF, lo sube a Storage, crea la fila de `pet_shared_reports` (`service_role`) | Mobile, justo después de `request_generate_report()` |
| `delete-account` | Comprueba `owner_has_pets()` y, si procede, borra la cuenta (`service_role`) | Mobile, desde la pantalla de borrado de cuenta |
| `revenuecat-webhook` | Recibe el webhook de RevenueCat, llama a `process_revenuecat_event()` (`service_role`) | RevenueCat |

**Contrato de seguridad obligatorio (v2.2.1), aplicado a las tres primeras funciones de la tabla:**

> Ninguna Edge Function privilegiada confía en que una llamada RPC anterior ya autorizó al usuario. `request_ai_analysis()` y `request_generate_report()` son pasos de validación útiles para dar feedback rápido al cliente (cuota, rango de fechas...), pero la Edge Function que hace el trabajo real **se autoriza a sí misma de forma independiente**, siempre en este orden:
> 1. Valida el JWT recibido (`Authorization` header).
> 2. Obtiene `auth.uid()` a partir de ESE JWT (nunca de un `user_id` en el body).
> 3. Valida el formato de los parámetros recibidos.
> 4. Vuelve a comprobar la regla de autorización correspondiente contra la base de datos (`requested_by = auth.uid()` para IA; `can_edit_pet(pet_id)` para reportes; `owner_has_pets()` para borrado de cuenta).
> 5. Solo entonces usa `service_role` para las operaciones privilegiadas (llamar al proveedor de IA, subir a Storage, borrar el usuario...).
>
> El código de referencia de las tres funciones está en `edge-functions/` dentro de esta misma carpeta.

**Protección contra doble procesamiento de IA:** `ai-analysis-process` reclama el análisis de forma atómica antes de procesarlo (`claim_ai_analysis_for_processing()`: `UPDATE ... SET status='processing' WHERE status='pending'`, backend-only). Si dos invocaciones llegan casi a la vez para el mismo `analysis_id`, como mucho una consigue el cambio de estado — la otra recibe `false` y no vuelve a llamar al proveedor de IA ni a cobrar coste. `ai_request_status` pasa a tener 4 valores: `pending → processing → completed|failed`.

## 9. Flujo de IA

```
Mobile: sube foto a Storage (pet-photos/{pet_id}/{uuid})
  ↓ rpc('request_ai_analysis', { pet_id, photo_path, symptom_ids })
      — valida acceso, especie, síntomas, entitlement, límite (todo en una transacción)
      — used_full_history lo decide el backend, nunca el parámetro del cliente
      — crea la fila con status='pending'
      — devuelve analysis_id
  ↓ invoke('ai-analysis-process', { analysis_id })
      — se autoautoriza (JWT + requested_by = auth.uid(), ver sección 8)
      — reclama el análisis de forma atómica: pending -> processing
      — llama al proveedor de IA, actualiza status/urgency_level/
        recommendations/cost_usd/... con service_role -> completed | failed
  ↓ Mobile hace poll o se suscribe (Realtime) a esa fila hasta ver
    status != 'pending' y status != 'processing'
  ↓ opcional: rpc('submit_ai_feedback', { analysis_id, feedback })
```

### 9.1 Ownership del feedback (v2.2.1)

**El feedback de un análisis pertenece exclusivamente a quien lo solicitó.** `submit_ai_feedback()` exige `req.requested_by = auth.uid()` — no basta con ser miembro de la mascota. Un co-tutor puede seguir **viendo** cualquier análisis de una mascota compartida (la policy de `select` sigue siendo `is_pet_member`), pero no puede escribir feedback sobre un análisis que pidió otra persona. No existe una tabla `ai_analysis_feedback` separada ni se admite más de un feedback por análisis — sigue siendo un único par `feedback`/`feedback_comment` por fila, tal y como ya funcionaba, solo se corrigió quién puede escribirlo.

## 10. Entitlement de IA

**Regla explícita: el entitlement es siempre del usuario que solicita (`auth.uid()`), nunca del propietario de la mascota.** Si el owner es free y un editor premium pide el análisis, ese análisis usa contexto completo (premium); si es al revés, se queda en modo básico (free). `get_ai_analysis_entitlement()` no recibe ni mira `pets.owner_id` en ningún momento — solo consulta `subscriptions` para `auth.uid()`.

## 11. Límites de IA

Por **usuario y periodo** (mes natural), no por mascota — de lo contrario, crear más mascotas permitiría saltarse el límite. Free = 3 análisis/mes por usuario, contando todas sus mascotas. Las solicitudes con `status='failed'` no consumen cupo. Concurrencia: `request_ai_analysis()` toma un advisory lock transaccional por usuario (`pg_advisory_xact_lock`) antes de comprobar y gastar cupo, así que dos dispositivos del mismo usuario pidiendo IA casi a la vez no pueden gastar el mismo crédito — la segunda petición espera a que la primera confirme (o falle) antes de volver a contar.

## 12. Ownership

`pets.owner_id` es la única fuente de verdad de propiedad — `pet_co_owners.role` nunca ha admitido el valor `'owner'`. El cambio de propietario tiene **dos capas independientes de protección**, no solo una:
1. `authenticated` no tiene privilegio de `UPDATE` sobre la columna `owner_id` en absoluto (GRANT por columna).
2. Un trigger bloquea cualquier cambio de `owner_id` salvo que la transacción haya sido marcada explícitamente por `transfer_pet_ownership()`.

`transfer_pet_ownership()` bloquea la fila con `SELECT ... FOR UPDATE`, valida que el nuevo propietario existe y es co-tutor con invitación aceptada, y es atómica (todo ocurre en una sola función = una sola transacción).

Borrado de cuenta: `pets.owner_id` usa `ON DELETE RESTRICT` — Postgres rechaza el borrado de un perfil mientras siga siendo propietario de alguna mascota. `owner_has_pets()` (sin parámetros, solo sobre `auth.uid()`) permite que el flujo de "borrar mi cuenta" lo compruebe antes de intentarlo y pida transferir primero si hace falta. **Formalizado en v2.2.1** como la Edge Function `delete-account` (código en `edge-functions/delete-account/`): ignora cualquier `user_id` que llegara en el body de la petición, obtiene el usuario únicamente del JWT, vuelve a comprobar `owner_has_pets()` ella misma (nunca confía en que el frontend ya lo hizo), y solo entonces llama a `auth.admin.deleteUser()` con `service_role`.

## 13. Co-tutores

`UNIQUE(pet_id, user_id)` se mantiene. Transiciones soportadas: `pending→accepted`, `pending→declined`, `accepted→revoked`, y reinvitación (`declined→pending`, `revoked→pending`) vía `invite_pet_member()`, que reutiliza la fila existente en vez de intentar un segundo `INSERT` que chocaría con el `UNIQUE`. Ningún camino permite `viewer→editor→owner` por `UPDATE` directo: no hay policy de `UPDATE` para `authenticated` sobre `pet_co_owners`, todo pasa por RPCs que validan la transición y quién puede pedirla. Un usuario con invitación `pending` puede ver su propia fila (`user_id = auth.uid()` en la policy de select) aunque `is_pet_member()` todavía no lo considere miembro.

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

## 16. Streaks

`daily_logs` es la fuente de verdad; `pet_streaks` es una caché reconstruible en cualquier momento desde `daily_logs` (nunca al revés). `longest_streak` nunca decrece aunque se borren registros (`greatest()` sobre el valor ya guardado). `recompute_pet_streak()` recalcula la racha COMPLETA cada vez (no incrementa sobre el valor anterior), lo que la hace correcta ante registros retroactivos y ante sincronización offline sin importar el orden de llegada; un advisory lock por mascota serializa recálculos concurrentes de dos dispositivos. El cliente no puede escribir en `pet_streaks` bajo ningún concepto.

> Correcciones posteriores (migración `20261008150202_daily_logs_fixes.sql`): `recompute_pet_streak()` sumaba `date + bigint` (operador inexistente), así que ninguna escritura en `daily_logs` funcionaba; ahora usa `rn::integer`, misma lógica. Y `trg_recompute_pet_streak_fn()` ya no recalcula al borrar un registro si la mascota ya no existe (borrado en cascada): reinsertaba `pet_streaks` de una mascota borrada y violaba su FK, así que borrar una mascota con 2+ registros fallaba.

## 17. Reminders

`pet_id`, `created_by`, `created_at` inmutables tras la creación (misma doble protección que `daily_logs`). `status`/`completed_at` se mantienen coherentes automáticamente vía trigger: `status='completed'` sin `completed_at` se autocompleta con `now()`; cualquier otro estado limpia `completed_at`. `attachment_path` se valida contra el `pet_id` del propio recordatorio (no se puede referenciar el archivo de otra mascota). `recurrence_rule` solo tiene una validación de formato básica en SQL — el parser RRULE completo vive en el backend.

## 18. Storage

Los 4 buckets (`pet-photos`, `reminder-attachments`, `shared-reports`, `avatars`) son **privados**. Nunca se persisten URLs, solo `*_path` — las URLs firmadas se generan bajo demanda (`createSignedUrl`). Convención de rutas: `{pet_id}/{object_uuid}` para los 3 buckets de mascota, `{user_id}/{object_uuid}` para avatars. Las policies validan el formato del path con `safe_pet_id_from_path()` antes de castear a UUID, en vez de castear directamente y arriesgarse a un error de tipo. Ningún bucket concede `UPDATE` (se borra y se vuelve a subir si hace falta reemplazar un archivo).

> Corrección posterior (migración `20261007182429_grant_safe_pet_id_from_path.sql`): las policies se evalúan con el rol `authenticated`, que necesita `EXECUTE` sobre `safe_pet_id_from_path()`; el diseño original se lo revocaba y ninguna operación en los buckets de mascota podía funcionar. La función solo interpreta el texto del path.

## 19. RevenueCat

`subscription_events.provider_event_id UNIQUE` + `process_revenuecat_event()` (una sola función = una sola transacción: comprobar idempotencia, registrar el evento y actualizar `subscriptions`, todo o nada). Un mismo evento recibido dos veces es un no-op la segunda vez. `subscriptions.provider_subscription_id` tiene un índice único parcial (ignorando `NULL`): una misma suscripción de RevenueCat no puede quedar asociada a dos usuarios. No se ha añadido una columna `received_at` separada de `occurred_at` — decisión explícita, no necesaria para el MVP (ver `CHANGELOG_v2.2.md`).

## 20. Organizations

Solo preparación (`organizations`, `organization_members`), sin recursión de RLS (`is_org_member()`). Sin portal, sin alta desde la app, sin vínculo desde `pets`, sin billing empresarial. Nada de esto bloquea el MVP ni añade complejidad al frontend actual.

## 20.1 Push tokens — ciclo de vida (nuevo en v2.2.1)

`push_tokens.token` es `UNIQUE` a nivel global (es un identificador físico de dispositivo/instalación, no algo propio de una sola cuenta). Esto genera un caso concreto a resolver: el mismo dispositivo puede tener sesiones de distintos usuarios a lo largo del tiempo (usuario A cierra sesión, usuario B entra en el mismo teléfono).

- **login / app launch:** llamar siempre a `rpc('register_push_token', { token, platform, device_id, app_version, os_version })`. Es un upsert que reasigna el token al `auth.uid()` actual sin importar a quién perteneciera antes — seguro porque el token lo emite el sistema operativo/servicio de push para ESE dispositivo, no es un secreto de otro usuario.
- **token refresh** (el SO puede rotar el token): volver a llamar a `register_push_token` con el nuevo valor.
- **logout:** recomendado (no obligatorio) borrar la fila propia (`delete from push_tokens where token = ...`, permitido por la policy `manage own`) antes de cerrar sesión, como buena práctica — pero `register_push_token` cubre el caso igualmente aunque esto falle (cierre sin red, cierre forzado de la app).
- **cambio de usuario en el mismo dispositivo:** no requiere lógica especial más allá de repetir el paso de login — `register_push_token` ya reasigna correctamente.

No se creó ninguna tabla nueva ni se cambió la restricción `UNIQUE(token)`.

## 20.2 Storage — semántica de paths por campo (aclarado en v2.2.1)

| Columna | Bucket | Convención de ruta |
|---|---|---|
| `pets.photo_path` | `pet-photos` | `{pet_id}/{object_uuid}.{ext}` |
| `ai_analysis_requests.photo_path` | `pet-photos` (mismo bucket que arriba) | `{pet_id}/{object_uuid}.{ext}` |
| `reminders.attachment_path` | `reminder-attachments` | `{pet_id}/{object_uuid}.{ext}` |
| `pet_shared_reports.file_path` | `shared-reports` | `{pet_id}/{object_uuid}.pdf` |
| `profiles.avatar_path` | `avatars` | `{user_id}/{object_uuid}.{ext}` |

El bucket nunca viaja como parámetro desde el cliente — cada Edge Function y cada policy de Storage tiene su bucket fijo hardcodeado (ver `edge-functions/generate-pet-report/index.ts` para el caso más explícito: `const REPORTS_BUCKET = 'shared-reports'`). Los paths guardados en columnas `*_path` son siempre internos, nunca una URL — ni pública ni firmada. Las URLs firmadas se generan bajo demanda en el momento de mostrarlas (`createSignedUrl`), nunca se persisten.

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
- Las implementaciones de `callAiProvider()` (en `ai-analysis-process`) y `generatePdf()` (en `generate-pet-report`) son contratos definidos, pendientes de la integración real con el proveedor de IA y la librería de generación de PDF respectivamente — fuera de alcance de una revisión de arquitectura de base de datos.
- Ver `CHANGELOG_v2.2.1.md` y `CHANGELOG_v2.2.md` para el historial completo de decisiones.
