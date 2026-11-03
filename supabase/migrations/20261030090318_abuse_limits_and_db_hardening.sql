-- =====================================================================
-- KITOM · Límites de abuso, longitudes, rendimiento y limpieza programada
-- (segunda migración de endurecimiento, antes de la primera versión en Google Play)
-- =====================================================================
-- Hallazgos de docs/SECURITY_AUDIT.md y docs/DATABASE.md que corrige:
--  SEC-06/SEC-21  request_ai_analysis (misma firma y mensajes): como mucho
--          1 solicitud por usuario cada 60 s (hint ai_rate_limited) y, con 3
--          análisis fallidos en el día UTC, ninguno más ese día (hint
--          ai_failure_limit). Se cuenta en el registro privado
--          private.ai_analysis_usage, que sobrevive al borrado de la mascota.
--          Un fallo sigue sin gastar cupo mensual. No cuenta como fallo
--          `ai_misconfigured` (clave o proveedor mal configurados: el proveedor
--          no cobra y la culpa no es del usuario).
--  SEC-04  invite_pet_member_by_email: 20 intentos por propietario en 24 h
--          (ventana móvil; hint invite_rate_limited), contados en
--          private.pet_invitation_attempts (sin el email: también cuentan los
--          que no tienen cuenta). get_pet_members y la política SELECT de
--          pet_co_owners ya no muestran a los demás miembros quién es una
--          persona invitada (user_id y nombre) hasta que acepta.
--          Riesgo residual: la fila pendiente sigue apareciendo solo si el
--          email tiene cuenta (el límite lo acota, no lo elimina).
--  SEC-18  CHECK de longitud en los textos de usuario que no la tenían
--          (límites ≥ los de la app; la migración aborta sin cambios si alguna
--          fila no cumple). handle_new_user recorta el nombre que llega de
--          Google para que el registro nunca falle por el CHECK.
--  SEC-16  claim_ai_analysis_for_processing anota processing_started_at (la
--          Edge Function calcula la caducidad desde el reclamo).
--  Rendimiento (advisors de Supabase, docs/DATABASE.md §6): auth.uid() y
--          auth.role() envueltos en (select …) en las 22 políticas señaladas
--          (mismos nombres y semántica, salvo pet_co_owners por SEC-04),
--          is_pet_member/can_edit_pet STABLE y un índice para cada una de las
--          12 claves foráneas sin índice.
--  P1-04   pg_cron + pg_net y dos tareas que llaman a la Edge Function
--          pet-storage-cleanup. Leen la URL y el secreto de Vault
--          (kitom_project_url, pet_storage_cleanup_secret): sin ellos no hacen
--          nada (ni error). Ningún secreto en esta migración.
--
-- Contrato: sin cambios de firmas de funciones (los tipos generados no
-- cambian salvo la columna nueva ai_analysis_requests.processing_started_at).
-- Mensajes anteriores intactos; hints nuevos: ai_rate_limited,
-- ai_failure_limit, invite_rate_limited, ai_feedback_too_long.
-- Invariantes que se mantienen: entitlement siempre de auth.uid(); cupo por
-- usuario y mes; un análisis fallido no gasta cupo; feedback solo de
-- requested_by.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Datos existentes frente a los límites nuevos (SEC-18)
-- ---------------------------------------------------------------------
-- Antes de cambiar nada: si alguna fila supera un límite, la migración aborta
-- sin cambios (no recorta datos). Consulta de revisión, de solo lectura:
--   select 'pets' t, id from public.pets where char_length(name) > 100
--     or char_length(breed) > 100 or char_length(temperament_notes) > 2000
--     or cardinality(known_conditions) > 100 or cardinality(allergies) > 100
--     or exists (select 1 from unnest(known_conditions || allergies) x where char_length(x) > 200)
--   union all select 'profiles', id from public.profiles where char_length(full_name) > 200
--   union all select 'reminders', id from public.reminders
--     where char_length(title) > 200 or char_length(description) > 2000
--   union all select 'ai_analysis_requests', id from public.ai_analysis_requests
--     where char_length(feedback_comment) > 1000
--   union all select 'analytics_events', id from public.analytics_events
--     where char_length(event_name) > 100 or octet_length(properties::text) > 8192;
do $$
declare
  incompatible bigint;
