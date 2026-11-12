-- =====================================================================
-- KITOM · Campos por especie (fase 16B)
-- =====================================================================
-- Diseño aprobado: docs/proposals/2026-11-11-species-fields.md (D-1 a D-10).
--
--  1. Especies: las 9 del catálogo pasan a estar activas (decisión del
--     usuario, 2026-11-11). Se insertan si faltan: en un entorno nuevo las
--     migraciones corren antes que el seed y el catálogo de campos las
--     necesita. Columna species.ai_guidance_enabled: la orientación con IA
--     solo para perro y gato hasta su validación veterinaria (D-4).
--     «Ave (otra)» / «Reptil (otro)» pasan a «Ave» / «Reptil» (D-6); los
--     códigos no cambian.
--  2. Catálogo public.species_fields: qué campos tiene cada especie en la
--     ficha (scope = 'profile') y en el registro diario ('daily'), y qué
--     escalas comunes del registro se le preguntan (kind = 'core'). Lo
--     escribe esta migración: la validación depende de él y debe existir
--     igual en todos los entornos. Copia de la app:
--     frontend/src/features/species/species-fields.ts (prueba de paridad).
--  3. pets.species_data y daily_logs.species_data (jsonb, objeto plano,
--     ≤ 4096 bytes), validados por el trigger validate_species_data contra
--     el catálogo de la especie ACTUAL de la mascota. Solo se validan las
--     claves que cambian: un dato antiguo (de otra especie o de un campo
--     retirado) se conserva y el registro se sigue pudiendo editar. Cambiar
--     la especie de una mascota vacía su species_data si no se envía otro
--     (D-7: los registros diarios conservan lo que tenían).
--  4. daily_logs_not_empty_check: también cuenta species_data.
--  5. save_daily_log: nuevo parámetro p_species_data jsonb DEFAULT NULL al
--     final. NULL = conservar lo guardado (una app antigua, que no lo envía,
--     nunca borra los datos de especie); '{}' = vaciar. Se borra la firma de
--     15 parámetros y se crea la de 16, sin sobrecarga (lección de firmas en
--     supabase/CLAUDE.md): las llamadas actuales siguen resolviendo a la
--     única función.
--  6. request_ai_analysis: rechaza las especies sin orientación (hint
--     ai_species_unsupported) en el servidor, no solo en la UI. El resto de
--     la función queda igual que en 20261030090318.
--
-- Errores nuevos: P0001 con hint 'species_data_invalid' y detail = código
-- del campo (o 'species_data' si el objeto entero no vale);
-- 'ai_species_unsupported'.
-- Sin cambios en la RLS de las tablas existentes. GRANT nuevos:
-- INSERT/UPDATE (species_data) en pets y daily_logs; SELECT de
-- species_fields para authenticated.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Especies
-- ---------------------------------------------------------------------
insert into public.species (code, scientific_name, category, is_active) values
  ('dog',           'Canis lupus familiaris', 'mammal',  true),
  ('cat',           'Felis catus',            'mammal',  true),
  ('rabbit',        'Oryctolagus cuniculus',  'mammal',  true),
  ('guinea_pig',    'Cavia porcellus',        'mammal',  true),
  ('hamster',       null,                     'mammal',  true),
  ('horse',         'Equus ferus caballus',   'mammal',  true),
  ('bird_other',    null,                     'bird',    true),
  ('reptile_other', null,                     'reptile', true),
  ('other',         null,                     'other',   true)
on conflict (code) do nothing;

update public.species
set is_active = true
where code in ('dog', 'cat', 'rabbit', 'guinea_pig', 'hamster', 'horse', 'bird_other', 'reptile_other', 'other')
  and not is_active;

alter table public.species
  add column ai_guidance_enabled boolean not null default false;

comment on column public.species.ai_guidance_enabled is
  'Orientación con IA disponible para esta especie (request_ai_analysis la exige). Solo tras validación veterinaria.';

update public.species set ai_guidance_enabled = true where code in ('dog', 'cat');

-- Nombres: solo si ya existen (en un entorno nuevo los inserta el seed, ya con el nombre nuevo).
update public.catalog_translations ct
set value = v.value
from (values
  ('bird_other',    'es', 'Ave'),
  ('bird_other',    'en', 'Bird'),
  ('reptile_other', 'es', 'Reptil'),
  ('reptile_other', 'en', 'Reptile')
) as v(code, locale, value)
join public.species s on s.code = v.code
where ct.entity_type = 'species'
  and ct.entity_id = s.id
  and ct.locale = v.locale
  and ct.field = 'name'
  and ct.value is distinct from v.value;

