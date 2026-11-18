-- =====================================================================
-- KITOM · Kitom Premium: plan gratuito con límites y suscripción con RevenueCat
-- =====================================================================
-- Rama db/premium (2026-11-16), aprobada por el responsable el mismo día
-- (Premium activo desde la prueba cerrada de Google Play; reserva a Premium
-- la IA ilimitada, las mascotas ilimitadas, el historial completo y los
-- co-tutores). Sustituye a «v1 gratuita y sin Premium» (2026-10-29).
--
--  1. private.free_plan_limits(): una sola fuente para los límites del plan
--     gratuito (2 mascotas propias activas, 30 días de historial, 3 consultas
--     de IA al mes). private.is_premium(uid): plan 'premium' con estado
--     active/trialing/past_due y periodo sin vencer (un webhook perdido de
--     caducidad no deja Premium para siempre).
--  2. get_ai_analysis_entitlement(): misma firma y columnas; el plan se
--     decide con private.is_premium (antes bastaba plan = 'premium', aunque
--     estuviera caducado). request_ai_analysis no cambia: ya la usa.
--  3. get_my_plan(): estado del plan y límites de quien llama (auth.uid()),
--     para la app. Solo lectura; el cliente nunca decide el plan.
--  4. Trigger BEFORE INSERT en pets: sin Premium, como mucho
--     free_plan_limits().max_owned_pets mascotas propias activas
--     (hint pet_limit_reached). Las cuentas que ya tienen más las conservan
--     (no se borra ni archiva nada). Solo limita altas con sesión de usuario
--     (auth.uid() = owner_id): transferencias (UPDATE) y procesos de servicio
--     no cuentan. El reenvío de un alta ya creada (misma client_request_id)
--     sigue llegando al índice único (23505), como en la fase 8.
--  5. invite_pet_member e invite_pet_member_by_email: invitar exige Premium
--     (hint premium_required), comprobado justo después de la propiedad y
--     antes de mirar el email (no revela si un email tiene cuenta).
--     Aceptar invitaciones sigue siendo libre. Resto: igual que en
--     20261030090318 (by_email) y 20261006175453 (invite_pet_member).
--  6. subscriptions.provider_state_at + apply_subscription_state(): la
--     escritura del estado que hacen las Edge Functions revenuecat-webhook y
--     subscription-sync (service_role) con el estado que devuelve la API de
--     RevenueCat en ese momento. Idempotente por id de evento; un estado
--     leído antes que el guardado no lo pisa ('stale'), así que el orden de
--     llegada de los webhooks no importa. Se retiran los privilegios de
--     escritura de tabla que anon y authenticated aún tenían sobre
--     subscriptions y subscription_events (RLS ya las bloqueaba).
--
-- El historial anterior a 30 días NO se oculta en la base de datos (RLS):
-- es del usuario, se exporta (RGPD art. 20) y vuelve a verse al hacerse
-- Premium; la app limita la vista con history_days de get_my_plan
-- (docs/DECISIONS.md, 2026-11-16). Contrato: docs/README.md §10 y §19.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Límites y plan efectivo
-- ---------------------------------------------------------------------
create or replace function private.free_plan_limits()
  returns table (max_owned_pets integer, history_days integer, ai_monthly integer)
  language sql
  immutable
  set search_path = ''
as $$
  select 2, 30, 3;
$$;

comment on function private.free_plan_limits() is
  'Límites del plan gratuito (única fuente): mascotas propias activas, días de historial visibles en la app y consultas de IA al mes.';

