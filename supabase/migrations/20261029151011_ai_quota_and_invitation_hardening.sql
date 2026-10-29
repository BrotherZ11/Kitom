-- =====================================================================
-- KITOM · Cupo de IA a prueba de borrados y endurecimiento (auditoría 2026-10-29)
-- =====================================================================
-- Hallazgos de docs/SECURITY_AUDIT.md que corrige:
--  SEC-01  El cupo mensual contaba filas de ai_analysis_requests, que se
--          borran en cascada con la mascota: borrar y recrear la mascota
--          devolvía el cupo. Ahora cuenta un registro de uso privado, sin
--          FK a pets: private.ai_analysis_usage (una fila por solicitud;
--          `counts` = la solicitud no ha fallado, que sigue sin gastar cupo).
--  SEC-10  request_ai_analysis exige el aviso veterinario aceptado
--          (profiles.disclaimer_accepted_at), no solo la app.
--  SEC-05  invite_pet_member_by_email solo encuentra cuentas con el email
--          confirmado, no baneadas, no borradas y no anónimas.
--  SEC-11  Sin TRUNCATE, TRIGGER, REFERENCES ni MAINTAIN para anon y
--          authenticated en las tablas de public (tampoco en las futuras).
--  SEC-12  trigger_set_timestamp con search_path fijo.
--  SEC-07  Bucket pet-photos: 5 MB y solo image/jpeg (la app siempre sube
--          JPEG ≤ 5 MB: PET_PHOTO_MAX_UPLOAD_BYTES). Si el bucket no
--          existe (local sin `seed buckets`), no hace nada.
--
-- Contrato: request_ai_analysis conserva firma y mensajes y añade `hint`
-- estables (ai_disclaimer_required, ai_not_allowed, ai_pet_unavailable,
-- ai_invalid_photo, ai_invalid_symptoms, ai_quota_exceeded); las versiones
-- de la app que reconocen el texto siguen funcionando. Sin cambios de
-- firmas: los tipos generados no cambian.
-- Invariantes que se mantienen: entitlement siempre de auth.uid(); cupo por
-- usuario y mes; un análisis fallido no gasta cupo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Registro de uso (SEC-01)
-- ---------------------------------------------------------------------
-- Esquema private: sin USAGE para anon ni authenticated (migración
-- 20261027194908); solo lo tocan funciones SECURITY DEFINER.
create table private.ai_analysis_usage (
  analysis_id uuid        primary key,
  user_id     uuid        not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  counts      boolean     not null default true
);

comment on table private.ai_analysis_usage is
  'Una fila por solicitud de análisis de IA. Sin FK a pets ni a ai_analysis_requests: sobrevive al borrado de la mascota. counts = la solicitud no ha fallado. Fuente del cupo mensual.';

create index ai_analysis_usage_user_month_idx on private.ai_analysis_usage (user_id, created_at);

alter table private.ai_analysis_usage enable row level security;
revoke all on table private.ai_analysis_usage from public, anon, authenticated;

-- Lo ya pedido (también lo de mascotas borradas, si quedara algo) pasa al registro.
insert into private.ai_analysis_usage (analysis_id, user_id, created_at, counts)
select r.id, r.requested_by, r.created_at, r.status <> 'failed'
from public.ai_analysis_requests r
where r.requested_by is not null
on conflict (analysis_id) do nothing;

-- El estado lo cambia la Edge Function con service_role: el registro lo sigue.
create or replace function public.sync_ai_analysis_usage()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $function$
begin
  update private.ai_analysis_usage
  set counts = (new.status <> 'failed')
  where analysis_id = new.id;
  return null;
end;
$function$;

revoke all on function public.sync_ai_analysis_usage() from public, anon, authenticated;

create trigger trg_sync_ai_analysis_usage
  after update of status on public.ai_analysis_requests
  for each row
  when (old.status is distinct from new.status)
  execute function public.sync_ai_analysis_usage();

-- ---------------------------------------------------------------------
-- 2. Cupo desde el registro
-- ---------------------------------------------------------------------
create or replace function public.get_ai_analysis_entitlement()
  returns table (
    can_request            boolean,
    would_use_full_history boolean,
    monthly_used           integer,
    monthly_limit          integer
  )
  language plpgsql
  security definer
  set search_path to 'public'
  as $function$
declare
  requester_plan subscription_plan;
  used_count integer;
  limit_count integer;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  select plan into requester_plan from public.subscriptions where user_id = auth.uid();

  select count(*) into used_count
  from private.ai_analysis_usage u
  where u.user_id = auth.uid()
    and u.counts
    and u.created_at >= date_trunc('month', now());

  limit_count := case when requester_plan = 'premium' then null else 3 end;

  return query select
    (limit_count is null or used_count < limit_count),
    -- Sin fila de suscripción, plan gratuito (antes daba NULL y la inserción fallaba).
    coalesce(requester_plan = 'premium', false),
    used_count,
    limit_count;
end;
$function$;

revoke all on function public.get_ai_analysis_entitlement() from public, anon;
grant execute on function public.get_ai_analysis_entitlement() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. request_ai_analysis: aviso obligatorio, hints y registro de uso
-- ---------------------------------------------------------------------
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

  -- 4) Cupo del SOLICITANTE, con bloqueo por usuario para que dos
  --    dispositivos no gasten el mismo cupo a la vez.
  perform pg_advisory_xact_lock(hashtext('ai_quota:' || auth.uid()::text)::bigint);

  select * into entitlement from public.get_ai_analysis_entitlement();

  if not entitlement.can_request then
    raise exception 'Has alcanzado tu límite mensual de análisis de IA (% de %)', entitlement.monthly_used, entitlement.monthly_limit
      using hint = 'ai_quota_exceeded';
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
-- 4. Invitar por email solo a cuentas confirmadas y vigentes (SEC-05)
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- 5. Privilegios de tabla sobrantes (SEC-11)
-- ---------------------------------------------------------------------
-- TRUNCATE no pasa por RLS; TRIGGER, REFERENCES y MAINTAIN no los necesita
-- ningún cliente. El DML de anon lo sigue bloqueando RLS.
revoke truncate, trigger, references, maintain on all tables in schema public from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke truncate, trigger, references, maintain on tables from anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. search_path de trigger_set_timestamp (SEC-12)
-- ---------------------------------------------------------------------
alter function public.trigger_set_timestamp() set search_path = '';

-- ---------------------------------------------------------------------
-- 7. Límites del bucket pet-photos (SEC-07)
-- ---------------------------------------------------------------------
update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg']
where id = 'pet-photos';