-- ---------------------------------------------------------------------
-- 2. Catálogo de campos por especie
-- ---------------------------------------------------------------------
create table public.species_fields (
  id          uuid        not null default gen_random_uuid(),
  species_id  uuid        not null references public.species (id) on delete cascade,
  scope       text        not null,
  code        text        not null,
  kind        text        not null,
  options     text[],
  min_value   numeric,
  max_value   numeric,
  unit        text,
  position    integer     not null,
  is_primary  boolean     not null default false,
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now(),
  constraint species_fields_pkey primary key (id),
  constraint species_fields_species_scope_code_key unique (species_id, scope, code),
  constraint species_fields_scope_check check (scope in ('profile', 'daily')),
  constraint species_fields_code_check check (code ~ '^[a-z][a-z0-9_]{0,39}$'),
  constraint species_fields_kind_check
    check (kind in ('core', 'scale3', 'choice', 'multi_choice', 'boolean', 'integer', 'decimal', 'date')),
  constraint species_fields_options_check
    check ((kind in ('choice', 'multi_choice')) = (options is not null and cardinality(options) > 0)),
  constraint species_fields_range_check
    check (kind in ('integer', 'decimal') or (min_value is null and max_value is null)),
  constraint species_fields_unit_check
    check (unit is null or unit in ('g', 'kg', 'cm', 'cm2', 'min', 'h', 'celsius', 'count')),
  constraint species_fields_core_check
    check (
      (kind = 'core') = (code in ('energy', 'appetite', 'mood', 'activity', 'sleep', 'vocalization', 'social'))
      and (kind <> 'core' or scope = 'daily')
      and (kind = 'core' or not is_primary)
    )
);

comment on table public.species_fields is
  'Campos propios de cada especie (ficha y registro diario) y escalas comunes que se le preguntan (kind = core). Lo mantienen las migraciones; copia de la app en features/species/species-fields.ts.';

alter table public.species_fields enable row level security;

create policy "species_fields: select authenticated" on public.species_fields
  for select
  to authenticated
  using (true);

revoke all on table public.species_fields from public, anon, authenticated;
grant select on table public.species_fields to authenticated;