create or replace function private.is_premium(p_user_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select exists (
    select 1
    from public.subscriptions s
    where s.user_id = p_user_id
      and s.plan = 'premium'
      and s.status in ('active', 'trialing', 'past_due')
      and (s.current_period_end is null or s.current_period_end > now())
  );
$$;

comment on function private.is_premium(uuid) is
  'Premium efectivo: plan premium, estado activo/prueba/periodo de gracia y periodo sin vencer.';

revoke all on function private.free_plan_limits() from public;
revoke all on function private.is_premium(uuid) from public;

-- ---------------------------------------------------------------------
-- 2. Cupo de IA con el plan efectivo
-- ---------------------------------------------------------------------
create or replace function public.get_ai_analysis_entitlement()
  returns table (can_request boolean, would_use_full_history boolean, monthly_used integer, monthly_limit integer)
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  requester_premium boolean;
  used_count integer;
  limit_count integer;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  requester_premium := private.is_premium(auth.uid());

  select count(*) into used_count
  from private.ai_analysis_usage u
  where u.user_id = auth.uid()
    and u.counts
    and u.created_at >= date_trunc('month', now());

  if requester_premium then
    limit_count := null;
  else
    select l.ai_monthly into limit_count from private.free_plan_limits() l;
  end if;

  return query select
    (limit_count is null or used_count < limit_count),
    requester_premium,
    used_count,
    limit_count;
end;
$function$;

-- ---------------------------------------------------------------------
-- 3. Estado del plan para la app
-- ---------------------------------------------------------------------
create or replace function public.get_my_plan()
  returns table (
    plan public.subscription_plan,
    is_premium boolean,
    status public.subscription_status,
    current_period_end timestamptz,
    trial_end timestamptz,
    cancel_at_period_end boolean,
    owned_pets integer,
    max_owned_pets integer,
    history_days integer,
    can_invite_co_owners boolean,
    ai_monthly_used integer,
    ai_monthly_limit integer
  )
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  premium boolean;
  limits record;
  sub record;
  owned integer;
  ai_used integer;
begin
  if uid is null then
    raise exception 'No autenticado' using hint = 'not_authenticated';
  end if;

  premium := private.is_premium(uid);
  select * into limits from private.free_plan_limits();
  select s.plan, s.status, s.current_period_end, s.trial_end, s.cancel_at_period_end
    into sub
  from public.subscriptions s
  where s.user_id = uid;

  select count(*) into owned from public.pets p where p.owner_id = uid and p.is_active;

  select count(*) into ai_used
  from private.ai_analysis_usage u
  where u.user_id = uid
    and u.counts
    and u.created_at >= date_trunc('month', now());

  return query select
    coalesce(sub.plan, 'free'::public.subscription_plan),
    premium,
    coalesce(sub.status, 'active'::public.subscription_status),
    sub.current_period_end,
    sub.trial_end,
    coalesce(sub.cancel_at_period_end, false),
    owned,
    case when premium then null else limits.max_owned_pets end,
    case when premium then null else limits.history_days end,
    premium,
    ai_used,
    case when premium then null else limits.ai_monthly end;
end;
$$;

comment on function public.get_my_plan() is
  'Plan y límites de auth.uid() para la app (solo lectura). NULL en un límite = sin límite.';

revoke all on function public.get_my_plan() from public, anon;
grant execute on function public.get_my_plan() to authenticated;

-- ---------------------------------------------------------------------
-- 4. Límite de mascotas propias sin Premium
-- ---------------------------------------------------------------------
create or replace function private.enforce_pet_plan_limit()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  owned integer;
  max_pets integer;
begin
  -- Solo las altas de una sesión de usuario para sí mismo; service_role y
  -- procesos internos (sin auth.uid()) no se limitan.
  if auth.uid() is null or new.owner_id is distinct from auth.uid() then
    return new;
  end if;

  if private.is_premium(new.owner_id) then
    return new;
  end if;

  -- Una alta a la vez por usuario: dos simultáneas no pasan las dos el límite.
  perform pg_advisory_xact_lock(hashtext('pet_plan_limit:' || new.owner_id::text)::bigint);

  -- Reenvío de un alta que ya existe: que responda el índice único (23505),
  -- que es lo que el motor de la app reconoce como «ya creada».
  if new.client_request_id is not null and exists (
    select 1 from public.pets p
    where p.owner_id = new.owner_id and p.client_request_id = new.client_request_id
  ) then
    return new;
  end if;

  select l.max_owned_pets into max_pets from private.free_plan_limits() l;
  select count(*) into owned from public.pets p where p.owner_id = new.owner_id and p.is_active;

  if owned >= max_pets then
    raise exception 'El plan gratuito permite % mascotas propias', max_pets
      using hint = 'pet_limit_reached';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_pet_plan_limit() from public;

create trigger trg_enforce_pet_plan_limit
  before insert on public.pets
  for each row execute function private.enforce_pet_plan_limit();

-- ---------------------------------------------------------------------
-- 5. Invitar co-tutores exige Premium
-- ---------------------------------------------------------------------
create or replace function public.invite_pet_member(
  target_pet_id uuid,
  invitee_user_id uuid,
  initial_role public.co_owner_role default 'viewer'::public.co_owner_role
)
  returns void
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  pet_row public.pets%rowtype;
  existing public.pet_co_owners%rowtype;
  invitee_exists boolean;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  select * into pet_row from public.pets where id = target_pet_id;
  if not found then
    raise exception 'Mascota no encontrada';
  end if;
  if pet_row.owner_id <> auth.uid() then
    raise exception 'Solo el propietario principal puede invitar co-tutores';
  end if;
  if not private.is_premium(auth.uid()) then
    raise exception 'Invitar co-tutores es una función de Kitom Premium' using hint = 'premium_required';
  end if;
  if not pet_row.is_active then
    raise exception 'No se puede invitar sobre una mascota archivada';
  end if;
  if invitee_user_id = auth.uid() then
    raise exception 'No puedes invitarte a ti mismo';
  end if;

  select exists(select 1 from public.profiles where id = invitee_user_id) into invitee_exists;
  if not invitee_exists then
    raise exception 'El usuario invitado no existe';
  end if;

  select * into existing from public.pet_co_owners
  where pet_id = target_pet_id and user_id = invitee_user_id;

  if found then
    if existing.status in ('pending','accepted') then
      raise exception 'Ya existe una invitación activa para este usuario (estado: %)', existing.status;
    end if;
    update public.pet_co_owners
    set status = 'pending',
        role = initial_role,
        invited_by = auth.uid(),
        invited_at = now(),
        accepted_at = null
    where pet_id = target_pet_id and user_id = invitee_user_id;
  else
    insert into public.pet_co_owners (pet_id, user_id, role, status, invited_by)
    values (target_pet_id, invitee_user_id, initial_role, 'pending', auth.uid());
  end if;
end;
$function$;

create or replace function public.invite_pet_member_by_email(
  target_pet_id uuid,
  invitee_email text,
  initial_role public.co_owner_role default 'viewer'::public.co_owner_role
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

  -- Premium, también antes de mirar el email (misma respuesta exista o no la cuenta).
  if not private.is_premium(auth.uid()) then
    raise exception 'Invitar co-tutores es una función de Kitom Premium' using hint = 'premium_required';
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

-- ---------------------------------------------------------------------
-- 6. Estado de la suscripción desde RevenueCat (solo service_role)
-- ---------------------------------------------------------------------
-- Defensa en profundidad: el plan ya decide funciones de pago. RLS no tiene
-- políticas de escritura (nadie podía escribir), pero quedaban privilegios de
-- tabla de la exportación original: anon, todo; authenticated, INSERT, UPDATE y
-- DELETE. Solo lo escribe service_role; authenticated conserva su SELECT por columna.
revoke all on table public.subscriptions from anon;
revoke all on table public.subscription_events from anon;
revoke insert, update, delete on table public.subscriptions from authenticated;
revoke insert, update, delete on table public.subscription_events from authenticated;

alter table public.subscriptions
  add column provider_state_at timestamptz;

comment on column public.subscriptions.provider_state_at is
  'Momento en que se leyó de RevenueCat el estado guardado. Un estado leído antes no lo sustituye. Interno: sin GRANT al cliente.';

create or replace function public.apply_subscription_state(
  p_user_id uuid,
  p_source_event_id text,
  p_event_type text,
  p_state_at timestamptz,
  p_is_premium boolean,
  p_status public.subscription_status,
  p_current_period_start timestamptz,
  p_current_period_end timestamptz,
  p_trial_end timestamptz,
  p_cancel_at_period_end boolean,
  p_provider text,
  p_provider_subscription_id text,
  p_raw_payload jsonb
)
  returns text
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  sub_row public.subscriptions%rowtype;
  event_row_id uuid;
  new_plan public.subscription_plan :=
    case when p_is_premium then 'premium'::public.subscription_plan else 'free'::public.subscription_plan end;
begin
  if p_user_id is null or coalesce(trim(p_source_event_id), '') = '' or p_state_at is null
     or p_status is null or p_is_premium is null then
    raise exception 'Parámetros no válidos' using hint = 'invalid_request';
  end if;

  -- Cuenta borrada (o id que no es de Kitom): nada que actualizar.
  if not exists (select 1 from public.profiles where id = p_user_id) then
    return 'unknown_user';
  end if;

  insert into public.subscriptions (user_id) values (p_user_id)
  on conflict (user_id) do nothing;

  select * into sub_row from public.subscriptions where user_id = p_user_id for update;

  insert into public.subscription_events (
    subscription_id, provider_event_id, event_type,
    previous_plan, new_plan, previous_status, new_status, raw_payload
  )
  values (
    sub_row.id, p_source_event_id, coalesce(nullif(trim(p_event_type), ''), 'UNKNOWN'),
    sub_row.plan, new_plan, sub_row.status, p_status, p_raw_payload
  )
  on conflict (provider_event_id) do nothing
  returning id into event_row_id;

  if event_row_id is null then
    return 'duplicate';
  end if;

  if sub_row.provider_state_at is not null and p_state_at < sub_row.provider_state_at then
    return 'stale';
  end if;

  -- Una misma compra solo puede ser de una cuenta (índice único): si RevenueCat
  -- la ha pasado a esta, se suelta de la anterior (su estado llega en su propio
  -- evento de transferencia).
  if p_is_premium and p_provider_subscription_id is not null then
    update public.subscriptions
    set provider_subscription_id = null
    where provider_subscription_id = p_provider_subscription_id
      and user_id <> p_user_id;
  end if;

  update public.subscriptions
  set plan = new_plan,
      status = p_status,
      provider = coalesce(p_provider, provider),
      provider_subscription_id = case when p_is_premium then p_provider_subscription_id else null end,
      current_period_start = p_current_period_start,
      current_period_end = p_current_period_end,
      trial_end = p_trial_end,
      cancel_at_period_end = coalesce(p_cancel_at_period_end, false),
      raw_provider_payload = p_raw_payload,
      provider_state_at = p_state_at
  where user_id = p_user_id;

  return 'applied';
end;
$$;

comment on function public.apply_subscription_state(uuid, text, text, timestamptz, boolean, public.subscription_status,
  timestamptz, timestamptz, timestamptz, boolean, text, text, jsonb) is
  'Guarda el estado de la suscripción leído de RevenueCat (Edge Functions revenuecat-webhook y subscription-sync). Devuelve applied | duplicate | stale | unknown_user.';

revoke all on function public.apply_subscription_state(uuid, text, text, timestamptz, boolean, public.subscription_status,
  timestamptz, timestamptz, timestamptz, boolean, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.apply_subscription_state(uuid, text, text, timestamptz, boolean, public.subscription_status,
  timestamptz, timestamptz, timestamptz, boolean, text, text, jsonb) to service_role;
