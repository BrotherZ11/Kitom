-- ============================================================
-- KITOM v2.2 · 17 · SUBSCRIPTIONS
-- CAMBIO vs v2.1 (punto 17): índice único parcial sobre
-- provider_subscription_id — impide que la misma suscripción de
-- RevenueCat quede asociada a dos usuarios distintos por error. Es
-- parcial (where provider_subscription_id is not null) porque todos
-- los usuarios free tienen ese campo NULL y NULL <> NULL en un índice
-- único normal no genera conflicto en Postgres, pero ser explícitos
-- con el WHERE deja la intención clara y evita cualquier duda.
-- ============================================================
create table public.subscriptions (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null references public.profiles(id) on delete cascade,
  plan                      subscription_plan not null default 'free',
  status                    subscription_status not null default 'active',
  provider                  text,
  provider_subscription_id  text,
  trial_end                 timestamptz,
  current_period_start      timestamptz,
  current_period_end        timestamptz,
  cancel_at_period_end      boolean not null default false,
  raw_provider_payload      jsonb,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create unique index idx_subscriptions_user on public.subscriptions(user_id);

create unique index idx_subscriptions_provider_sub_id on public.subscriptions(provider_subscription_id)
  where provider_subscription_id is not null;

create trigger set_timestamp_subscriptions
before update on public.subscriptions
for each row execute procedure public.trigger_set_timestamp();

alter table public.subscriptions enable row level security;

create policy "subscriptions: select own" on public.subscriptions for select using (user_id = auth.uid());
-- Sin insert/update para 'authenticated': solo el webhook de
-- RevenueCat, vía process_revenuecat_event() (18) con service_role.

revoke select on public.subscriptions from authenticated;
grant select (
  id, user_id, plan, status, provider, provider_subscription_id,
  trial_end, current_period_start, current_period_end, cancel_at_period_end, created_at
) on public.subscriptions to authenticated;
-- raw_provider_payload: nunca concedido.
