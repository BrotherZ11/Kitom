-- =====================================================================
-- KITOM · Limpieza de Storage de las mascotas eliminadas (cola + RPC de servicio)
-- =====================================================================
-- Problema: borrar una mascota borra en cascada sus filas (registros,
-- consultas…) pero no sus objetos de `pet-photos/{pet_id}/…` (perfil y
-- consultas). La app no puede borrarlos después (la política DELETE exige
-- can_edit_pet, ya falso) ni antes (el borrado se puede deshacer o quedar
-- en conflicto).
--
-- Cambios (tablas, RLS y políticas existentes sin cambios):
--  1. Esquema `private` (sin USAGE para nadie más que su propietario) y la
--     cola private.pet_storage_cleanup_jobs, con RLS y sin grants.
--  2. Trigger AFTER DELETE en pets: encola en la MISMA transacción que el
--     borrado (si se revierte, no queda trabajo). Un trabajo por mascota.
--  3. RPC para la Edge Function `pet-storage-cleanup`, SECURITY DEFINER con
--     search_path vacío y EXECUTE solo para service_role:
--     pet_storage_cleanup_claim / _objects / _report (procesar),
--     _preview y _audit (solo lectura) y _purge (retención).
--
-- Reglas:
--  - Solo el bucket `pet-photos` (fijado aquí y en la función). Quedan fuera
--    `reminder-attachments` y `shared-reports`: sin uso en la app y sin
--    retención definida (docs/proposals/2026-10-26-pet-photos-cleanup.md).
--  - Los objetos de una mascota se buscan como las políticas:
--    safe_pet_id_from_path(name) = pet_id, así que entran el uuid en
--    mayúsculas o mixto y las rutas anidadas.
--  - Nunca se borra nada aquí: la función borra con la API de Storage.
--  - Un objeto que alguna fila referencia (pets.photo_path o
--    ai_analysis_requests.photo_path, sin distinguir mayúsculas) no se borra.
--  - Plazos: primer intento 15 min después del borrado; el trabajo solo se
--    da por terminado si un listado hecho 25 h o más después del borrado sale
--    vacío (una subida reanudable puede terminar hasta 24 h después de
--    empezar). Reintentos con espera exponencial (5 min … 6 h); 10 intentos
--    seguidos sin progreso → `failed` (terminal, lo revisa una persona).
--  - Reserva con FOR UPDATE SKIP LOCKED y un token por reserva; una reserva
--    caducada (locked_until) se puede volver a tomar y el token anterior deja
--    de valer.
--  - last_error guarda solo un código ([a-z_]), nunca texto libre, rutas,
--    URLs ni secretos.
--  - Retención: los trabajos `done` se borran a los 90 días (_purge); los
--    `failed` se conservan hasta que alguien los revise.
-- =====================================================================

-- 1. Esquema y cola
create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;

create table private.pet_storage_cleanup_jobs (
  id              uuid        primary key default gen_random_uuid(),
  pet_id          uuid        not null,
  deleted_at      timestamptz not null default now(),
  status          text        not null default 'pending',
  attempts        integer     not null default 0,
  next_attempt_at timestamptz not null,
  locked_until    timestamptz,
  lock_token      uuid,
  verified_at     timestamptz,
  completed_at    timestamptz,
  objects_removed integer     not null default 0,
  last_error      text,
  updated_at      timestamptz not null default now(),
  constraint pet_storage_cleanup_jobs_pet_id_key unique (pet_id),
  constraint pet_storage_cleanup_jobs_status_check check (status in ('pending', 'done', 'failed')),
  constraint pet_storage_cleanup_jobs_attempts_check check (attempts >= 0),
  constraint pet_storage_cleanup_jobs_removed_check check (objects_removed >= 0),
  constraint pet_storage_cleanup_jobs_error_check check (last_error is null or last_error ~ '^[a-z_]{1,64}$'),
  constraint pet_storage_cleanup_jobs_lock_check check ((lock_token is null) = (locked_until is null)),
  constraint pet_storage_cleanup_jobs_terminal_check check (status = 'pending' or lock_token is null),
  constraint pet_storage_cleanup_jobs_done_check check (
    (status = 'done') = (completed_at is not null) and (status <> 'done' or verified_at is not null)
  )
);