begin
  select
    (select count(*) from public.pets
     where char_length(name) > 100
        or char_length(breed) > 100
        or char_length(temperament_notes) > 2000
        or cardinality(known_conditions) > 100
        or cardinality(allergies) > 100
        or exists (select 1 from unnest(known_conditions) x where char_length(x) > 200)
        or exists (select 1 from unnest(allergies) x where char_length(x) > 200))
  + (select count(*) from public.profiles where char_length(full_name) > 200)
  + (select count(*) from public.reminders
     where char_length(title) > 200 or char_length(description) > 2000)
  + (select count(*) from public.ai_analysis_requests where char_length(feedback_comment) > 1000)
  + (select count(*) from public.analytics_events
     where char_length(event_name) > 100 or octet_length(properties::text) > 8192)
  into incompatible;

  if incompatible > 0 then
    raise exception 'Límites de longitud: % fila(s) los superan; revisarlas (consulta en la cabecera) antes de aplicar esta migración', incompatible
      using hint = 'text_length_incompatible_rows';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 1. Límites de IA (SEC-06, SEC-21)
-- ---------------------------------------------------------------------
-- failed_at: cuándo pasó la solicitud a `failed` (NULL si no ha fallado).
-- failure_code: el error_message con el que falló (solo códigos de la Edge
-- Function, recortado a 64), para no contar `ai_misconfigured`.
alter table private.ai_analysis_usage
  add column failed_at    timestamptz,
  add column failure_code text;

comment on column private.ai_analysis_usage.failed_at is
  'Momento en que la solicitud pasó a failed (NULL si no ha fallado). Fuente del límite diario de fallos.';
comment on column private.ai_analysis_usage.failure_code is
  'Código de error de la Edge Function (error_message, ≤ 64). ai_misconfigured no cuenta para el límite diario.';

-- Fallos anteriores: la hora real del fallo no se guardaba; se usa la de la solicitud.
update private.ai_analysis_usage u
set failed_at = u.created_at,
    failure_code = left(r.error_message, 64)
from public.ai_analysis_requests r
where r.id = u.analysis_id and r.status = 'failed';

update private.ai_analysis_usage
set failed_at = created_at
where not counts and failed_at is null;

create index ai_analysis_usage_user_failed_idx
  on private.ai_analysis_usage (user_id, failed_at)
  where failed_at is not null;

-- El trigger que sigue al estado anota también el fallo.
create or replace function public.sync_ai_analysis_usage()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $function$
begin
  update private.ai_analysis_usage
  set counts = (new.status <> 'failed'),
      failed_at = case when new.status = 'failed' then coalesce(failed_at, now()) end,
      failure_code = case when new.status = 'failed' then left(new.error_message, 64) end
  where analysis_id = new.id;
  return null;
end;
$function$;

revoke all on function public.sync_ai_analysis_usage() from public, anon, authenticated;

-- SEC-16: hora del reclamo, para calcular la caducidad desde ahí.
alter table public.ai_analysis_requests
  add column processing_started_at timestamptz;

comment on column public.ai_analysis_requests.processing_started_at is
  'Cuándo reclamó la Edge Function el análisis (claim_ai_analysis_for_processing). La caducidad de processing se calcula desde aquí.';

create or replace function public.claim_ai_analysis_for_processing (
  target_analysis_id uuid
)
  returns boolean
  language plpgsql
  security definer
  set search_path to 'public'
  as $function$
declare
  affected integer;
begin
  update public.ai_analysis_requests
  set status = 'processing',
      processing_started_at = now()
  where id = target_analysis_id and status = 'pending';

  get diagnostics affected = row_count;
  return affected > 0;
end;
$function$;

revoke all on function public.claim_ai_analysis_for_processing(uuid) from public, anon, authenticated;

create or replace function public.request_ai_analysis (
  target_pet_id uuid,
  p_photo_path  text,
  symptom_ids   uuid[] default '{}'::uuid[]
)
  returns uuid
  language plpgsql
  security definer
  set search_path to 'public'
  as $function$
