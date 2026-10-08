-- =====================================================================
-- KITOM · profiles.timezone: NULL = sin configurar
-- =====================================================================
-- La columna ya existía (baseline): text NOT NULL DEFAULT 'UTC', con el
-- trigger validate_profile_timezone() que además convertía NULL en 'UTC'.
-- Así no se puede distinguir "el usuario nunca la ha configurado" de "el
-- usuario está en UTC", y la app no puede inicializarla con la zona del
-- dispositivo sin pisar una elección real. Además, pg_timezone_names admite
-- abreviaturas y alias que no son identificadores IANA de zona ('CET',
-- 'GMT+0', 'EST5EDT', 'Japan') y copias 'posix/…' y 'right/…'.
--
-- Cambios (sin columnas nuevas):
--  1. timezone admite NULL y no tiene default (los perfiles nuevos nacen
--     con NULL: handle_new_user no la rellena).
--  2. El trigger deja pasar NULL, valida solo cuando el valor cambia y exige
--     un identificador IANA de zona: 'UTC' o Área/Ubicación existente en
--     pg_timezone_names (sin catálogo propio que mantener).
--  3. Datos: 'UTC' era siempre el default (no hay pantalla para elegirla),
--     así que pasa a NULL para que la app la inicialice.
-- Las funciones de daily_logs ya usan coalesce(timezone, 'UTC'): con NULL
-- el comportamiento del servidor no cambia.
-- RLS y grants sin cambios: authenticated ya tenía UPDATE (timezone) y la
-- política "profiles: update own" (id = auth.uid()).
-- =====================================================================

-- 1. Trigger (antes que los datos: la versión anterior convertía NULL en 'UTC')
create or replace function public.validate_profile_timezone()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
  as $function$
begin
  -- NULL = sin configurar. El servidor la trata como 'UTC' donde la necesita.
  if new.timezone is null then
    return new;
  end if;

  -- Sin cambio de valor no se revalida: guardar la misma zona es un no-op y
  -- un valor antiguo no impide editar otras columnas del perfil.
  if tg_op = 'UPDATE' and new.timezone is not distinct from old.timezone then
    return new;
  end if;

  -- Identificador IANA de zona: 'UTC' o Área/Ubicación (p. ej. Europe/Madrid,
  -- America/Argentina/Buenos_Aires). Rechaza offsets ('+01:00'), abreviaturas
  -- y alias sin '/' ('CET', 'GMT+0') y las copias 'posix/' y 'right/'.
  if not (
       new.timezone = 'UTC'
       or (new.timezone ~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+)+$' and new.timezone !~ '^(posix|right)/')
     )
     or not exists (select 1 from pg_timezone_names where name = new.timezone) then
    raise exception 'Zona horaria no válida: % (debe ser un nombre IANA, p. ej. Europe/Madrid)', new.timezone
      using hint = 'invalid_timezone';
  end if;

  return new;
end;
$function$;

revoke all on function public.validate_profile_timezone() from public, anon, authenticated;

-- 2. Columna: admite NULL y sin default ---------------------------------------
alter table public.profiles
  alter column timezone drop default,
  alter column timezone drop not null;

comment on column public.profiles.timezone is
  'Zona horaria IANA del usuario (p. ej. Europe/Madrid). NULL = sin configurar (el servidor usa UTC). La app la inicializa con la del dispositivo y nunca sobrescribe un valor existente.';

-- 3. Datos: el default 'UTC' nunca lo eligió el usuario -------------------------
update public.profiles
  set timezone = null
  where timezone = 'UTC';
