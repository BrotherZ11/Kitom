-- =====================================================================
-- KITOM · Orientación con IA v2: contexto del tutor, resultado más completo
-- y orientación para todas las especies
-- =====================================================================
-- Rama db/ai-guidance-v2 (2026-11-13), aprobada por el responsable el mismo día.
--
--  1. ai_analysis_requests: datos de entrada del tutor (user_context ≤ 1000
--     caracteres, symptom_onset, symptom_trend) y del resultado (summary,
--     warning_signs, vet_questions, photo_observations), con CHECK de
--     longitud y SELECT por columna para authenticated (como el resto de la
--     tabla). Nadie los escribe desde el cliente: la entrada, solo
--     request_ai_analysis; el resultado, la Edge Function con service_role.
--  2. request_ai_analysis: 3 parámetros opcionales nuevos al final
--     (p_user_context, p_symptom_onset, p_symptom_trend). Se borra la firma de
--     3 parámetros (con dos sobrecargas PostgREST no sabría cuál elegir); las
--     versiones de la app que llaman con target_pet_id, p_photo_path y
--     symptom_ids usan la nueva sin cambios. Contexto en blanco = NULL.
--     hint nuevos: ai_context_too_long, ai_invalid_context. El resto de
--     comprobaciones conserva orden, mensajes y hint (20261111120000).
--  3. species.ai_guidance_enabled = true en las 9 especies (decisión del
--     responsable, 2026-11-13; sustituye a «solo perro y gato» del
--     2026-11-11). Las señales de cada especie son catálogo: supabase/seed.sql,
--     que hay que reejecutar después de aplicar esta migración. Prompt,
--     señales y reglas siguen siendo un borrador hasta la validación
--     veterinaria (docs/DEPLOYMENT.md §8).
--
-- Sin cambios de RLS ni de triggers. Contrato: docs/README.md §8–§11.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Columnas nuevas de ai_analysis_requests
-- ---------------------------------------------------------------------
alter table public.ai_analysis_requests
  add column user_context text,
  add column symptom_onset text,
  add column symptom_trend text,
  add column summary text,
  add column warning_signs text[],
  add column vet_questions text[],
  add column photo_observations text;

alter table public.ai_analysis_requests
  add constraint ai_analysis_requests_user_context_length_check
    check (char_length(user_context) between 1 and 1000),
  add constraint ai_analysis_requests_symptom_onset_check
    check (symptom_onset in ('today', 'days_1_3', 'days_4_7', 'over_week')),
  add constraint ai_analysis_requests_symptom_trend_check
    check (symptom_trend in ('better', 'same', 'worse')),
  add constraint ai_analysis_requests_summary_length_check
    check (char_length(summary) <= 600),
  add constraint ai_analysis_requests_warning_signs_length_check
    check (private.text_array_within(warning_signs, 6, 240)),
  add constraint ai_analysis_requests_vet_questions_length_check
    check (private.text_array_within(vet_questions, 5, 240)),
  add constraint ai_analysis_requests_photo_observations_length_check
    check (char_length(photo_observations) <= 600);

comment on column public.ai_analysis_requests.user_context is
  'Contexto libre del tutor para la orientación (≤ 1000). Lo escribe request_ai_analysis; se envía al proveedor de IA.';
comment on column public.ai_analysis_requests.symptom_onset is
  'Desde cuándo: today | days_1_3 | days_4_7 | over_week; NULL = sin indicar.';
comment on column public.ai_analysis_requests.symptom_trend is
  'Evolución: better | same | worse; NULL = sin indicar.';
comment on column public.ai_analysis_requests.summary is
  'Resumen de la orientación (Edge Function ai-analysis-process).';
comment on column public.ai_analysis_requests.warning_signs is
  'Señales de alerta que obligarían a acudir al veterinario ya (Edge Function).';
comment on column public.ai_analysis_requests.vet_questions is
  'Datos o preguntas para llevar al veterinario (Edge Function).';
comment on column public.ai_analysis_requests.photo_observations is
  'Qué se aprecia en la foto, descriptivo (Edge Function); NULL sin foto.';

-- Lectura por columna, como el resto de la tabla (RLS decide qué filas).
grant select (user_context, symptom_onset, symptom_trend, summary, warning_signs, vet_questions, photo_observations)
  on public.ai_analysis_requests to authenticated;

-- ---------------------------------------------------------------------
-- 2. request_ai_analysis con el contexto del tutor
-- ---------------------------------------------------------------------
drop function public.request_ai_analysis(uuid, text, uuid[]);

create function public.request_ai_analysis (
  target_pet_id   uuid,
  p_photo_path    text,
  symptom_ids     uuid[] default '{}'::uuid[],
  p_user_context  text default null,
  p_symptom_onset text default null,
  p_symptom_trend text default null
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
  context_text text;
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

  -- 1b) Orientación disponible para la especie.
  if not exists (
    select 1 from public.species s
    where s.id = pet_row.species_id and s.ai_guidance_enabled
  ) then
    raise exception 'La orientación todavía no está disponible para esta especie'
      using hint = 'ai_species_unsupported';
  end if;

  -- 2) La foto (si la hay) debe pertenecer a esta mascota
  if p_photo_path is not null then
    if public.safe_pet_id_from_path(p_photo_path) is distinct from target_pet_id then
      raise exception 'photo_path no corresponde a esta mascota' using hint = 'ai_invalid_photo';
    end if;
  end if;

  -- 2b) Contexto del tutor: en blanco = sin contexto; inicio y evolución de una lista cerrada.
  context_text := nullif(regexp_replace(p_user_context, '^\s+|\s+$', '', 'g'), '');
  if char_length(context_text) > 1000 then
    raise exception 'El contexto no puede superar los 1000 caracteres' using hint = 'ai_context_too_long';
  end if;
  if p_symptom_onset is not null and p_symptom_onset not in ('today', 'days_1_3', 'days_4_7', 'over_week') then
    raise exception 'Valor no válido para el inicio de las señales' using hint = 'ai_invalid_context';
  end if;
  if p_symptom_trend is not null and p_symptom_trend not in ('better', 'same', 'worse') then
    raise exception 'Valor no válido para la evolución de las señales' using hint = 'ai_invalid_context';
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
  insert into public.ai_analysis_requests (
    pet_id, requested_by, photo_path, used_full_history, status,
    user_context, symptom_onset, symptom_trend
  )
  values (
    target_pet_id, auth.uid(), p_photo_path, entitlement.would_use_full_history, 'pending',
    context_text, p_symptom_onset, p_symptom_trend
  )
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

comment on function public.request_ai_analysis(uuid, text, uuid[], text, text, text) is
  'Pide una orientación con IA (aviso, acceso, especie, foto, contexto, señales, cupo y límites). Contrato: docs/README.md §8.';

revoke all on function public.request_ai_analysis(uuid, text, uuid[], text, text, text) from public, anon;
grant execute on function public.request_ai_analysis(uuid, text, uuid[], text, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. Orientación para todas las especies
-- ---------------------------------------------------------------------
update public.species set ai_guidance_enabled = true where not ai_guidance_enabled;

comment on column public.species.ai_guidance_enabled is
  'Orientación con IA disponible para esta especie (request_ai_analysis la exige). Señales en symptom_species (seed). Borrador hasta la validación veterinaria.';
