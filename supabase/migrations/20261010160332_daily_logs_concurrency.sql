-- =====================================================================
-- KITOM · Daily logs: control de concurrencia optimista en save_daily_log
-- =====================================================================
-- Problema: save_daily_log() sustituye el registro completo del día sin
-- comprobar si ha cambiado desde que el cliente lo leyó. Si dos clientes
-- parten de la misma versión (dos dispositivos, un co-tutor, una edición
-- sin conexión que se sincroniza más tarde), el segundo guardado pisa al
-- primero sin avisar. Leer y después guardar desde el cliente no lo
-- resuelve: entre las dos llamadas puede colarse otro guardado.
--
-- Solución: dos precondiciones opcionales que se comprueban en la misma
-- sentencia que escribe (docs/DECISIONS.md, 2026-10-10):
--   p_expected_updated_at  versión (daily_logs.updated_at) de la fila que
--                          leyó el cliente: solo se edita si sigue igual.
--   p_expect_absent        el cliente espera que todavía no exista registro
--                          de esa mascota y fecha: solo se crea.
-- Si la precondición no se cumple: P0001 con hint 'daily_log_conflict' y
-- detail 'version_mismatch' | 'row_missing' | 'row_exists'. No se escribe
-- nada.
--
-- Firma: la identidad de una función en Postgres son sus tipos de entrada.
-- CREATE OR REPLACE con dos parámetros más crearía una SEGUNDA función
-- (sobrecarga) y dejaría la anterior en uso: Postgres elige la que no
-- necesita defaults y PostgREST la que coincide con las claves enviadas,
-- así que las llamadas actuales seguirían sin protección. Por eso se borra
-- la firma de 13 parámetros y se crea la de 15; los dos nuevos tienen
-- default y van al final, de modo que las llamadas actuales (13 argumentos,
-- con nombre o posicionales) siguen resolviendo a la única función.
--
-- Transición: sin precondiciones (llamada actual del frontend) el
-- comportamiento es el de antes: crea o sustituye sin comprobar versión, es
-- decir, gana el último guardado. Se conserva solo por compatibilidad hasta
-- que el frontend envíe siempre una precondición; no usarlo en código nuevo
-- ni para la sincronización offline.
--
-- Versión: updated_at, comparado de forma exacta (microsegundos). El cliente
-- debe reenviar la cadena que devolvió PostgREST tal cual; truncada a
-- milisegundos (p. ej. al pasar por Date en JavaScript) nunca coincide.
--
-- Sin cambios de tablas, triggers, RLS ni grants de tabla. Los permisos de
-- la función son los mismos que tenía la firma anterior.
-- =====================================================================

drop function public.save_daily_log(uuid, date, smallint, smallint, smallint, smallint, smallint, smallint, smallint, boolean, text, text, text[]);

