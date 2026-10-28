-- =====================================================================
-- KITOM · Limpieza de Storage: no trabajar sin garantías (revisión de seguridad)
-- =====================================================================
-- Revisión de 20261027194908_pet_storage_cleanup.sql antes del PR:
--  1. Las RPC leen storage.objects como su propietario (quien aplica las
--     migraciones). La tabla tiene RLS y es de supabase_storage_admin: si
--     ese propietario no se saltara RLS, vería 0 objetos y un trabajo se
--     daría por terminado con todo en su sitio, sin ningún aviso. En el
--     Supabase local `postgres` tiene BYPASSRLS (comprobado con la
--     integración); en otro entorno no está demostrado.
--  2. Sin el CHECK pets_photo_path_own_pet (20261027194904), otra mascota
--     podría empezar a referenciar un objeto entre que se lista y se borra.
--
-- Cambio: private.pet_storage_cleanup_assert_ready() comprueba las dos
-- cosas y, si falta alguna, lanza un error con un código propio
-- (pet_storage_cleanup_storage_not_visible / _photo_path_unchecked). La
-- llaman al empezar claim, objects, report, preview y audit, que se
-- redefinen igual que en 20261027194908 salvo esa línea (CREATE OR REPLACE:
-- conservan propietario y grants). purge no lee Storage. Así, mal
-- configurado, nada se reserva ni se da por terminado: la Edge Function
-- responde 500 con el código y los trabajos esperan.
-- Sin cambios de tablas, RLS, grants ni políticas.
-- =====================================================================

-- 1. Comprobación (sin SECURITY DEFINER: dentro de las RPC, current_user es su propietario)
create or replace function private.pet_storage_cleanup_assert_ready()
  returns void
  language plpgsql
  stable
  set search_path = ''
  as $function$
begin
  -- Ve storage.objects entero si es superusuario o se salta RLS, si la tabla no tiene RLS, o si es (o
  -- hereda de) su propietario y la tabla no fuerza RLS al propietario.
  if not exists (
    select 1
      from pg_catalog.pg_roles r, pg_catalog.pg_class c
     where r.rolname = current_user
       and c.oid = 'storage.objects'::regclass
       and (r.rolsuper or r.rolbypassrls or not c.relrowsecurity
            or (pg_catalog.pg_has_role(current_user, c.relowner, 'USAGE') and not c.relforcerowsecurity))
  ) then
    raise exception 'pet_storage_cleanup_storage_not_visible' using hint = 'pet_storage_cleanup_storage_not_visible';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'pets_photo_path_own_pet' and conrelid = 'public.pets'::regclass and convalidated
  ) then
    raise exception 'pet_storage_cleanup_photo_path_unchecked' using hint = 'pet_storage_cleanup_photo_path_unchecked';
  end if;
end;
$function$;

revoke all on function private.pet_storage_cleanup_assert_ready() from public, anon, authenticated, service_role;

-- 2. Las RPC, con la comprobación al principio
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
  perform private.pet_storage_cleanup_assert_ready();

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
  perform private.pet_storage_cleanup_assert_ready();

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
  perform private.pet_storage_cleanup_assert_ready();

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

create or replace function public.pet_storage_cleanup_preview(p_limit integer)
  returns table (job_id uuid, attempts integer, due boolean, pet_exists boolean, objects bigint, referenced bigint)
  language plpgsql
  stable
  security definer
  set search_path = ''
  as $function$
begin
  perform private.pet_storage_cleanup_assert_ready();

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

create or replace function public.pet_storage_cleanup_audit(p_limit integer)
  returns table (folder_pet_id uuid, objects bigint, job_status text)
  language plpgsql
  stable
  security definer
  set search_path = ''
  as $function$
begin
  perform private.pet_storage_cleanup_assert_ready();

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
