-- ============================================================
-- KITOM v2.2 · 22 · VET_CLINICS — sin cambios vs v2.1.
-- ============================================================
create table public.vet_clinics (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  city            text,
  country         text,
  contact_email   text,
  contact_phone   text,
  referral_code   text not null unique,
  created_at      timestamptz not null default now()
);

alter table public.vet_clinics enable row level security;

create policy "vet_clinics: select authenticated" on public.vet_clinics for select using (auth.role() = 'authenticated');

revoke select on public.vet_clinics from authenticated;
grant select (id, name, city, country, referral_code) on public.vet_clinics to authenticated;