declare
  pet_row public.pets%rowtype;
  entitlement record;
  sid uuid;
  compatible boolean;
  new_request_id uuid;
  failures_today integer;
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using hint = 'not_authenticated';
  end if;

  -- 0) Aviso veterinario aceptado por quien pide (PRD §13), no solo en la app.
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and disclaimer_accepted_at is not null
  ) then
    raise exception 'Debes aceptar el aviso veterinario antes de pedir una orientación'
      using hint = 'ai_disclaimer_required';
  end if;

  -- 1) Acceso a la mascota
  if not public.can_edit_pet(target_pet_id) then
    raise exception 'No tienes acceso de edición sobre esta mascota' using hint = 'ai_not_allowed';
  end if;

  select * into pet_row from public.pets where id = target_pet_id;
  if not found or not pet_row.is_active then
    raise exception 'Mascota no encontrada o archivada' using hint = 'ai_pet_unavailable';
  end if;

  -- 2) La foto (si la hay) debe pertenecer a esta mascota
  if p_photo_path is not null then
    if public.safe_pet_id_from_path(p_photo_path) is distinct from target_pet_id then
      raise exception 'photo_path no corresponde a esta mascota' using hint = 'ai_invalid_photo';
    end if;
  end if;

  -- 3) Cada síntoma debe ser compatible con la especie del animal
  foreach sid in array symptom_ids loop
    select exists (
      select 1 from public.symptom_species ss
      where ss.symptom_id = sid and ss.species_id = pet_row.species_id
    ) into compatible;
    if not compatible then
      raise exception 'El síntoma % no es compatible con la especie de esta mascota', sid
        using hint = 'ai_invalid_symptoms';
    end if;
  end loop;

  -- 4) Cupo y límites del SOLICITANTE, con bloqueo por usuario para que dos
  --    dispositivos no gasten el mismo cupo ni salten el límite a la vez.
  perform pg_advisory_xact_lock(hashtext('ai_quota:' || auth.uid()::text)::bigint);

  select * into entitlement from public.get_ai_analysis_entitlement();

  if not entitlement.can_request then
    raise exception 'Has alcanzado tu límite mensual de análisis de IA (% de %)', entitlement.monthly_used, entitlement.monthly_limit
      using hint = 'ai_quota_exceeded';
  end if;

  -- 4b) Fallos del día UTC (SEC-06): con 3, ninguno más hasta mañana.
  select count(*) into failures_today
  from private.ai_analysis_usage u
  where u.user_id = auth.uid()
    and u.failed_at >= date_trunc('day', now(), 'UTC')
    and u.failure_code is distinct from 'ai_misconfigured';

  if failures_today >= 3 then
    raise exception 'Hoy no se han podido completar varias orientaciones seguidas; vuelve a intentarlo mañana'
      using hint = 'ai_failure_limit';
  end if;

  -- 4c) Frecuencia (SEC-21): una solicitud por minuto.
  if exists (
    select 1 from private.ai_analysis_usage u
    where u.user_id = auth.uid()
      and u.created_at > now() - interval '60 seconds'
  ) then
    raise exception 'Espera un minuto antes de pedir otra orientación'
      using hint = 'ai_rate_limited';
  end if;

  -- 5) Crear la solicitud. used_full_history lo decide el backend.
  insert into public.ai_analysis_requests (pet_id, requested_by, photo_path, used_full_history, status)
  values (target_pet_id, auth.uid(), p_photo_path, entitlement.would_use_full_history, 'pending')
  returning id into new_request_id;

  -- 5b) Registro de uso: sobrevive al borrado de la mascota (SEC-01).
  insert into private.ai_analysis_usage (analysis_id, user_id)
  values (new_request_id, auth.uid());

  foreach sid in array symptom_ids loop
    insert into public.ai_analysis_symptoms (analysis_id, symptom_id) values (new_request_id, sid);
  end loop;

  -- 6) Logro "primer análisis con IA".
  perform public.award_pet_achievement(target_pet_id, 'first_photo_scan');

  return new_request_id;
end;
$function$;