-- Generado desde features/species/species-fields.ts (prueba de paridad en la app).
-- core: position 0–6 en el orden de pantalla; ficha: 0…; registro diario: 100…
insert into public.species_fields (species_id, scope, code, kind, options, min_value, max_value, unit, position, is_primary)
select s.id, v.scope, v.code, v.kind, v.options, v.min_value, v.max_value, v.unit, v.position, v.is_primary
from (values
  ('dog', 'daily', 'energy', 'core', null::text[], null::numeric, null::numeric, null::text, 0, true),
  ('dog', 'daily', 'appetite', 'core', null, null, null, null, 1, true),
  ('dog', 'daily', 'mood', 'core', null, null, null, null, 2, true),
  ('dog', 'daily', 'activity', 'core', null, null, null, null, 3, true),
  ('dog', 'daily', 'sleep', 'core', null, null, null, null, 4, false),
  ('dog', 'daily', 'vocalization', 'core', null, null, null, null, 5, false),
  ('dog', 'daily', 'social', 'core', null, null, null, null, 6, false),
  ('dog', 'profile', 'microchip', 'choice', array['yes', 'no', 'unknown']::text[], null, null, null, 0, false),
  ('dog', 'profile', 'living_area', 'choice', array['indoor', 'outdoor', 'both']::text[], null, null, null, 1, false),
  ('dog', 'profile', 'diet', 'choice', array['dry', 'wet', 'mixed', 'homemade', 'raw', 'other']::text[], null, null, null, 2, false),
  ('dog', 'profile', 'meals_per_day', 'integer', null, 1, 6, 'count', 3, false),
  ('dog', 'profile', 'walks_per_day', 'integer', null, 0, 8, 'count', 4, false),
  ('dog', 'profile', 'lives_with', 'multi_choice', array['children', 'dogs', 'cats', 'other_animals']::text[], null, null, null, 5, false),
  ('dog', 'profile', 'training', 'choice', array['none', 'basic', 'advanced', 'working']::text[], null, null, null, 6, false),
  ('dog', 'daily', 'walks', 'integer', null, 0, 10, 'count', 100, false),
  ('dog', 'daily', 'walk_minutes', 'integer', null, 0, 600, 'min', 101, false),
  ('dog', 'daily', 'water', 'scale3', null, null, null, null, 102, false),
  ('dog', 'daily', 'stool', 'choice', array['normal', 'soft', 'liquid', 'hard', 'none']::text[], null, null, null, 103, false),
  ('dog', 'daily', 'vomit', 'boolean', null, null, null, null, 104, false),
  ('dog', 'daily', 'scratching', 'scale3', null, null, null, null, 105, false),
  ('cat', 'daily', 'energy', 'core', null, null, null, null, 0, true),
  ('cat', 'daily', 'appetite', 'core', null, null, null, null, 1, true),
  ('cat', 'daily', 'mood', 'core', null, null, null, null, 2, true),
  ('cat', 'daily', 'activity', 'core', null, null, null, null, 3, true),
  ('cat', 'daily', 'sleep', 'core', null, null, null, null, 4, false),
  ('cat', 'daily', 'vocalization', 'core', null, null, null, null, 5, false),
  ('cat', 'daily', 'social', 'core', null, null, null, null, 6, false),
  ('cat', 'profile', 'microchip', 'choice', array['yes', 'no', 'unknown']::text[], null, null, null, 0, false),
  ('cat', 'profile', 'outdoor_access', 'choice', array['never', 'protected', 'supervised', 'free']::text[], null, null, null, 1, false),
  ('cat', 'profile', 'litter_boxes', 'integer', null, 0, 10, 'count', 2, false),
  ('cat', 'profile', 'litter_type', 'choice', array['clumping', 'silica', 'plant', 'other']::text[], null, null, null, 3, false),
  ('cat', 'profile', 'diet', 'choice', array['dry', 'wet', 'mixed', 'homemade', 'raw', 'other']::text[], null, null, null, 4, false),
  ('cat', 'profile', 'water_source', 'choice', array['bowl', 'fountain', 'both']::text[], null, null, null, 5, false),
  ('cat', 'profile', 'lives_with', 'multi_choice', array['children', 'dogs', 'cats', 'other_animals']::text[], null, null, null, 6, false),
  ('cat', 'daily', 'urination', 'choice', array['less', 'usual', 'more', 'outside_box']::text[], null, null, null, 100, false),
  ('cat', 'daily', 'stool', 'choice', array['normal', 'soft', 'liquid', 'hard', 'none']::text[], null, null, null, 101, false),
  ('cat', 'daily', 'water', 'scale3', null, null, null, null, 102, false),
  ('cat', 'daily', 'grooming', 'scale3', null, null, null, null, 103, false),
  ('cat', 'daily', 'hairball_vomit', 'choice', array['none', 'hairball', 'vomit']::text[], null, null, null, 104, false),
  ('cat', 'daily', 'hiding', 'boolean', null, null, null, null, 105, false),
  ('rabbit', 'daily', 'energy', 'core', null, null, null, null, 0, true),
  ('rabbit', 'daily', 'appetite', 'core', null, null, null, null, 1, true),
  ('rabbit', 'daily', 'mood', 'core', null, null, null, null, 2, true),
  ('rabbit', 'daily', 'activity', 'core', null, null, null, null, 3, true),
  ('rabbit', 'daily', 'social', 'core', null, null, null, null, 4, false),
  ('rabbit', 'profile', 'housing', 'choice', array['cage', 'pen', 'free_roam', 'outdoor']::text[], null, null, null, 0, false),
  ('rabbit', 'profile', 'hours_out', 'integer', null, 0, 24, 'h', 1, false),
  ('rabbit', 'profile', 'unlimited_hay', 'boolean', null, null, null, null, 2, false),
  ('rabbit', 'profile', 'daily_greens', 'boolean', null, null, null, null, 3, false),
  ('rabbit', 'profile', 'pellets', 'choice', array['none', 'extruded', 'seed_mix']::text[], null, null, null, 4, false),
  ('rabbit', 'profile', 'bonded_companion', 'boolean', null, null, null, null, 5, false),
  ('rabbit', 'profile', 'flooring', 'choice', array['hard', 'carpet', 'mixed']::text[], null, null, null, 6, false),
  ('rabbit', 'daily', 'hay_eaten', 'choice', array['none', 'less', 'usual']::text[], null, null, null, 100, false),
  ('rabbit', 'daily', 'droppings', 'choice', array['usual', 'fewer', 'none_seen']::text[], null, null, null, 101, false),
  ('rabbit', 'daily', 'uneaten_cecotropes', 'boolean', null, null, null, null, 102, false),
  ('rabbit', 'daily', 'water', 'scale3', null, null, null, null, 103, false),
  ('rabbit', 'daily', 'hunched', 'boolean', null, null, null, null, 104, false),
  ('guinea_pig', 'daily', 'energy', 'core', null, null, null, null, 0, true),
  ('guinea_pig', 'daily', 'appetite', 'core', null, null, null, null, 1, true),
  ('guinea_pig', 'daily', 'mood', 'core', null, null, null, null, 2, true),
  ('guinea_pig', 'daily', 'activity', 'core', null, null, null, null, 3, true),
  ('guinea_pig', 'daily', 'vocalization', 'core', null, null, null, null, 4, false),
  ('guinea_pig', 'daily', 'social', 'core', null, null, null, null, 5, false),
  ('guinea_pig', 'profile', 'housing', 'choice', array['cage', 'pen', 'free_roam', 'outdoor']::text[], null, null, null, 0, false),
  ('guinea_pig', 'profile', 'companions', 'integer', null, 0, 10, 'count', 1, false),
  ('guinea_pig', 'profile', 'vitamin_c', 'choice', array['diet', 'supplement', 'both', 'none', 'unknown']::text[], null, null, null, 2, false),
  ('guinea_pig', 'profile', 'unlimited_hay', 'boolean', null, null, null, null, 3, false),
  ('guinea_pig', 'daily', 'hay_eaten', 'choice', array['none', 'less', 'usual']::text[], null, null, null, 100, false),
  ('guinea_pig', 'daily', 'droppings', 'choice', array['usual', 'fewer', 'none_seen']::text[], null, null, null, 101, false),
  ('guinea_pig', 'daily', 'water', 'scale3', null, null, null, null, 102, false),
  ('guinea_pig', 'daily', 'weight_g', 'integer', null, 100, 2500, 'g', 103, false),
  ('hamster', 'daily', 'energy', 'core', null, null, null, null, 0, true),
  ('hamster', 'daily', 'appetite', 'core', null, null, null, null, 1, true),
  ('hamster', 'daily', 'mood', 'core', null, null, null, null, 2, false),
  ('hamster', 'daily', 'activity', 'core', null, null, null, null, 3, true),
  ('hamster', 'profile', 'cage_area', 'integer', null, 500, 20000, 'cm2', 0, false),
  ('hamster', 'profile', 'wheel_diameter', 'integer', null, 10, 40, 'cm', 1, false),
  ('hamster', 'profile', 'bedding_depth', 'integer', null, 0, 60, 'cm', 2, false),
  ('hamster', 'profile', 'lives_alone', 'boolean', null, null, null, null, 3, false),
  ('hamster', 'daily', 'wheel_use', 'choice', array['none', 'little', 'usual', 'lots']::text[], null, null, null, 100, false),
  ('hamster', 'daily', 'food_hoarded', 'scale3', null, null, null, null, 101, false),
  ('hamster', 'daily', 'droppings', 'choice', array['usual', 'fewer', 'none_seen']::text[], null, null, null, 102, false),
  ('hamster', 'daily', 'weight_g', 'integer', null, 15, 250, 'g', 103, false),
  ('horse', 'daily', 'energy', 'core', null, null, null, null, 0, true),
  ('horse', 'daily', 'appetite', 'core', null, null, null, null, 1, true),
  ('horse', 'daily', 'mood', 'core', null, null, null, null, 2, true),
  ('horse', 'daily', 'activity', 'core', null, null, null, null, 3, true),
  ('horse', 'daily', 'sleep', 'core', null, null, null, null, 4, false),
  ('horse', 'daily', 'vocalization', 'core', null, null, null, null, 5, false),
  ('horse', 'daily', 'social', 'core', null, null, null, null, 6, false),
  ('horse', 'profile', 'height', 'integer', null, 70, 200, 'cm', 0, false),
  ('horse', 'profile', 'horse_use', 'choice', array['leisure', 'sport', 'work', 'breeding', 'retired']::text[], null, null, null, 1, false),
  ('horse', 'profile', 'horse_housing', 'choice', array['stall', 'stall_paddock', 'pasture', 'mixed']::text[], null, null, null, 2, false),
  ('horse', 'profile', 'shoeing', 'choice', array['barefoot', 'front', 'all']::text[], null, null, null, 3, false),
  ('horse', 'profile', 'forage', 'choice', array['hay', 'grass', 'haylage', 'mixed']::text[], null, null, null, 4, false),
  ('horse', 'profile', 'concentrate', 'decimal', null, 0, 10, 'kg', 5, false),
  ('horse', 'daily', 'work_minutes', 'integer', null, 0, 480, 'min', 100, false),
  ('horse', 'daily', 'work_intensity', 'choice', array['light', 'medium', 'high']::text[], null, null, null, 101, false),
  ('horse', 'daily', 'forage_eaten', 'scale3', null, null, null, null, 102, false),
  ('horse', 'daily', 'water', 'scale3', null, null, null, null, 103, false),
  ('horse', 'daily', 'manure', 'choice', array['usual', 'fewer', 'soft', 'none_seen']::text[], null, null, null, 104, false),
  ('horse', 'daily', 'lameness', 'choice', array['none', 'mild', 'evident']::text[], null, null, null, 105, false),
  ('bird_other', 'daily', 'energy', 'core', null, null, null, null, 0, true),
  ('bird_other', 'daily', 'appetite', 'core', null, null, null, null, 1, true),
  ('bird_other', 'daily', 'mood', 'core', null, null, null, null, 2, true),
  ('bird_other', 'daily', 'activity', 'core', null, null, null, null, 3, true),
  ('bird_other', 'daily', 'vocalization', 'core', null, null, null, null, 4, false),
  ('bird_other', 'daily', 'social', 'core', null, null, null, null, 5, false),
  ('bird_other', 'profile', 'bird_housing', 'choice', array['cage', 'aviary', 'free']::text[], null, null, null, 0, false),
  ('bird_other', 'profile', 'hours_out', 'integer', null, 0, 24, 'h', 1, false),
  ('bird_other', 'profile', 'wings_clipped', 'boolean', null, null, null, null, 2, false),
  ('bird_other', 'profile', 'leg_band', 'choice', array['yes', 'no', 'unknown']::text[], null, null, null, 3, false),
  ('bird_other', 'profile', 'bird_diet', 'choice', array['seeds', 'pellets', 'mixed']::text[], null, null, null, 4, false),
  ('bird_other', 'profile', 'daily_fresh_food', 'boolean', null, null, null, null, 5, false),
  ('bird_other', 'profile', 'lives_with_birds', 'boolean', null, null, null, null, 6, false),
  ('bird_other', 'daily', 'plumage', 'choice', array['normal', 'fluffed', 'plucked']::text[], null, null, null, 100, false),
  ('bird_other', 'daily', 'bird_droppings', 'choice', array['usual', 'watery', 'color_change', 'fewer']::text[], null, null, null, 101, false),
  ('bird_other', 'daily', 'food_eaten', 'scale3', null, null, null, null, 102, false),
  ('bird_other', 'daily', 'bath', 'boolean', null, null, null, null, 103, false),
  ('bird_other', 'daily', 'minutes_out', 'integer', null, 0, 1440, 'min', 104, false),
  ('reptile_other', 'daily', 'energy', 'core', null, null, null, null, 0, true),
  ('reptile_other', 'daily', 'appetite', 'core', null, null, null, null, 1, true),
  ('reptile_other', 'daily', 'activity', 'core', null, null, null, null, 2, true),
  ('reptile_other', 'profile', 'reptile_diet', 'choice', array['insectivore', 'herbivore', 'carnivore', 'omnivore']::text[], null, null, null, 0, false),
  ('reptile_other', 'profile', 'enclosure_length', 'integer', null, 10, 400, 'cm', 1, false),
  ('reptile_other', 'profile', 'enclosure_width', 'integer', null, 10, 400, 'cm', 2, false),
  ('reptile_other', 'profile', 'enclosure_height', 'integer', null, 10, 400, 'cm', 3, false),
  ('reptile_other', 'profile', 'basking_temp', 'decimal', null, 15, 50, 'celsius', 4, false),
  ('reptile_other', 'profile', 'cool_temp', 'decimal', null, 10, 40, 'celsius', 5, false),
  ('reptile_other', 'profile', 'uvb', 'choice', array['none', 't5', 't8', 'mercury_vapor', 'unknown']::text[], null, null, null, 6, false),
  ('reptile_other', 'profile', 'uvb_changed_on', 'date', null, null, null, null, 7, false),
  ('reptile_other', 'profile', 'brumation', 'choice', array['yes', 'no', 'not_applicable']::text[], null, null, null, 8, false),
  ('reptile_other', 'daily', 'fed', 'choice', array['not_due', 'ate', 'refused']::text[], null, null, null, 100, false),
  ('reptile_other', 'daily', 'shedding', 'choice', array['no', 'in_progress', 'complete', 'incomplete']::text[], null, null, null, 101, false),
  ('reptile_other', 'daily', 'defecated', 'boolean', null, null, null, null, 102, false),
  ('reptile_other', 'daily', 'basking_temp', 'decimal', null, 15, 50, 'celsius', 103, false),
  ('reptile_other', 'daily', 'soak', 'boolean', null, null, null, null, 104, false),
  ('other', 'daily', 'energy', 'core', null, null, null, null, 0, true),
  ('other', 'daily', 'appetite', 'core', null, null, null, null, 1, true),
  ('other', 'daily', 'mood', 'core', null, null, null, null, 2, false),
  ('other', 'daily', 'activity', 'core', null, null, null, null, 3, true),
  ('other', 'daily', 'sleep', 'core', null, null, null, null, 4, false),
  ('other', 'daily', 'vocalization', 'core', null, null, null, null, 5, false),
  ('other', 'daily', 'social', 'core', null, null, null, null, 6, false)
) as v(species_code, scope, code, kind, options, min_value, max_value, unit, position, is_primary)
join public.species s on s.code = v.species_code;

