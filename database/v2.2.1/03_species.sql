-- ============================================================
-- KITOM v2.2 · 03 · SPECIES — sin cambios vs v2.1
-- ============================================================
create table public.species (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null unique,
  scientific_name     text,
  category            text,
  parent_species_id   uuid references public.species(id),
  is_active           boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index idx_species_active on public.species(is_active);
create index idx_species_parent on public.species(parent_species_id);

create trigger set_timestamp_species
before update on public.species
for each row execute procedure public.trigger_set_timestamp();

alter table public.species enable row level security;

create policy "species: select authenticated" on public.species for select using (auth.role() = 'authenticated');
