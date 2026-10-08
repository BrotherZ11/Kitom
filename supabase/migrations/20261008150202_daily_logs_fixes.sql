-- =====================================================================
-- KITOM · Daily logs: rachas, guardado idempotente, fechas y grants
-- =====================================================================
-- Problemas en el esquema desplegado (baseline = database/v2.2.1):
--  1. recompute_pet_streak() suma date + bigint (row_number() devuelve
--     bigint) y Postgres no tiene ese operador. El trigger de rachas la
--     llama en cada INSERT/UPDATE/DELETE de daily_logs, así que ninguna
--     escritura en daily_logs podía funcionar.
--  2. El upsert de PostgREST (INSERT ... ON CONFLICT DO UPDATE SET <todas
--     las columnas enviadas>) necesita UPDATE sobre pet_id y logged_by, que
--     authenticated no tiene (y el trigger de auditoría rechazaría el
--     cambio de logged_by de un co-editor). Se sustituye por la RPC
--     save_daily_log().
--  3. Reglas de producto (docs/DECISIONS.md, 2026-10-08): ventana de
--     creación de 7 días, log_date inmutable, sin registros vacíos, tags
--     de una lista cerrada y límite de longitud de las notas.
--  4. Grants por defecto de Supabase sobrantes en daily_logs.
--  5. Borrar una mascota con registros violaba la FK de pet_streaks (el
--     trigger de rachas recalculaba durante la cascada).
-- Sin cambios de RLS: las cuatro políticas existentes se mantienen.
-- Sin datos: no hay registros previos (ninguna escritura funcionaba).
-- =====================================================================

-- 1. Rachas: solo se corrige el tipo (rn::integer); misma lógica ----------
create or replace function public.recompute_pet_streak (
  target_pet_id uuid
)
  returns void
  language plpgsql
  security definer
  set search_path to 'public'
  as $function$
declare
  calc record;
  owner_tz text;
  owner_local_today date;
begin
  perform pg_advisory_xact_lock(hashtext(target_pet_id::text)::bigint);

  select p.timezone into owner_tz
  from public.pets pt
  join public.profiles p on p.id = pt.owner_id
  where pt.id = target_pet_id;

  owner_local_today := (now() at time zone coalesce(owner_tz, 'UTC'))::date;

  with dates as (
    select distinct log_date
    from public.daily_logs
    where pet_id = target_pet_id
  ),
  numbered as (
    select log_date, row_number() over (order by log_date desc) as rn
    from dates
  ),
  grouped as (
    -- date + integer: row_number() devuelve bigint y date + bigint no existe.
    select log_date, log_date + rn::integer as grp
    from numbered
  ),
  all_runs as (
    select grp, count(*) as len, max(log_date) as run_end
    from grouped
    group by grp
  ),
  current_run as (
    select len from all_runs order by run_end desc limit 1
  )
  select
    coalesce((select len from current_run), 0) as current_len,
    coalesce((select max(len) from all_runs), 0) as longest_len,
    (select max(log_date) from dates) as last_date
  into calc;

  insert into public.pet_streaks (pet_id, current_streak, longest_streak, last_log_date, updated_at)
  values (
    target_pet_id,
    case when calc.last_date >= owner_local_today - 1 then calc.current_len else 0 end,
    calc.longest_len,
    calc.last_date,
    now()
  )
  on conflict (pet_id) do update
  set current_streak = excluded.current_streak,
      -- longest_streak nunca decrece: se conserva el máximo histórico
      -- aunque el recálculo actual dé un valor más bajo (p. ej. tras
      -- borrar logs antiguos).
      longest_streak  = greatest(public.pet_streaks.longest_streak, excluded.longest_streak),
      last_log_date   = excluded.last_log_date,
      updated_at      = now();

  if calc.current_len >= 1 then
    perform public.award_pet_achievement(target_pet_id, 'first_log');
  end if;
  if calc.current_len >= 7 then
    perform public.award_pet_achievement(target_pet_id, 'streak_7');
  end if;
  if calc.current_len >= 30 then
    perform public.award_pet_achievement(target_pet_id, 'streak_30');
  end if;
end;
$function$;

revoke all on function public.recompute_pet_streak(uuid) from public, anon, authenticated;