alter table private.pet_storage_cleanup_jobs enable row level security;
revoke all on table private.pet_storage_cleanup_jobs from public, anon, authenticated, service_role;

create index pet_storage_cleanup_jobs_due_idx
  on private.pet_storage_cleanup_jobs (next_attempt_at)
  where status = 'pending';

-- 2. Encolar al borrar una mascota (misma transacción)
create or replace function private.enqueue_pet_storage_cleanup()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $function$
begin
  -- Un trabajo por mascota. Si ya existía (un id reinsertado a mano y vuelto
  -- a borrar), se reabre: lo terminado deja de serlo y los plazos cuentan
  -- desde este borrado. Uno pendiente conserva su reserva, si la tiene.
  insert into private.pet_storage_cleanup_jobs (pet_id, deleted_at, next_attempt_at)
  values (old.id, now(), now() + interval '15 minutes')
  on conflict (pet_id) do update
    set deleted_at      = excluded.deleted_at,
        next_attempt_at = excluded.next_attempt_at,
        status          = 'pending',
        attempts        = case when pet_storage_cleanup_jobs.status = 'pending' then pet_storage_cleanup_jobs.attempts else 0 end,
        verified_at     = null,
        completed_at    = null,
        updated_at      = now();
  return null;
end;
$function$;

revoke all on function private.enqueue_pet_storage_cleanup() from public, anon, authenticated, service_role;

create trigger trg_pets_enqueue_storage_cleanup
  after delete on public.pets
  for each row
  execute function private.enqueue_pet_storage_cleanup();

-- 3a. Reservar un lote de trabajos vencidos
create or replace function public.pet_storage_cleanup_claim(
  p_limit        integer,
  p_lock_seconds integer
)
  returns table (job_id uuid, pet_id uuid, lock_token uuid, attempts integer, deleted_at timestamptz)
  language plpgsql
  security definer
  set search_path = ''
  as $function$
declare
  token uuid := gen_random_uuid();
begin
  if p_limit is null or p_limit < 1 or p_limit > 10
     or p_lock_seconds is null or p_lock_seconds < 60 or p_lock_seconds > 900 then
    raise exception 'pet_storage_cleanup_invalid_parameter' using errcode = '22023';
  end if;

  -- Un trabajo que agota los intentos sin llegar a informar (la ejecución
  -- cae una y otra vez) pasa a `failed` en vez de reservarse otra vez.
  update private.pet_storage_cleanup_jobs j
     set status = 'failed',
         last_error = coalesce(j.last_error, 'max_attempts'),
         lock_token = null,
         locked_until = null,
         updated_at = now()
   where j.status = 'pending'
     and j.attempts >= 10
     and (j.locked_until is null or j.locked_until <= now());

  return query
  with due as (
    select d.id
      from private.pet_storage_cleanup_jobs d
     where d.status = 'pending'
       and d.next_attempt_at <= now()
       and (d.locked_until is null or d.locked_until <= now())
     order by d.next_attempt_at, d.id
     limit p_limit
     for update skip locked
  )
  update private.pet_storage_cleanup_jobs j
     set lock_token = token,
         locked_until = now() + make_interval(secs => p_lock_seconds),
         attempts = j.attempts + 1,
         updated_at = now()
    from due
   where j.id = due.id
  returning j.id, j.pet_id, j.lock_token, j.attempts, j.deleted_at;
end;
$function$;

-- 3b. Objetos candidatos de un trabajo reservado (paginado por nombre)
create or replace function public.pet_storage_cleanup_objects(
  p_job_id     uuid,
  p_lock_token uuid,
  p_after      text,
  p_limit      integer
)
  returns table (object_bucket text, object_name text, referenced boolean)
  language plpgsql
  security definer
  set search_path = ''
  as $function$
declare
  job_pet uuid;