-- SECURITY INVOKER: se ejecuta con los privilegios y la RLS de quien llama
-- (INSERT: can_edit_pet + logged_by = auth.uid(); UPDATE: can_edit_pet).
-- Sustituye el registro completo del día (todas las columnas de datos):
-- un parámetro NULL deja ese dato vacío. Al editar se conserva logged_by;
-- last_edited_by y updated_at los ponen los triggers.
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
  p_tags                     text[],
  p_expected_updated_at      timestamptz default null,
  p_expect_absent            boolean     default false
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
  v_expect_absent          boolean := coalesce(p_expect_absent, false);
  v_constraint             text;
  result                   public.daily_logs;
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;

  -- Error claro para viewers y no miembros, antes de cualquier comprobación
  -- de conflicto: quien no puede editar no averigua si el registro existe o
  -- ha cambiado. La autorización real es RLS.
  if not public.can_edit_pet(p_pet_id) then
    raise exception 'No tienes acceso de edición sobre esta mascota' using errcode = '42501';
  end if;

  if v_expect_absent and p_expected_updated_at is not null then
    raise exception 'p_expected_updated_at y p_expect_absent no se pueden usar a la vez'
      using errcode = '22023';
  end if;

  -- A. Editar la versión leída --------------------------------------------
  -- La comprobación va en el WHERE del propio UPDATE: es atómica. Si otra
  -- transacción está modificando la fila, este UPDATE espera a que termine
  -- y vuelve a evaluar el WHERE sobre la fila ya cambiada (READ COMMITTED),
  -- así que nunca escribe sobre una versión distinta de la esperada.
  if p_expected_updated_at is not null then
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
      and updated_at = p_expected_updated_at
    returning * into result;

    if found then
      return result;
    end if;

    -- Sin fila: o cambió la versión, o se borró, o RLS la ha filtrado porque
    -- el permiso se revocó mientras esta llamada estaba en curso. Lo último
    -- sigue siendo un error de permisos, no un conflicto.
    if not public.can_edit_pet(p_pet_id) then
      raise exception 'No tienes acceso de edición sobre esta mascota' using errcode = '42501';
    end if;

    if exists (select 1 from public.daily_logs where pet_id = p_pet_id and log_date = p_log_date) then
      raise exception 'El registro de este día ha cambiado desde que se leyó'
        using errcode = 'P0001', hint = 'daily_log_conflict', detail = 'version_mismatch';
    end if;

    raise exception 'El registro de este día ya no existe'
      using errcode = 'P0001', hint = 'daily_log_conflict', detail = 'row_missing';
  end if;

  -- B. Crear solo si no existe ---------------------------------------------
  -- Nunca hace UPDATE. La comprobación previa da el conflicto antes que los
  -- triggers BEFORE INSERT (si no, un registro antiguo que ya existe daría
  -- "fuera de la ventana de 7 días" en vez de conflicto). La garantía real
  -- es UNIQUE (pet_id, log_date): si otra transacción crea el registro a la
  -- vez, este INSERT espera a que termine y falla con unique_violation.
  if v_expect_absent then
    if exists (select 1 from public.daily_logs where pet_id = p_pet_id and log_date = p_log_date) then
      raise exception 'Ya existe un registro de este día'
        using errcode = 'P0001', hint = 'daily_log_conflict', detail = 'row_exists';
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
        get stacked diagnostics v_constraint = constraint_name;
        if v_constraint is distinct from 'daily_logs_pet_id_log_date_key' then
          raise;
        end if;
        raise exception 'Ya existe un registro de este día'
          using errcode = 'P0001', hint = 'daily_log_conflict', detail = 'row_exists';
    end;
  end if;

  -- C. Sin precondición (compatibilidad) -----------------------------------
  -- Comportamiento anterior, sin cambios: crea o sustituye sin comprobar la
  -- versión. UPDATE primero y luego INSERT (no INSERT ... ON CONFLICT): los
  -- triggers BEFORE INSERT se ejecutan antes de detectar el conflicto, y la
  -- ventana de 7 días impediría editar un registro antiguo.
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

comment on function public.save_daily_log(uuid, date, smallint, smallint, smallint, smallint, smallint, smallint, smallint, boolean, text, text, text[], timestamptz, boolean) is
  'Crea o sustituye el registro diario de una mascota para un día (identidad: pet_id + log_date). Precondiciones opcionales: p_expected_updated_at (editar solo esa versión) o p_expect_absent (crear solo si no existe); si no se cumplen, P0001 con hint daily_log_conflict. SECURITY INVOKER: aplica RLS y grants de quien llama.';

-- Mismos permisos que la firma anterior. Una función nueva nace con EXECUTE
-- para PUBLIC y, por los default privileges de Supabase, para anon.
revoke all on function public.save_daily_log(uuid, date, smallint, smallint, smallint, smallint, smallint, smallint, smallint, boolean, text, text, text[], timestamptz, boolean) from public, anon;
grant execute on function public.save_daily_log(uuid, date, smallint, smallint, smallint, smallint, smallint, smallint, smallint, boolean, text, text, text[], timestamptz, boolean) to authenticated;