-- 1b. Rachas al borrar la mascota ----------------------------------------
-- Al borrar una mascota, la cascada borra sus daily_logs y el trigger
-- recalculaba la racha de cada registro borrado: el upsert en pet_streaks
-- de una mascota ya inexistente viola pet_streaks_pet_id_fkey (desde el
-- segundo registro, Postgres revisa la FK porque la fila de racha ya se
-- escribió en esta transacción; y en cualquier caso si la cascada de
-- pet_streaks se ejecuta antes que la de daily_logs). Si la mascota ya no
-- existe, su racha se borra en la misma cascada: no hay nada que recalcular.
-- Borrar un registro de una mascota que sigue existiendo recalcula igual
-- que antes.
create or replace function public.trg_recompute_pet_streak_fn()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
  as $function$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.pets where id = old.pet_id) then
      return old; -- cascada de la mascota: pet_streaks también se borra
    end if;
    perform public.recompute_pet_streak(old.pet_id);
    return old;
  else
    perform public.recompute_pet_streak(new.pet_id);
    return new;
  end if;
end;
$function$;

revoke all on function public.trg_recompute_pet_streak_fn() from public, anon, authenticated;

-- 2. Fecha: ventana de creación de 7 días en la zona del propietario -------
-- Al crear: log_date entre hoy - 7 y hoy (8 días, ambos incluidos), con
-- "hoy" en profiles.timezone del propietario de la mascota (NOT NULL,
-- default 'UTC'; si no se encuentra el perfil, también UTC).
-- Al editar no se valida la fecha: log_date no puede cambiar (sección 3 y
-- grants), así que un registro antiguo se puede editar sin límite.
-- service_role queda fuera de la validación (backend, importaciones).
create or replace function public.validate_daily_log_date()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
  as $function$
declare
  owner_tz text;
  owner_local_today date;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    return new;
  end if;

  select p.timezone into owner_tz
  from public.pets pt
  join public.profiles p on p.id = pt.owner_id
  where pt.id = new.pet_id;

  owner_local_today := (now() at time zone coalesce(owner_tz, 'UTC'))::date;

  if new.log_date > owner_local_today then
    raise exception 'No se pueden crear registros con fecha futura (hoy es % en la zona horaria del propietario)', owner_local_today
      using hint = 'log_date_future';
  end if;

  if new.log_date < owner_local_today - 7 then
    raise exception 'Solo se pueden crear registros de los últimos 7 días (hoy es % en la zona horaria del propietario)', owner_local_today
      using hint = 'log_date_too_old';
  end if;

  return new;
end;
$function$;

revoke all on function public.validate_daily_log_date() from public, anon, authenticated;

-- 3. log_date inmutable: segunda capa, junto con el REVOKE UPDATE (log_date)
create or replace function public.protect_daily_log_audit_fields()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
  as $function$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  if new.pet_id is distinct from old.pet_id then
    raise exception 'No se puede modificar pet_id de un registro existente';
  end if;
  if new.logged_by is distinct from old.logged_by then
    raise exception 'No se puede modificar quién creó originalmente el registro';
  end if;
  if new.log_date is distinct from old.log_date then
    raise exception 'No se puede modificar log_date de un registro existente';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'No se puede modificar created_at';
  end if;
  return new;
end;
$function$;

revoke all on function public.protect_daily_log_audit_fields() from public, anon, authenticated;

-- 4. Contenido ---------------------------------------------------------------
-- Niveles: siguen siendo los CHECK 1..5 existentes (NULL = no indicado).
-- Tags: lista cerrada de códigos (PRD §8.3). Añadir uno requiere migración.
-- Notas: límite en caracteres, no en bytes (decisión en docs/DECISIONS.md).
-- No vacío: al menos un nivel, comportamiento inusual marcado o con nota,
-- una nota con texto o una etiqueta. Aplica también al editar: para
-- quitarlo todo, se borra el registro.
alter table public.daily_logs
  add constraint daily_logs_tags_check
    check (tags <@ array['vet_visit', 'home_change', 'new_pet']::text[]),
  add constraint daily_logs_notes_length_check
    check (char_length(notes) <= 2000),
  add constraint daily_logs_unusual_behavior_notes_length_check
    check (char_length(unusual_behavior_notes) <= 1000),
  add constraint daily_logs_not_empty_check
    check (
      num_nonnulls(
        energy_level, appetite_level, mood_level, activity_level,
        sleep_quality, vocalization_level, social_interaction_level
      ) > 0
      or unusual_behavior
      or coalesce(unusual_behavior_notes ~ '[^[:space:]]', false)
      or coalesce(notes ~ '[^[:space:]]', false)
      or coalesce(cardinality(tags), 0) > 0
    );