begin
  if p_job_id is null or p_lock_token is null or p_limit is null or p_limit < 1 or p_limit > 1000
     or (p_after is not null and length(p_after) > 1024) then
    raise exception 'pet_storage_cleanup_invalid_parameter' using errcode = '22023';
  end if;

  select j.pet_id into job_pet
    from private.pet_storage_cleanup_jobs j
   where j.id = p_job_id
     and j.status = 'pending'
     and j.lock_token = p_lock_token
     and j.locked_until > now();
  if not found then
    raise exception 'pet_storage_cleanup_lock_lost' using hint = 'pet_storage_cleanup_lock_lost';
  end if;

  if exists (select 1 from public.pets p where p.id = job_pet) then
    raise exception 'pet_storage_cleanup_pet_exists' using hint = 'pet_storage_cleanup_pet_exists';
  end if;

  return query
  select o.bucket_id::text,
         o.name::text,
         (exists (select 1 from public.pets p
                   where p.photo_path is not null and lower(p.photo_path) = lower(o.name))
          or exists (select 1 from public.ai_analysis_requests a
                      where a.photo_path is not null and lower(a.photo_path) = lower(o.name)))
    from storage.objects o
   where o.bucket_id = 'pet-photos'
     and public.safe_pet_id_from_path(o.name) = job_pet
     and (p_after is null or o.name collate "C" > p_after collate "C")
   order by o.name collate "C"
   limit p_limit;
end;
$function$;

-- 3c. Informar del resultado de una pasada (libera la reserva)
create or replace function public.pet_storage_cleanup_report(
  p_job_id     uuid,
  p_lock_token uuid,
  p_removed    integer,
  p_error      text
)
  returns text
  language plpgsql
  security definer
  set search_path = ''
  as $function$
declare
  job private.pet_storage_cleanup_jobs%rowtype;
  remaining bigint;
  effective_attempts integer;
begin
  if p_job_id is null or p_lock_token is null or p_removed is null or p_removed < 0 or p_removed > 100000
     or (p_error is not null and p_error not in (
       'object_list_failed', 'storage_remove_failed', 'object_referenced', 'invalid_object',
       'pet_exists', 'time_budget', 'unexpected')) then
    raise exception 'pet_storage_cleanup_invalid_parameter' using errcode = '22023';
  end if;

  -- El token de la reserva vale aunque haya caducado mientras nadie la vuelva
  -- a tomar; si otra ejecución la tomó, el token ya es otro.
  select * into job
    from private.pet_storage_cleanup_jobs j
   where j.id = p_job_id
   for update;
  if not found or job.status <> 'pending' or job.lock_token is distinct from p_lock_token then
    raise exception 'pet_storage_cleanup_lock_lost' using hint = 'pet_storage_cleanup_lock_lost';
  end if;

  if exists (select 1 from public.pets p where p.id = job.pet_id) then
    update private.pet_storage_cleanup_jobs
       set status = 'failed', last_error = 'pet_exists', lock_token = null, locked_until = null,
           objects_removed = objects_removed + p_removed, updated_at = now()
     where id = job.id;
    return 'failed';
  end if;

  -- La verificación es del servidor, no de quien informa.
  select count(*) into remaining
    from storage.objects o
   where o.bucket_id = 'pet-photos'
     and public.safe_pet_id_from_path(o.name) = job.pet_id;

  -- Borrar algo es progreso: los intentos cuentan pasadas seguidas sin progreso.
  effective_attempts := case when p_removed > 0 then 0 else job.attempts end;

  if p_error is null and remaining = 0 and now() >= job.deleted_at + interval '25 hours' then
    update private.pet_storage_cleanup_jobs
       set status = 'done', verified_at = now(), completed_at = now(), last_error = null,
           lock_token = null, locked_until = null, attempts = effective_attempts,
           objects_removed = objects_removed + p_removed, updated_at = now()
     where id = job.id;
    return 'done';
  end if;

  if p_error is null then
    -- Vacío pero dentro del plazo: se vuelve a comprobar al cumplirse. Con
    -- objetos aún (una subida tardía, una página que no se vio): pronto.
    update private.pet_storage_cleanup_jobs
       set next_attempt_at = case when remaining = 0 then job.deleted_at + interval '25 hours'
                                  else now() + interval '1 minute' end,
           last_error = case when remaining = 0 then null else 'objects_remaining' end,
           attempts = case when remaining = 0 then 0 else effective_attempts end,
           lock_token = null, locked_until = null,
           objects_removed = objects_removed + p_removed, updated_at = now()
     where id = job.id;
    return 'pending';
  end if;

  if effective_attempts >= 10 then
    update private.pet_storage_cleanup_jobs
       set status = 'failed', last_error = p_error, lock_token = null, locked_until = null,
           attempts = effective_attempts, objects_removed = objects_removed + p_removed, updated_at = now()
     where id = job.id;
    return 'failed';
  end if;

  update private.pet_storage_cleanup_jobs
     set next_attempt_at = now() + least(interval '6 hours',
                                         interval '5 minutes' * power(2, greatest(effective_attempts, 1) - 1)),
         last_error = p_error, lock_token = null, locked_until = null,
         attempts = effective_attempts, objects_removed = objects_removed + p_removed, updated_at = now()
   where id = job.id;
  return 'pending';
