-- ============================================================
-- KITOM v2.2 · 14 · ACHIEVEMENTS_CATALOG — sin cambios vs v2.1.
-- ============================================================
create table public.achievements_catalog (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,
  icon         text,
  sort_order   integer not null default 0,
  criteria     jsonb not null
);

alter table public.achievements_catalog enable row level security;

create policy "achievements_catalog: select authenticated" on public.achievements_catalog for select using (auth.role() = 'authenticated');
