-- ============================================================
-- KITOM v2.2 · 18 · SUBSCRIPTION_EVENTS
-- Sin cambios de fondo vs v2.1 (punto 17 ya resuelto: idempotencia
-- real vía provider_event_id UNIQUE + process_revenuecat_event()
-- atómica). Decisión explícita, documentada aquí porque el documento
-- pedía dejarlo por escrito: NO se añade una columna received_at
-- separada de occurred_at para esta versión — no es necesaria para el
-- MVP (occurred_at ya guarda cuándo dice RevenueCat que ocurrió el
-- evento; el propio orden de inserción en la tabla sirve como
-- referencia de cuándo lo recibió Kitom si alguna vez hiciera falta).
-- Se añade la comprobación explícita de auth.uid() no aplica aquí
-- porque esta función es exclusivamente backend (nunca la llama un
-- usuario autenticado normal).
-- ============================================================
create table public.subscription_events (
  id                 uuid primary key default gen_random_uuid(),
  subscription_id    uuid not null references public.subscriptions(id) on delete cascade,
  provider_event_id  text not null unique,
  event_type         text not null,
  previous_plan      subscription_plan,
  new_plan           subscription_plan,
  previous_status    subscription_status,
  new_status         subscription_status,
  raw_payload        jsonb,
  occurred_at        timestamptz not null default now()
);

create index idx_subscription_events_subscription on public.subscription_events(subscription_id, occurred_at desc);

alter table public.subscription_events enable row level security;

create policy "subscription_events: select own" on public.subscription_events for select using (
  exists (select 1 from public.subscriptions s where s.id = subscription_id and s.user_id = auth.uid())
);

revoke select on public.subscription_events from authenticated;
grant select (id, subscription_id, event_type, previous_plan, new_plan, previous_status, new_status, occurred_at)
  on public.subscription_events to authenticated;

create or replace function public.process_revenuecat_event(
  p_provider_event_id text,
  p_user_id uuid,
  p_event_type text,
  p_new_plan subscription_plan,
  p_new_status subscription_status,
  p_current_period_start timestamptz,
  p_current_period_end timestamptz,
  p_trial_end timestamptz,
  p_cancel_at_period_end boolean,
  p_provider text,
  p_provider_subscription_id text,
  p_raw_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  sub_row public.subscriptions%rowtype;
  event_inserted uuid;
begin
  select * into sub_row from public.subscriptions where user_id = p_user_id for update;
  if not found then
    raise exception 'No existe suscripción para el usuario %', p_user_id;
  end if;

  insert into public.subscription_events (
    subscription_id, provider_event_id, event_type,
    previous_plan, new_plan, previous_status, new_status, raw_payload
  )
  values (
    sub_row.id, p_provider_event_id, p_event_type,
    sub_row.plan, p_new_plan, sub_row.status, p_new_status, p_raw_payload
  )
  on conflict (provider_event_id) do nothing
  returning id into event_inserted;

  if event_inserted is null then
    return; -- evento ya procesado antes: no-op idempotente
  end if;

  update public.subscriptions
  set plan = p_new_plan,
      status = p_new_status,
      provider = coalesce(p_provider, provider),
      provider_subscription_id = coalesce(p_provider_subscription_id, provider_subscription_id),
      current_period_start = p_current_period_start,
      current_period_end = p_current_period_end,
      trial_end = p_trial_end,
      cancel_at_period_end = p_cancel_at_period_end,
      raw_provider_payload = p_raw_payload
  where user_id = p_user_id;
end;
$$;

revoke execute on function public.process_revenuecat_event(
  text, uuid, text, subscription_plan, subscription_status,
  timestamptz, timestamptz, timestamptz, boolean, text, text, jsonb
) from public, anon, authenticated;
-- Exclusivamente invocable con service_role desde la Edge Function
-- del webhook.
