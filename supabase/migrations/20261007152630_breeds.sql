-- =====================================================================
-- KITOM · Razas de mascota (breeds)
-- =====================================================================
-- Catálogo de razas por especie y raza opcional en pets.
-- Decisión y modelo: docs/DECISIONS.md · contrato: docs/FRONTEND_ARCHITECTURE.md
--
--   pets.breed_status  NULL     → todavía no preguntado (breed_id y breed NULL)
--                      known    → exactamente uno de: breed_id (catálogo) | breed (texto libre)
--                      mixed    → mestizo, sin raza concreta (breed_id y breed NULL)
--                      unknown  → el tutor no la conoce (breed_id y breed NULL)
--
-- Integridad especie ↔ raza: FK compuesta pets (breed_id, species_id) →
-- breeds (id, species_id). Con MATCH SIMPLE, breed_id NULL no se comprueba.
-- Aditiva: no borra datos ni columnas; solo sustituye el CHECK de
-- catalog_translations por uno más amplio.
-- =====================================================================

-- 1. Estado de la raza ---------------------------------------------------
create type public.breed_status as enum ('known', 'mixed', 'unknown');

-- 2. Catálogo de razas (siempre de una especie) ---------------------------
create table public.breeds (
  id         uuid                     not null default gen_random_uuid(),
  species_id uuid                     not null,
  code       text                     not null,
  is_active  boolean                  not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint breeds_pkey primary key (id),
  constraint breeds_species_id_fkey foreign key (species_id) references public.species (id),
  constraint breeds_species_id_code_key unique (species_id, code),
  -- Destino de la FK compuesta desde pets: garantiza raza de la misma especie.
  constraint breeds_id_species_id_key unique (id, species_id)
);

comment on table public.breeds is
  'Catálogo de razas por especie. Nombres y alias en catalog_translations (entity_type = ''breed''). Las razas no se borran: se desactivan con is_active.';

create trigger set_timestamp_breeds
  before update on public.breeds
  for each row
  execute function public.trigger_set_timestamp();

-- RLS y grants: lectura para usuarios autenticados (mismo patrón que species).
-- Se revocan los privilegios por defecto del esquema public: solo backend escribe.
alter table public.breeds enable row level security;

revoke all on table public.breeds from anon, authenticated;
grant select on table public.breeds to authenticated;

create policy "breeds: select authenticated" on public.breeds
  for select
  to public
  using (auth.role() = 'authenticated');

-- 3. Traducciones de razas -------------------------------------------------
-- Sustituye el CHECK existente por uno que además admite 'breed'.
alter table public.catalog_translations
  drop constraint catalog_translations_entity_type_check;

alter table public.catalog_translations
  add constraint catalog_translations_entity_type_check
  check (entity_type = any (array['species'::text, 'symptom'::text, 'achievement'::text, 'breed'::text]));

-- 4. Raza en pets (opcional) -------------------------------------------------
alter table public.pets
  add column breed_id     uuid,
  add column breed_status public.breed_status;

-- Datos previos: un texto en breed pasa a ser raza conocida no catalogada.
update public.pets
  set breed_status = 'known'
  where breed is not null and breed_status is null;

alter table public.pets
  add constraint pets_breed_species_fkey
    foreign key (breed_id, species_id) references public.breeds (id, species_id);

alter table public.pets
  add constraint pets_breed_status_check check (
    case breed_status
      when 'known' then num_nonnulls(breed_id, breed) = 1
      else breed_id is null and breed is null   -- mixed, unknown y NULL (sin contestar)
    end
  );

create index idx_pets_breed on public.pets using btree (breed_id);

-- pets usa GRANT por columna: sin esto, insert/update de authenticated fallarían.
grant insert (breed_id, breed_status), update (breed_id, breed_status)
  on table public.pets to authenticated;