end;
$function$;

-- 3d. Modo informe: trabajos no terminados y lo que se borraría (solo lectura)
create or replace function public.pet_storage_cleanup_preview(p_limit integer)
  returns table (job_id uuid, attempts integer, due boolean, pet_exists boolean, objects bigint, referenced bigint)
  language plpgsql
  stable
  security definer
  set search_path = ''
  as $function$
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'pet_storage_cleanup_invalid_parameter' using errcode = '22023';
  end if;

  return query
  select j.id,
         j.attempts,
         (j.next_attempt_at <= now()),
         exists (select 1 from public.pets p where p.id = j.pet_id),
         count(o.name),
         count(o.name) filter (where
           exists (select 1 from public.pets p
                    where p.photo_path is not null and lower(p.photo_path) = lower(o.name))
           or exists (select 1 from public.ai_analysis_requests a
                       where a.photo_path is not null and lower(a.photo_path) = lower(o.name)))
    from private.pet_storage_cleanup_jobs j
    left join storage.objects o
      on o.bucket_id = 'pet-photos' and public.safe_pet_id_from_path(o.name) = j.pet_id
   where j.status = 'pending'
   group by j.id
   order by min(j.next_attempt_at), j.id
   limit p_limit;
end;
$function$;

-- 3e. Auditoría: carpetas de mascotas que ya no existen y su trabajo (solo lectura).
-- Detecta objetos que aparecieron después de terminar y carpetas de mascotas
-- borradas antes de esta migración (sin trabajo: no se encolan aquí).
create or replace function public.pet_storage_cleanup_audit(p_limit integer)
  returns table (folder_pet_id uuid, objects bigint, job_status text)
  language plpgsql
  stable
  security definer
  set search_path = ''
  as $function$
begin
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'pet_storage_cleanup_invalid_parameter' using errcode = '22023';
  end if;

  return query
  select f.folder_pet_id, f.objects, j.status
    from (
      select public.safe_pet_id_from_path(o.name) as folder_pet_id, count(*) as objects
        from storage.objects o
       where o.bucket_id = 'pet-photos'
       group by 1
    ) f
    left join private.pet_storage_cleanup_jobs j on j.pet_id = f.folder_pet_id
   where f.folder_pet_id is not null
     and not exists (select 1 from public.pets p where p.id = f.folder_pet_id)
   order by f.folder_pet_id
   limit p_limit;
end;
$function$;

-- 3f. Retención: los trabajos terminados se borran a los 90 días
create or replace function public.pet_storage_cleanup_purge()
  returns integer
  language plpgsql
  security definer
  set search_path = ''
  as $function$
declare
  purged integer;
begin
  delete from private.pet_storage_cleanup_jobs j
   where j.status = 'done' and j.completed_at < now() - interval '90 days';
  get diagnostics purged = row_count;
  return purged;
end;
$function$;

-- Solo service_role (la Edge Function). Supabase concede EXECUTE por defecto
-- a anon y authenticated en public: se revoca explícitamente.
revoke all on function public.pet_storage_cleanup_claim(integer, integer) from public, anon, authenticated;
revoke all on function public.pet_storage_cleanup_objects(uuid, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.pet_storage_cleanup_report(uuid, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.pet_storage_cleanup_preview(integer) from public, anon, authenticated;
revoke all on function public.pet_storage_cleanup_audit(integer) from public, anon, authenticated;
revoke all on function public.pet_storage_cleanup_purge() from public, anon, authenticated;

grant execute on function public.pet_storage_cleanup_claim(integer, integer) to service_role;
grant execute on function public.pet_storage_cleanup_objects(uuid, uuid, text, integer) to service_role;
grant execute on function public.pet_storage_cleanup_report(uuid, uuid, integer, text) to service_role;
grant execute on function public.pet_storage_cleanup_preview(integer) to service_role;
grant execute on function public.pet_storage_cleanup_audit(integer) to service_role;
grant execute on function public.pet_storage_cleanup_purge() to service_role;