revoke all on function public.request_ai_analysis(uuid, text, uuid[]) from public, anon;
grant execute on function public.request_ai_analysis(uuid, text, uuid[]) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. Invitaciones: límite de frecuencia y sin identidad hasta aceptar (SEC-04)
-- ---------------------------------------------------------------------
-- Solo quién y cuándo (nunca el email). Sin FK a pets: borrar la mascota no
-- devuelve intentos. Se purga sola (filas de más de 2 días del mismo usuario).
create table private.pet_invitation_attempts (
  id         bigint      generated always as identity primary key,
  inviter_id uuid        not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table private.pet_invitation_attempts is
  'Un intento de invitación por email que pasó las comprobaciones de propiedad y formato, exista o no la cuenta. Fuente del límite de 20 por propietario en 24 h.';

create index pet_invitation_attempts_inviter_idx
  on private.pet_invitation_attempts (inviter_id, created_at);

alter table private.pet_invitation_attempts enable row level security;
revoke all on table private.pet_invitation_attempts from public, anon, authenticated, service_role;

create or replace function public.invite_pet_member_by_email(
  target_pet_id uuid,
  invitee_email text,
  initial_role  public.co_owner_role default 'viewer'::public.co_owner_role
)
  returns void
  language plpgsql
  security definer
  set search_path to 'public'
  as $function$
declare
  normalized text := lower(trim(coalesce(invitee_email, '')));
  invitee uuid;
  recent_attempts integer;
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using hint = 'not_authenticated';
  end if;

  -- La propiedad, antes de mirar el email: quien no es el propietario no
  -- puede usar esta función para saber si un email tiene cuenta.
  if not exists (
    select 1 from public.pets
    where id = target_pet_id and owner_id = auth.uid() and is_active
  ) then
    raise exception 'Solo el propietario principal puede invitar co-tutores' using hint = 'not_pet_owner';
  end if;

  if normalized = '' or length(normalized) > 320 or position('@' in normalized) < 2 then
    raise exception 'Email no válido' using hint = 'invalid_email';
  end if;

  -- Límite de frecuencia (SEC-04): 20 intentos en 24 h por propietario, con
  -- cuenta o sin ella. El bloqueo por usuario evita pasarlo con llamadas a la vez.
  perform pg_advisory_xact_lock(hashtext('pet_invite:' || auth.uid()::text)::bigint);

  delete from private.pet_invitation_attempts
  where inviter_id = auth.uid() and created_at < now() - interval '2 days';

  select count(*) into recent_attempts
  from private.pet_invitation_attempts
  where inviter_id = auth.uid() and created_at > now() - interval '24 hours';

  if recent_attempts >= 20 then
    raise exception 'Has enviado demasiadas invitaciones. Vuelve a intentarlo mañana'
      using hint = 'invite_rate_limited';
  end if;

  insert into private.pet_invitation_attempts (inviter_id) values (auth.uid());

  -- Solo una cuenta que ha demostrado ser dueña del email: confirmado, no
  -- baneada, no borrada y no anónima. Si no, como si no existiera.
  select u.id into invitee
  from auth.users u
  where lower(u.email) = normalized
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and (u.banned_until is null or u.banned_until <= now())
    and not coalesce(u.is_anonymous, false);

  -- Sin cuenta válida o el propio usuario: misma respuesta que una invitación enviada.
  if invitee is null or invitee = auth.uid() then
    return;
  end if;

  begin
    perform public.invite_pet_member(target_pet_id, invitee, initial_role);
  exception when raise_exception then
    -- Ya hay una invitación pendiente o aceptada: misma respuesta.
    return;
  end;
end;
$function$;

revoke all on function public.invite_pet_member_by_email(uuid, text, public.co_owner_role) from public, anon;
grant execute on function public.invite_pet_member_by_email(uuid, text, public.co_owner_role) to authenticated;

-- Una invitación pendiente no muestra quién es (user_id ni nombre) más que a
-- la propia persona invitada; al aceptar, se ve como siempre.
create or replace function public.get_pet_members(target_pet_id uuid)
  returns table (
    invitation_id uuid,
    user_id       uuid,
    full_name     text,
    role          public.co_owner_role,
    status        public.co_owner_status,
    invited_at    timestamptz,
    accepted_at   timestamptz
  )
  language plpgsql
  stable
  security definer
  set search_path to 'public'
  as $function$
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using hint = 'not_authenticated';
  end if;
  if not public.is_pet_member(target_pet_id) then
    raise exception 'No tienes acceso a esta mascota' using hint = 'not_pet_member';
  end if;

  return query
    select co.id,
           case when co.status = 'accepted' or co.user_id = auth.uid() then co.user_id end,
           case when co.status = 'accepted' or co.user_id = auth.uid() then pr.full_name end,
           co.role, co.status, co.invited_at, co.accepted_at
    from public.pet_co_owners co
    left join public.profiles pr on pr.id = co.user_id
    where co.pet_id = target_pet_id
      and co.status in ('pending', 'accepted')
    order by co.invited_at;
end;
$function$;

comment on function public.get_pet_members(uuid) is
  'Co-tutores pendientes y aceptados de una mascota. user_id y full_name son NULL en las invitaciones pendientes (salvo para la propia persona invitada). Solo para miembros de la mascota.';

revoke all on function public.get_pet_members(uuid) from public, anon;
grant execute on function public.get_pet_members(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Longitudes máximas (SEC-18)
-- ---------------------------------------------------------------------
-- Límites ≥ los de la app (pets.name y breed 40 → 100; listas: campo de 200
-- caracteres → ≤ 100 elementos de ≤ 200; temperament_notes 2000 = el de la app;
-- profiles.full_name 60 → 200; reminders 80/500 → 200/2000).
-- Las listas necesitan una función (un CHECK no admite subconsultas). Quien
-- escribe necesita EXECUTE sobre ella al evaluarse el CHECK; no hay USAGE del
-- esquema private, así que no se puede llamar por nombre.
create or replace function private.text_array_within(items text[], max_items integer, max_item_length integer)
  returns boolean
  language sql
  immutable
  set search_path = ''
  as $function$
  select items is null
      or (cardinality(items) <= max_items
          and not exists (select 1 from unnest(items) as x (item) where char_length(x.item) > max_item_length));
$function$;

comment on function private.text_array_within(text[], integer, integer) is
  'CHECK de listas de texto: como mucho max_items elementos de como mucho max_item_length caracteres.';

revoke all on function private.text_array_within(text[], integer, integer) from public, anon, authenticated, service_role;
grant execute on function private.text_array_within(text[], integer, integer) to authenticated, service_role;

alter table public.pets
  add constraint pets_name_length_check check (char_length(name) <= 100),
  add constraint pets_breed_length_check check (char_length(breed) <= 100),
  add constraint pets_temperament_notes_length_check check (char_length(temperament_notes) <= 2000),
  add constraint pets_known_conditions_length_check check (private.text_array_within(known_conditions, 100, 200)),
  add constraint pets_allergies_length_check check (private.text_array_within(allergies, 100, 200));

alter table public.profiles
  add constraint profiles_full_name_length_check check (char_length(full_name) <= 200);

alter table public.reminders
  add constraint reminders_title_length_check check (char_length(title) <= 200),
  add constraint reminders_description_length_check check (char_length(description) <= 2000);

alter table public.ai_analysis_requests
  add constraint ai_analysis_requests_feedback_comment_length_check check (char_length(feedback_comment) <= 1000);

alter table public.analytics_events
  add constraint analytics_events_event_name_length_check check (char_length(event_name) <= 100),
  add constraint analytics_events_properties_size_check check (octet_length(properties::text) <= 8192);

-- El nombre que llega de Google (raw_user_meta_data) se recorta: el registro
-- nunca debe fallar por el CHECK de profiles.full_name.
create or replace function public.handle_new_user()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
  as $function$
begin
  insert into public.profiles (id, full_name, external_avatar_url)
  values (new.id, left(new.raw_user_meta_data->>'full_name', 200), new.raw_user_meta_data->>'avatar_url')
  on conflict (id) do nothing;

  insert into public.notification_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  insert into public.subscriptions (user_id, plan, status)
  values (new.id, 'free', 'active')
  on conflict (user_id) do nothing;

  return new;
end;
$function$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

-- feedback_comment: el mismo límite que el CHECK, con un hint estable.
create or replace function public.submit_ai_feedback (
  target_analysis_id   uuid,
  new_feedback         public.feedback_value,
  new_feedback_comment text                  default null::text
)
  returns void
  language plpgsql
  security definer
  set search_path to 'public'
  as $function$
declare
  req public.ai_analysis_requests%rowtype;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  if char_length(new_feedback_comment) > 1000 then
    raise exception 'El comentario no puede superar los 1000 caracteres' using hint = 'ai_feedback_too_long';
  end if;

  select * into req from public.ai_analysis_requests where id = target_analysis_id;
  if not found then
    raise exception 'Análisis no encontrado';
  end if;

  -- Punto 3: el feedback pertenece a quien SOLICITÓ el análisis, no a
  -- cualquier miembro con acceso a la mascota.
  if req.requested_by is distinct from auth.uid() then
    raise exception 'Solo el usuario que solicitó el análisis puede enviar o modificar su feedback';
  end if;

  update public.ai_analysis_requests
  set feedback = new_feedback,
      feedback_comment = new_feedback_comment
  where id = target_analysis_id;
end;
$function$;

revoke all on function public.submit_ai_feedback(uuid, public.feedback_value, text) from public, anon;
grant execute on function public.submit_ai_feedback(uuid, public.feedback_value, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Rendimiento de RLS (advisors: auth_rls_initplan, funciones, FK)
-- ---------------------------------------------------------------------
-- (select auth.uid()) se evalúa una vez por consulta (initPlan) y no por fila.
-- ALTER POLICY conserva nombre, comando y roles; mismas expresiones.
alter policy "achievements_catalog: select authenticated" on public.achievements_catalog
  using ((select auth.role()) = 'authenticated'::text);
alter policy "analytics_events: insert own" on public.analytics_events
  with check (user_id = (select auth.uid()));
alter policy "breeds: select authenticated" on public.breeds
  using ((select auth.role()) = 'authenticated'::text);
alter policy "catalog_translations: select authenticated" on public.catalog_translations
  using ((select auth.role()) = 'authenticated'::text);
alter policy "clinic_referrals: select own" on public.clinic_referrals
  using (user_id = (select auth.uid()));
alter policy "daily_logs: insert editors" on public.daily_logs
  with check (public.can_edit_pet(pet_id) and logged_by = (select auth.uid()));
alter policy "notif_prefs: manage own" on public.notification_preferences
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
alter policy "pets: delete owner" on public.pets
  using (owner_id = (select auth.uid()));
alter policy "pets: insert own" on public.pets
  with check (owner_id = (select auth.uid()));
alter policy "pets: select members" on public.pets
  using (owner_id = (select auth.uid()) or public.is_pet_member(id));
alter policy "profiles: insert own" on public.profiles
  with check (id = (select auth.uid()));
alter policy "profiles: select own" on public.profiles
  using (id = (select auth.uid()));
alter policy "profiles: update own" on public.profiles
  using (id = (select auth.uid()));
alter policy "push_tokens: manage own" on public.push_tokens
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
alter policy "reminders: insert editors" on public.reminders
  with check (public.can_edit_pet(pet_id) and created_by = (select auth.uid()));
alter policy "species: select authenticated" on public.species
  using ((select auth.role()) = 'authenticated'::text);
alter policy "subscription_events: select own" on public.subscription_events
  using (exists (
    select 1 from public.subscriptions s
    where s.id = subscription_events.subscription_id and s.user_id = (select auth.uid())
  ));
alter policy "subscriptions: select own" on public.subscriptions
  using (user_id = (select auth.uid()));
alter policy "symptom_species: select authenticated" on public.symptom_species
  using ((select auth.role()) = 'authenticated'::text);
alter policy "symptoms: select authenticated" on public.symptoms_catalog
  using ((select auth.role()) = 'authenticated'::text);
alter policy "vet_clinics: select authenticated" on public.vet_clinics
  using ((select auth.role()) = 'authenticated'::text);

-- La 22.ª cambia de semántica a propósito (SEC-04): antes cualquier miembro
-- leía todas las filas de la mascota (también el user_id de una invitación
-- pendiente, rechazada o revocada). Ahora: la propia fila siempre, y las de
-- los demás solo si están aceptadas. La app no lee esta tabla directamente
-- (usa get_pet_members y get_my_pet_invitations, SECURITY DEFINER).
alter policy "co_owners: select members or self" on public.pet_co_owners
  using (user_id = (select auth.uid()) or (status = 'accepted' and public.is_pet_member(pet_id)));

-- Solo leen: STABLE (se mantienen SECURITY DEFINER y search_path).
alter function public.is_pet_member(uuid) stable;
alter function public.can_edit_pet(uuid) stable;

-- Índices para las claves foráneas sin índice (borrados en cascada y joins).
create index idx_ai_analysis_symptoms_symptom on public.ai_analysis_symptoms (symptom_id);
create index idx_analytics_events_user on public.analytics_events (user_id);
create index idx_clinic_referrals_user on public.clinic_referrals (user_id);
create index idx_daily_logs_last_edited_by on public.daily_logs (last_edited_by);
create index idx_pet_achievements_achievement on public.pet_achievements (achievement_id);
create index idx_co_owners_invited_by on public.pet_co_owners (invited_by);
create index idx_shared_reports_generated_by on public.pet_shared_reports (generated_by);
create index idx_shared_reports_pet on public.pet_shared_reports (pet_id);
create index idx_pets_breed_species on public.pets (breed_id, species_id);
create index idx_push_tokens_user on public.push_tokens (user_id);
create index idx_reminders_created_by on public.reminders (created_by);
create index idx_symptom_species_species on public.symptom_species (species_id);

-- ---------------------------------------------------------------------
-- 5. Limpieza de Storage programada (ROADMAP P1-04)
-- ---------------------------------------------------------------------
-- Esquemas que indica Supabase: pg_cron en pg_catalog (crea el esquema cron) y
-- pg_net en extensions (crea el esquema net).
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Llama a la Edge Function pet-storage-cleanup con su secreto. La URL del
-- proyecto y el secreto se leen de Vault por nombre (los crea el usuario; nunca
-- en el repo): kitom_project_url y pet_storage_cleanup_secret (≥ 32
-- caracteres, el mismo valor que PET_STORAGE_CLEANUP_SECRET). Si falta Vault,
-- pg_net o cualquiera de los dos, no hace nada y devuelve NULL (sin error: la
-- tarea programada no llena el historial de fallos). Devuelve el id de la
-- petición de pg_net (asíncrona). La ejecuta pg_cron como postgres; nadie más.
create or replace function private.invoke_pet_storage_cleanup(p_task text default 'process')
  returns bigint
  language plpgsql
  security invoker
  set search_path = ''
  as $function$
declare
  project_url text;
  cleanup_secret text;
begin
  if p_task is null or p_task not in ('process', 'audit') then
    raise exception 'Tarea no válida: %', p_task using hint = 'pet_storage_cleanup_invalid_task';
  end if;

  if to_regclass('vault.decrypted_secrets') is null
     or to_regprocedure('net.http_post(text, jsonb, jsonb, jsonb, integer)') is null then
    return null;
  end if;

  select s.decrypted_secret into project_url
  from vault.decrypted_secrets s where s.name = 'kitom_project_url';
  select s.decrypted_secret into cleanup_secret
  from vault.decrypted_secrets s where s.name = 'pet_storage_cleanup_secret';

  project_url := rtrim(btrim(project_url), '/');
  if project_url is null or project_url !~ '^https?://[^/[:space:]]+$'
     or cleanup_secret is null or char_length(cleanup_secret) < 32 then
    return null;
  end if;

  return net.http_post(
    url := project_url || '/functions/v1/pet-storage-cleanup',
    body := jsonb_build_object('task', p_task),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-kitom-cleanup-secret', cleanup_secret),
    timeout_milliseconds := 60000);
end;
$function$;

comment on function private.invoke_pet_storage_cleanup(text) is
  'Tarea programada: POST a la Edge Function pet-storage-cleanup con la URL y el secreto de Vault (kitom_project_url, pet_storage_cleanup_secret). Sin ellos no hace nada.';

revoke all on function private.invoke_pet_storage_cleanup(text) from public, anon, authenticated, service_role;

-- cron.schedule con nombre sustituye la tarea si ya existe (idempotente).
-- Cada 30 min procesa trabajos; una vez al día, auditoría (y en modo borrado,
-- retención). Qué borra lo decide la función (modo informe salvo
-- PET_STORAGE_CLEANUP_MODE=delete).
select cron.schedule(
  'kitom-pet-storage-cleanup',
  '*/30 * * * *',
  $$select private.invoke_pet_storage_cleanup('process')$$
);
select cron.schedule(
  'kitom-pet-storage-cleanup-audit',
  '17 4 * * *',
  $$select private.invoke_pet_storage_cleanup('audit')$$
);
