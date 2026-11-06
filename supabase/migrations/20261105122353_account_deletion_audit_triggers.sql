-- =====================================================================
-- KITOM · Borrar una cuenta con datos en mascotas que sobreviven (D-11)
-- =====================================================================
-- reminders.created_by y daily_logs.logged_by/last_edited_by apuntan a
-- public.profiles con ON DELETE SET NULL, y profiles a auth.users con CASCADE.
-- Al borrar la cuenta, esa acción de FK dispara los BEFORE UPDATE de la tabla y
-- los triggers de auditoría la rechazaban: Auth respondía 500 y la cuenta seguía
-- viva (co-tutores que escribieron algo y propietarios que transfirieron).
--
-- Por qué no se mira el rol ni auth.uid(). Contexto medido dentro del trigger
-- durante auth.admin.deleteUser:
--   current_user = postgres (la acción de FK cambia al dueño de la tabla)
--   session_user = supabase_auth_admin
--   auth.uid(), auth.role() y request.jwt.claims = NULL
-- El mismo current_user y los mismos NULL se dan en cualquier UPDATE sin JWT.
--
-- Se mira el estado, que es lo que define a la acción de FK: el perfil al que
-- apuntaba la columna ya no existe. Mientras el perfil exista (cualquier cambio
-- hecho por una persona o por una función) se sigue rechazando. Una persona no
-- puede fabricar ese estado: profiles no tiene política de DELETE, y sin perfil
-- tampoco quedaría ninguna fila apuntándole. Solo se permite pasar a NULL.
--
-- set_last_edited_by: la misma acción de FK no es una edición. Sin esto, borrar
-- la cuenta de la autora ponía last_edited_by a NULL (auth.uid()), y se perdía
-- quién editó el registro de otra persona.
--
-- Sin cambios de tablas, GRANT, RLS ni triggers (solo el cuerpo de cuatro
-- funciones). Las demás comprobaciones de esas funciones y la rama de
-- service_role siguen igual. updated_at sigue cambiando en estas filas: es un
-- cambio real y las copias sin conexión deben enterarse.
-- =====================================================================

-- 1. reminders.created_by
create or replace function public.protect_reminder_audit_fields()
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
    raise exception 'No se puede modificar pet_id de un recordatorio existente';
  end if;
  if new.created_by is distinct from old.created_by then
    -- Única excepción: la FK ON DELETE SET NULL, con el perfil ya borrado.
    if new.created_by is not null
       or exists (select 1 from public.profiles p where p.id = old.created_by) then
      raise exception 'No se puede modificar quién creó el recordatorio';
    end if;
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'No se puede modificar created_at';
  end if;
  return new;
end;
$function$;

revoke all on function public.protect_reminder_audit_fields() from public, anon, authenticated;

-- 2. daily_logs.logged_by
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
    -- Única excepción: la FK ON DELETE SET NULL, con el perfil ya borrado.
    if new.logged_by is not null
       or exists (select 1 from public.profiles p where p.id = old.logged_by) then
      raise exception 'No se puede modificar quién creó originalmente el registro';
    end if;
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

-- 3. daily_logs.last_edited_by: la acción de FK no es una edición
create or replace function public.set_last_edited_by()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
  as $function$
begin
  if (old.logged_by is not null and new.logged_by is null
      and not exists (select 1 from public.profiles p where p.id = old.logged_by))
     or (old.last_edited_by is not null and new.last_edited_by is null
      and not exists (select 1 from public.profiles p where p.id = old.last_edited_by)) then
    return new;
  end if;
  new.last_edited_by = auth.uid();
  return new;
end;
$function$;

revoke all on function public.set_last_edited_by() from public, anon, authenticated;

-- 4. Rachas: la acción de FK no cambia ni pet_id ni log_date
-- Recalcular toda la mascota por cada fila es cuadrático: con 3650 registros Auth
-- agotaba sus 10 s (HTTP 504) y la cuenta tampoco se podía borrar. El resto de
-- actualizaciones recalculan como antes.
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
  end if;
  if tg_op = 'UPDATE'
     and ((old.logged_by is not null and new.logged_by is null
           and not exists (select 1 from public.profiles p where p.id = old.logged_by))
       or (old.last_edited_by is not null and new.last_edited_by is null
           and not exists (select 1 from public.profiles p where p.id = old.last_edited_by))) then
    return new;
  end if;
  perform public.recompute_pet_streak(new.pet_id);
  return new;
end;
$function$;

revoke all on function public.trg_recompute_pet_streak_fn() from public, anon, authenticated;