-- 5. Grants ------------------------------------------------------------------
-- anon: nada. authenticated: SELECT y DELETE de la tabla; INSERT de las
-- columnas de creación; UPDATE solo de las columnas de datos (sin log_date).
-- id, created_at, updated_at y last_edited_by los gestiona la BD.
revoke all on table public.daily_logs from anon;
revoke truncate, references, trigger, maintain on table public.daily_logs from authenticated;
revoke update (log_date) on table public.daily_logs from authenticated;

-- 6. Guardado idempotente por (pet_id, log_date) ------------------------------
-- SECURITY INVOKER: se ejecuta con los privilegios y la RLS de quien llama
-- (INSERT: can_edit_pet + logged_by = auth.uid(); UPDATE: can_edit_pet).
-- Sustituye el registro completo del día (todas las columnas de datos):
-- un parámetro NULL deja ese dato vacío. Al editar se conserva logged_by;
-- last_edited_by y updated_at los ponen los triggers.
-- UPDATE primero y luego INSERT (no INSERT ... ON CONFLICT): los triggers
-- BEFORE INSERT se ejecutan antes de detectar el conflicto, y la ventana de
-- 7 días impediría editar un registro antiguo.
create function public.save_daily_log (
  p_pet_id                   uuid,
  p_log_date                 date,
  p_energy_level             smallint,
  p_appetite_level           smallint,
  p_mood_level               smallint,
  p_activity_level           smallint,
  p_sleep_quality            smallint,
  p_vocalization_level       smallint,
  p_social_interaction_level smallint,
  p_unusual_behavior         boolean,
  p_unusual_behavior_notes   text,
  p_notes                    text,
  p_tags                     text[]
)
  returns public.daily_logs
  language plpgsql
  security invoker
  set search_path to 'public'
  as $function$
declare
  v_unusual_behavior       boolean := coalesce(p_unusual_behavior, false);
  -- Texto sin espacios sobrantes; solo espacios = sin nota.
  v_unusual_behavior_notes text := nullif(btrim(p_unusual_behavior_notes, E' \t\r\n'), '');
  v_notes                  text := nullif(btrim(p_notes, E' \t\r\n'), '');
  -- Sin duplicados y en orden estable; el CHECK valida los códigos.
  v_tags                   text[] := array(select distinct tag from unnest(p_tags) as tag order by tag);
  result                   public.daily_logs;
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;

  -- Error claro para viewers y no miembros. La autorización real es RLS.
  if not public.can_edit_pet(p_pet_id) then
    raise exception 'No tienes acceso de edición sobre esta mascota' using errcode = '42501';
  end if;

  for attempt in 1..2 loop
    update public.daily_logs
    set energy_level             = p_energy_level,
        appetite_level           = p_appetite_level,
        mood_level               = p_mood_level,
        activity_level           = p_activity_level,
        sleep_quality            = p_sleep_quality,
        vocalization_level       = p_vocalization_level,
        social_interaction_level = p_social_interaction_level,
        unusual_behavior         = v_unusual_behavior,
        unusual_behavior_notes   = v_unusual_behavior_notes,
        notes                    = v_notes,
        tags                     = v_tags
    where pet_id = p_pet_id
      and log_date = p_log_date
    returning * into result;

    if found then
      return result;
    end if;

    begin
      insert into public.daily_logs (
        pet_id, logged_by, log_date,
        energy_level, appetite_level, mood_level, activity_level,
        sleep_quality, vocalization_level, social_interaction_level,
        unusual_behavior, unusual_behavior_notes, notes, tags
      )
      values (
        p_pet_id, auth.uid(), p_log_date,
        p_energy_level, p_appetite_level, p_mood_level, p_activity_level,
        p_sleep_quality, p_vocalization_level, p_social_interaction_level,
        v_unusual_behavior, v_unusual_behavior_notes, v_notes, v_tags
      )
      returning * into result;

      return result;
    exception
      when unique_violation then
        -- Otro dispositivo creó el registro de ese día entre el UPDATE y el
        -- INSERT: se repite el UPDATE una vez.
        null;
    end;
  end loop;

  raise exception 'No se pudo guardar el registro diario';
end;
$function$;

comment on function public.save_daily_log(uuid, date, smallint, smallint, smallint, smallint, smallint, smallint, smallint, boolean, text, text, text[]) is
  'Crea o sustituye el registro diario de una mascota para un día (identidad: pet_id + log_date). SECURITY INVOKER: aplica RLS y grants de quien llama.';

revoke all on function public.save_daily_log(uuid, date, smallint, smallint, smallint, smallint, smallint, smallint, smallint, boolean, text, text, text[]) from public, anon;
grant execute on function public.save_daily_log(uuid, date, smallint, smallint, smallint, smallint, smallint, smallint, smallint, boolean, text, text, text[]) to authenticated;
