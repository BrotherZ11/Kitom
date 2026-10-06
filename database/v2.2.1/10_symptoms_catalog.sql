-- ============================================================
-- KITOM v2.2 · 10 · SYMPTOMS_CATALOG + SYMPTOM_SPECIES — sin cambios
-- vs v2.1.
-- ============================================================
create table public.symptoms_catalog (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  category    text,
  created_at  timestamptz not null default now()
);

create table public.symptom_species (
  symptom_id  uuid not null references public.symptoms_catalog(id) on delete cascade,
  species_id  uuid not null references public.species(id) on delete cascade,
  primary key (symptom_id, species_id)
);

alter table public.symptoms_catalog enable row level security;
alter table public.symptom_species  enable row level security;

create policy "symptoms: select authenticated" on public.symptoms_catalog for select using (auth.role() = 'authenticated');
create policy "symptom_species: select authenticated" on public.symptom_species for select using (auth.role() = 'authenticated');