-- ---------------------------------------------------------------------
-- 3. Columnas species_data y validación
-- ---------------------------------------------------------------------
alter table public.pets
  add column species_data jsonb not null default '{}'::jsonb,
  add constraint pets_species_data_shape_check
    check (jsonb_typeof(species_data) = 'object' and octet_length(species_data::text) <= 4096);

alter table public.daily_logs
  add column species_data jsonb not null default '{}'::jsonb,
  add constraint daily_logs_species_data_shape_check
    check (jsonb_typeof(species_data) = 'object' and octet_length(species_data::text) <= 4096);

comment on column public.pets.species_data is
  'Datos propios de la especie en la ficha (claves = species_fields.code con scope profile). Validado por validate_species_data.';
comment on column public.daily_logs.species_data is
  'Datos propios de la especie del día (claves = species_fields.code con scope daily). Validado por validate_species_data.';

-- pets usa GRANT por columna (como breed_id): sin esto, insert/update de authenticated fallarían.
grant insert (species_data), update (species_data) on table public.pets to authenticated;
-- daily_logs: save_daily_log es SECURITY INVOKER, así que quien llama necesita los mismos GRANT.
grant insert (species_data), update (species_data) on table public.daily_logs to authenticated;

-- ¿Es p_value un valor válido para un campo de este tipo? Sin acceso a tablas.
create function private.species_value_is_valid (
  p_kind    text,
  p_options text[],
  p_min     numeric,
  p_max     numeric,
  p_value   jsonb
)
  returns boolean
  language plpgsql
  stable
  set search_path = ''
  as $function$
