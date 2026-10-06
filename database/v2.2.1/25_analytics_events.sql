-- ============================================================
-- KITOM v2.2 · 25 · ANALYTICS_EVENTS — sin cambios vs v2.1.
-- Principio reafirmado por escrito (punto 29): esta tabla NUNCA es
-- fuente de verdad de billing, entitlement, ownership, seguridad ni
-- límites de IA. Esas decisiones siempre se toman contra
-- subscriptions, pets, pet_co_owners y ai_analysis_requests — nunca
-- contra analytics_events. Ninguna función de este archivo consulta
-- analytics_events para decidir nada, y así debe seguir siendo.
-- ============================================================
create table public.analytics_events (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references public.profiles(id) on delete set null,
  event_name   text not null,
  properties   jsonb default '{}',
  created_at   timestamptz not null default now()
);

create index idx_analytics_events_name on public.analytics_events(event_name, created_at desc);

alter table public.analytics_events enable row level security;

create policy "analytics_events: insert own" on public.analytics_events for insert with check (user_id = auth.uid());