declare
  v_num  numeric;
  v_text text;
  v_date date;
begin
  case p_kind
    when 'scale3' then
      if jsonb_typeof(p_value) <> 'number' then return false; end if;
      v_num := (p_value #>> '{}')::numeric;
      return v_num in (2, 3, 4);
    when 'boolean' then
      return jsonb_typeof(p_value) = 'boolean';
    when 'choice' then
      return jsonb_typeof(p_value) = 'string' and (p_value #>> '{}') = any (p_options);
    when 'multi_choice' then
      if jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) = 0 then return false; end if;
      if exists (select 1 from jsonb_array_elements(p_value) as e (item) where jsonb_typeof(e.item) <> 'string') then
        return false;
      end if;
      return not exists (
          select 1 from jsonb_array_elements_text(p_value) as e (item) where not (e.item = any (p_options))
        )
        and (select count(distinct e.item) = count(*) from jsonb_array_elements_text(p_value) as e (item));
    when 'integer', 'decimal' then
      if jsonb_typeof(p_value) <> 'number' then return false; end if;
      v_num := (p_value #>> '{}')::numeric;
      if p_kind = 'integer' and v_num <> trunc(v_num) then return false; end if;
      if p_kind = 'decimal' and v_num <> round(v_num, 2) then return false; end if;
      return (p_min is null or v_num >= p_min) and (p_max is null or v_num <= p_max);
    when 'date' then
      if jsonb_typeof(p_value) <> 'string' then return false; end if;
      v_text := p_value #>> '{}';
      if v_text !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
      begin
        v_date := v_text::date;
      exception when others then
        return false;
      end;
      -- Nunca futura; un día de margen por las zonas horarias por delante de UTC.
      return to_char(v_date, 'YYYY-MM-DD') = v_text
        and v_date >= date '1900-01-01'
        and v_date <= (now() at time zone 'UTC')::date + 1;
    else
      return false;
  end case;
end;
$function$;

comment on function private.species_value_is_valid(text, text[], numeric, numeric, jsonb) is
  'Valor de species_data válido para un campo del catálogo (tipo, opciones y rango). Lo usa validate_species_data.';

revoke all on function private.species_value_is_valid(text, text[], numeric, numeric, jsonb) from public, anon, authenticated;

create function public.validate_species_data()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $function$
declare
  v_scope      text;
  v_species_id uuid;
  v_old        jsonb := '{}'::jsonb;
  v_key        text;
  v_value      jsonb;
  v_field      public.species_fields%rowtype;
begin
  if tg_table_name = 'pets' then
    v_scope := 'profile';
    v_species_id := new.species_id;
    if tg_op = 'UPDATE' and new.species_id is distinct from old.species_id
       and new.species_data is not distinct from old.species_data then
      -- Cambio de especie sin datos nuevos: los de la especie anterior ya no valen.
      new.species_data := '{}'::jsonb;
      return new;
    end if;
  else
    v_scope := 'daily';
    select p.species_id into v_species_id from public.pets p where p.id = new.pet_id;
  end if;

  if tg_op = 'UPDATE' then
    if new.species_data is not distinct from old.species_data then
      return new;
    end if;
    -- En pets, con otra especie todo lo que llega es nuevo y se valida entero.
    -- (IF anidados: daily_logs no tiene species_id y PL/pgSQL no garantiza
    -- que un OR deje de evaluar la segunda parte.)
    v_old := coalesce(old.species_data, '{}'::jsonb);
    if tg_table_name = 'pets' then
      if new.species_id is distinct from old.species_id then
        v_old := '{}'::jsonb;
      end if;
    end if;
  end if;

  if new.species_data is null or jsonb_typeof(new.species_data) <> 'object' then
    raise exception 'species_data debe ser un objeto'
      using hint = 'species_data_invalid', detail = 'species_data';
  end if;

  for v_key, v_value in select e.key, e.value from jsonb_each(new.species_data) as e loop
    -- Solo lo que cambia: un dato antiguo (de otra especie o de un campo retirado) se conserva.
    if (v_old -> v_key) is not distinct from v_value then
      continue;
    end if;

    select f.* into v_field
    from public.species_fields f
    where f.species_id = v_species_id
      and f.scope = v_scope
      and f.code = v_key
      and f.kind <> 'core'
      and f.is_active;

    if not found then
      raise exception 'El campo % no existe para la especie de esta mascota', v_key
        using hint = 'species_data_invalid', detail = v_key;
    end if;

    if not private.species_value_is_valid(v_field.kind, v_field.options, v_field.min_value, v_field.max_value, v_value) then
      raise exception 'Valor no válido para el campo %', v_key
        using hint = 'species_data_invalid', detail = v_key;
    end if;
  end loop;

  return new;
end;
$function$;

revoke all on function public.validate_species_data() from public, anon, authenticated;

create trigger trg_validate_species_data
  before insert or update of species_id, species_data on public.pets
  for each row
  execute function public.validate_species_data();

create trigger trg_validate_species_data
  before insert or update of species_data on public.daily_logs
  for each row
  execute function public.validate_species_data();

-- ---------------------------------------------------------------------
-- 4. Registro no vacío: también con datos de la especie
-- ---------------------------------------------------------------------
alter table public.daily_logs
  drop constraint daily_logs_not_empty_check,
  add constraint daily_logs_not_empty_check
    check (
      num_nonnulls(
        energy_level, appetite_level, mood_level, activity_level,
        sleep_quality, vocalization_level, social_interaction_level
      ) > 0
      or unusual_behavior
      or coalesce(unusual_behavior_notes ~ '[^[:space:]]', false)
      or coalesce(notes ~ '[^[:space:]]', false)
      or coalesce(cardinality(tags), 0) > 0
      or species_data <> '{}'::jsonb
    );

-- ---------------------------------------------------------------------
-- 5. save_daily_log con p_species_data
-- ---------------------------------------------------------------------
drop function public.save_daily_log(uuid, date, smallint, smallint, smallint, smallint, smallint, smallint, smallint, boolean, text, text, text[], timestamptz, boolean);

-- SECURITY INVOKER: se ejecuta con los privilegios y la RLS de quien llama
-- (INSERT: can_edit_pet + logged_by = auth.uid(); UPDATE: can_edit_pet).
-- Sustituye el registro completo del día (todas las columnas de datos): un
-- parámetro NULL deja ese dato vacío, salvo p_species_data, donde NULL
-- conserva lo guardado. Al editar se conserva logged_by; last_edited_by y
-- updated_at los ponen los triggers. En todo lo demás, igual que la versión
-- de 20261010160332.
create function public.save_daily_log (
  p_pet_id                   uuid,
  p_log_date                 date,
  p_energy_level             smallint,
  p_appetite_level           smallint,
  p_mood_level               smallint,
  p_activity_level           smallint,
  p_sleep_quality            smallint,
  p_vocalization_level       smallint,
  p_social_interaction_level smallint,
  p_unusual_behavior         boolean,
  p_unusual_behavior_notes   text,
  p_notes                    text,
  p_tags                     text[],
  p_expected_updated_at      timestamptz default null,
  p_expect_absent            boolean     default false,
  p_species_data             jsonb       default null
)
  returns public.daily_logs
  language plpgsql
  security invoker
  set search_path to 'public'
  as $function$
declare
  v_unusual_behavior       boolean := coalesce(p_unusual_behavior, false);
  -- Texto sin espacios sobrantes; solo espacios = sin nota.
  v_unusual_behavior_notes text := nullif(btrim(p_unusual_behavior_notes, E' \t\r\n'), '');
  v_notes                  text := nullif(btrim(p_notes, E' \t\r\n'), '');
  -- Sin duplicados y en orden estable; el CHECK valida los códigos.
  v_tags                   text[] := array(select distinct tag from unnest(p_tags) as tag order by tag);
  v_expect_absent          boolean := coalesce(p_expect_absent, false);
  v_constraint             text;
  result                   public.daily_logs;
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;

  -- Error claro para viewers y no miembros, antes de cualquier comprobación
  -- de conflicto: quien no puede editar no averigua si el registro existe o
  -- ha cambiado. La autorización real es RLS.
  if not public.can_edit_pet(p_pet_id) then
    raise exception 'No tienes acceso de edición sobre esta mascota' using errcode = '42501';
  end if;

  if v_expect_absent and p_expected_updated_at is not null then
    raise exception 'p_expected_updated_at y p_expect_absent no se pueden usar a la vez'
      using errcode = '22023';
  end if;

  -- A. Editar la versión leída (comprobación atómica en el WHERE).
  if p_expected_updated_at is not null then
    update public.daily_logs
    set energy_level             = p_energy_level,
        appetite_level           = p_appetite_level,
        mood_level               = p_mood_level,
        activity_level           = p_activity_level,
        sleep_quality            = p_sleep_quality,
        vocalization_level       = p_vocalization_level,
        social_interaction_level = p_social_interaction_level,
        unusual_behavior         = v_unusual_behavior,
        unusual_behavior_notes   = v_unusual_behavior_notes,
        notes                    = v_notes,
        tags                     = v_tags,
        species_data             = coalesce(p_species_data, species_data)
    where pet_id = p_pet_id
      and log_date = p_log_date
      and updated_at = p_expected_updated_at
    returning * into result;

    if found then
      return result;
    end if;

    if not public.can_edit_pet(p_pet_id) then
      raise exception 'No tienes acceso de edición sobre esta mascota' using errcode = '42501';
    end if;

    if exists (select 1 from public.daily_logs where pet_id = p_pet_id and log_date = p_log_date) then
      raise exception 'El registro de este día ha cambiado desde que se leyó'
        using errcode = 'P0001', hint = 'daily_log_conflict', detail = 'version_mismatch';
    end if;

    raise exception 'El registro de este día ya no existe'
      using errcode = 'P0001', hint = 'daily_log_conflict', detail = 'row_missing';
  end if;

  -- B. Crear solo si no existe.
  if v_expect_absent then
    if exists (select 1 from public.daily_logs where pet_id = p_pet_id and log_date = p_log_date) then
      raise exception 'Ya existe un registro de este día'
        using errcode = 'P0001', hint = 'daily_log_conflict', detail = 'row_exists';
    end if;

    begin
      insert into public.daily_logs (
        pet_id, logged_by, log_date,
        energy_level, appetite_level, mood_level, activity_level,
        sleep_quality, vocalization_level, social_interaction_level,
        unusual_behavior, unusual_behavior_notes, notes, tags, species_data
      )
      values (
        p_pet_id, auth.uid(), p_log_date,
        p_energy_level, p_appetite_level, p_mood_level, p_activity_level,
        p_sleep_quality, p_vocalization_level, p_social_interaction_level,
        v_unusual_behavior, v_unusual_behavior_notes, v_notes, v_tags,
        coalesce(p_species_data, '{}'::jsonb)
      )
      returning * into result;

      return result;
    exception
      when unique_violation then
        get stacked diagnostics v_constraint = constraint_name;
        if v_constraint is distinct from 'daily_logs_pet_id_log_date_key' then
          raise;
        end if;
        raise exception 'Ya existe un registro de este día'
          using errcode = 'P0001', hint = 'daily_log_conflict', detail = 'row_exists';
    end;
  end if;

  -- C. Sin precondición (compatibilidad; la app no la usa).
  for attempt in 1..2 loop
    update public.daily_logs
    set energy_level             = p_energy_level,
        appetite_level           = p_appetite_level,
        mood_level               = p_mood_level,
        activity_level           = p_activity_level,
        sleep_quality            = p_sleep_quality,
        vocalization_level       = p_vocalization_level,
        social_interaction_level = p_social_interaction_level,
        unusual_behavior         = v_unusual_behavior,
        unusual_behavior_notes   = v_unusual_behavior_notes,
        notes                    = v_notes,
        tags                     = v_tags,
        species_data             = coalesce(p_species_data, species_data)
    where pet_id = p_pet_id
      and log_date = p_log_date
    returning * into result;

    if found then
      return result;
    end if;

    begin
      insert into public.daily_logs (
        pet_id, logged_by, log_date,
        energy_level, appetite_level, mood_level, activity_level,
        sleep_quality, vocalization_level, social_interaction_level,
        unusual_behavior, unusual_behavior_notes, notes, tags, species_data
      )
      values (
        p_pet_id, auth.uid(), p_log_date,
        p_energy_level, p_appetite_level, p_mood_level, p_activity_level,
        p_sleep_quality, p_vocalization_level, p_social_interaction_level,
        v_unusual_behavior, v_unusual_behavior_notes, v_notes, v_tags,
        coalesce(p_species_data, '{}'::jsonb)
      )
      returning * into result;

      return result;
    exception
      when unique_violation then
        -- Otro dispositivo creó el registro de ese día entre el UPDATE y el
        -- INSERT: se repite el UPDATE una vez.
        null;
    end;
  end loop;

  raise exception 'No se pudo guardar el registro diario';
end;
$function$;

comment on function public.save_daily_log(uuid, date, smallint, smallint, smallint, smallint, smallint, smallint, smallint, boolean, text, text, text[], timestamptz, boolean, jsonb) is
  'Crea o sustituye el registro diario de una mascota para un día (identidad: pet_id + log_date). Precondiciones opcionales: p_expected_updated_at o p_expect_absent (conflicto: P0001 + hint daily_log_conflict). p_species_data NULL = conservar lo guardado. SECURITY INVOKER: aplica RLS y grants de quien llama.';

-- Mismos permisos que la firma anterior. Una función nueva nace con EXECUTE
-- para PUBLIC y, por los default privileges de Supabase, para anon.
revoke all on function public.save_daily_log(uuid, date, smallint, smallint, smallint, smallint, smallint, smallint, smallint, boolean, text, text, text[], timestamptz, boolean, jsonb) from public, anon;
grant execute on function public.save_daily_log(uuid, date, smallint, smallint, smallint, smallint, smallint, smallint, smallint, boolean, text, text, text[], timestamptz, boolean, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 6. request_ai_analysis: solo especies con orientación validada
-- ---------------------------------------------------------------------
-- Misma firma, mismos mensajes y mismo orden que en 20261030090318; solo se
-- añade la comprobación 1b.
create or replace function public.request_ai_analysis (
  target_pet_id uuid,
  p_photo_path  text,
  symptom_ids   uuid[] default '{}'::uuid[]
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

  -- 1b) Orientación disponible para la especie (validación veterinaria, D-4).
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
  insert into public.ai_analysis_requests (pet_id, requested_by, photo_path, used_full_history, status)
  values (target_pet_id, auth.uid(), p_photo_path, entitlement.would_use_full_history, 'pending')
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

revoke all on function public.request_ai_analysis(uuid, text, uuid[]) from public, anon;
grant execute on function public.request_ai_analysis(uuid, text, uuid[]) to authenticated, service_role;
