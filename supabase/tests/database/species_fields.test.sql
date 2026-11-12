-- =====================================================================
-- KITOM · Pruebas de campos por especie (migración *_species_fields.sql)
-- =====================================================================
-- pgTAP. Solo contra la BD local: `npx supabase test db`. Todo ocurre en una
-- transacción que termina en ROLLBACK.
-- =====================================================================
begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

create schema test_helpers;
grant usage on schema test_helpers to anon, authenticated;

create function test_helpers.act_as(uid uuid) returns void
  language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create function test_helpers.act_as_anon() returns void
  language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
end $$;

-- 'ok' o 'SQLSTATE|hint|detail' de una sentencia.
create function test_helpers.try(p_sql text) returns text
  language plpgsql security invoker as $$
declare
  v_state  text;
  v_hint   text;
  v_detail text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics
    v_state  = returned_sqlstate,
    v_hint   = pg_exception_hint,
    v_detail = pg_exception_detail;
  return concat_ws('|', v_state, nullif(v_hint, ''), nullif(v_detail, ''));
end $$;

-- Guardar un registro con datos de especie (y nada más que energía).
create function test_helpers.save_species(p_pet uuid, p_date date, p_data jsonb, p_energy smallint default null)
  returns public.daily_logs
  language sql security invoker as $$
  select * from public.save_daily_log(
    p_pet, p_date, p_energy, null, null, null, null, null, null,
    false, null, null, '{}', null, false, p_data)
$$;

grant execute on all functions in schema test_helpers to anon, authenticated;

-- Usuarios: A owner · E editor · V viewer · O ajeno
insert into auth.users (id, email, aud, role) values
  ('a1000000-0000-4000-8000-000000000001', 'sf-owner@example.test',    'authenticated', 'authenticated'),
  ('a1000000-0000-4000-8000-000000000002', 'sf-editor@example.test',   'authenticated', 'authenticated'),
  ('a1000000-0000-4000-8000-000000000003', 'sf-viewer@example.test',   'authenticated', 'authenticated'),
  ('a1000000-0000-4000-8000-000000000004', 'sf-outsider@example.test', 'authenticated', 'authenticated');

update public.profiles set disclaimer_accepted_at = now()
where id = 'a1000000-0000-4000-8000-000000000001';

-- Mascotas de A: D (perro), C (gato), R (conejo), T (reptil)
insert into public.pets (id, owner_id, name, species_id)
select v.id::uuid, 'a1000000-0000-4000-8000-000000000001', v.name, s.id
from (values
  ('b1000000-0000-4000-8000-000000000001', 'D', 'dog'),
  ('b1000000-0000-4000-8000-000000000002', 'C', 'cat'),
  ('b1000000-0000-4000-8000-000000000003', 'R', 'rabbit'),
  ('b1000000-0000-4000-8000-000000000004', 'T', 'reptile_other')
) as v(id, name, code)
join public.species s on s.code = v.code;

insert into public.pet_co_owners (pet_id, user_id, invited_by, role, status, accepted_at) values
  ('b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'editor', 'accepted', now()),
  ('b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'viewer', 'accepted', now());

-- ---------------------------------------------------------------------
-- 1. Catálogo
-- ---------------------------------------------------------------------
select is((select count(*)::int from public.species where is_active), 9, 'las 9 especies están activas');
select results_eq(
  $$ select code::text collate "default" from public.species where ai_guidance_enabled order by code $$,
  $$ values ('cat'::text), ('dog'::text) $$,
  'orientación con IA solo para perro y gato');
select is((select count(*)::int from public.species_fields), 144, '144 filas en el catálogo (paridad con la app)');
select is(
  (select count(*)::int from public.species_fields f join public.species s on s.id = f.species_id
   where s.code = 'reptile_other' and f.kind = 'core'), 3,
  'reptil: solo energía, apetito y actividad');
select is(
  (select count(*)::int from public.species_fields f join public.species s on s.id = f.species_id
   where s.code = 'dog' and f.kind = 'core' and f.is_primary), 4,
  'perro: 4 escalas principales, como antes');
select is(
  (select max(c)::int from (
     select count(*) as c from public.species_fields where scope = 'daily' and kind <> 'core' group by species_id
   ) x), 6, 'como mucho 6 campos diarios propios por especie');
select is(
  (select count(*)::int from (
     select code from public.species_fields where kind <> 'core'
     group by code having count(distinct kind) > 1 or count(distinct coalesce(options::text, '')) > 1
       or count(distinct coalesce(unit, '')) > 1
   ) x), 0, 'un mismo código significa lo mismo en todas las especies');
select is(
  (select value from public.catalog_translations ct join public.species s on s.id = ct.entity_id
   where s.code = 'bird_other' and ct.locale = 'es' and ct.field = 'name'), 'Ave',
  '«Ave (otra)» pasa a «Ave»');

select test_helpers.act_as_anon();
select is(split_part(test_helpers.try('select * from public.species_fields'), '|', 1), '42501', 'anon no lee el catálogo');
reset role;

select test_helpers.act_as('a1000000-0000-4000-8000-000000000004');
select ok((select count(*) from public.species_fields) = 144, 'authenticated lee el catálogo');
reset role;

-- ---------------------------------------------------------------------
-- 2. Ficha: pets.species_data
-- ---------------------------------------------------------------------
select test_helpers.act_as('a1000000-0000-4000-8000-000000000001');

select is(test_helpers.try($$
  update public.pets set species_data = '{"microchip":"yes","meals_per_day":2,"lives_with":["children","cats"]}'
  where id = 'b1000000-0000-4000-8000-000000000001' $$), 'ok', 'perro: datos válidos');
select is((select species_data->>'microchip' from public.pets where id = 'b1000000-0000-4000-8000-000000000001'),
  'yes', 'se guardan');

select is(test_helpers.try($$
  update public.pets set species_data = '{"litter_boxes":2}' where id = 'b1000000-0000-4000-8000-000000000001' $$),
  'P0001|species_data_invalid|litter_boxes', 'campo de gato en un perro');
select is(test_helpers.try($$
  update public.pets set species_data = '{"microchip":"maybe"}' where id = 'b1000000-0000-4000-8000-000000000001' $$),
  'P0001|species_data_invalid|microchip', 'opción inexistente');
select is(test_helpers.try($$
  update public.pets set species_data = '{"meals_per_day":7}' where id = 'b1000000-0000-4000-8000-000000000001' $$),
  'P0001|species_data_invalid|meals_per_day', 'fuera de rango');
select is(test_helpers.try($$
  update public.pets set species_data = '{"meals_per_day":2.5}' where id = 'b1000000-0000-4000-8000-000000000001' $$),
  'P0001|species_data_invalid|meals_per_day', 'entero con decimales');
select is(test_helpers.try($$
  update public.pets set species_data = '{"meals_per_day":"2"}' where id = 'b1000000-0000-4000-8000-000000000001' $$),
  'P0001|species_data_invalid|meals_per_day', 'tipo incorrecto');
select is(test_helpers.try($$
  update public.pets set species_data = '{"lives_with":["cats","cats"]}' where id = 'b1000000-0000-4000-8000-000000000001' $$),
  'P0001|species_data_invalid|lives_with', 'multi_choice con repetidos');
select is(test_helpers.try($$
  update public.pets set species_data = '{"lives_with":[]}' where id = 'b1000000-0000-4000-8000-000000000001' $$),
  'P0001|species_data_invalid|lives_with', 'multi_choice vacío');
select is(test_helpers.try($$
  update public.pets set species_data = '[]' where id = 'b1000000-0000-4000-8000-000000000001' $$),
  'P0001|species_data_invalid|species_data', 'species_data debe ser un objeto');
select is(test_helpers.try($$
  update public.pets set species_data = '{"energy":3}' where id = 'b1000000-0000-4000-8000-000000000001' $$),
  'P0001|species_data_invalid|energy', 'una escala común no es un campo de species_data');

select is(test_helpers.try($$
  update public.pets set species_data = '{"basking_temp":32.5,"uvb_changed_on":"2026-01-15","reptile_diet":"insectivore"}'
  where id = 'b1000000-0000-4000-8000-000000000004' $$), 'ok', 'reptil: decimal y fecha válidos');
select is(test_helpers.try($$
  update public.pets set species_data = '{"basking_temp":32.555}' where id = 'b1000000-0000-4000-8000-000000000004' $$),
  'P0001|species_data_invalid|basking_temp', 'decimal con 3 decimales');
select is(test_helpers.try($$
  update public.pets set species_data = '{"uvb_changed_on":"2999-01-01"}' where id = 'b1000000-0000-4000-8000-000000000004' $$),
  'P0001|species_data_invalid|uvb_changed_on', 'fecha futura');
select is(test_helpers.try($$
  update public.pets set species_data = '{"uvb_changed_on":"2026-02-30"}' where id = 'b1000000-0000-4000-8000-000000000004' $$),
  'P0001|species_data_invalid|uvb_changed_on', 'fecha inexistente');

select is(test_helpers.try($$
  insert into public.pets (owner_id, name, species_id, species_data)
  select 'a1000000-0000-4000-8000-000000000001', 'G', id, '{"housing":"pen","companions":1}' from public.species where code = 'guinea_pig' $$),
  'ok', 'alta con datos de especie');
select is(test_helpers.try($$
  insert into public.pets (owner_id, name, species_id, species_data)
  select 'a1000000-0000-4000-8000-000000000001', 'G2', id, '{"walks_per_day":2}' from public.species where code = 'guinea_pig' $$),
  'P0001|species_data_invalid|walks_per_day', 'alta con un campo de otra especie');

-- Cambio de especie sin datos nuevos: se vacía.
update public.pets set species_id = (select id from public.species where code = 'cat')
where id = 'b1000000-0000-4000-8000-000000000001';
select is((select species_data from public.pets where id = 'b1000000-0000-4000-8000-000000000001'),
  '{}'::jsonb, 'cambiar la especie vacía species_data');
-- Cambio de especie con datos nuevos: se validan contra la nueva.
select is(test_helpers.try($$
  update public.pets set species_id = (select id from public.species where code = 'dog'), species_data = '{"training":"basic"}'
  where id = 'b1000000-0000-4000-8000-000000000001' $$), 'ok', 'cambio de especie con datos de la nueva');
select is(test_helpers.try($$
  update public.pets set species_id = (select id from public.species where code = 'cat'), species_data = '{"training":"none"}'
  where id = 'b1000000-0000-4000-8000-000000000001' $$),
  'P0001|species_data_invalid|training', 'cambio de especie con datos de la anterior: rechazado');
reset role;

-- Viewer: lee, no escribe (GRANT + RLS).
select test_helpers.act_as('a1000000-0000-4000-8000-000000000003');
select is((select species_data->>'training' from public.pets where id = 'b1000000-0000-4000-8000-000000000001'),
  'basic', 'el viewer lee species_data');
update public.pets set species_data = '{"training":"advanced"}' where id = 'b1000000-0000-4000-8000-000000000001';
reset role;
select is((select species_data->>'training' from public.pets where id = 'b1000000-0000-4000-8000-000000000001'),
  'basic', 'el viewer no lo cambia (RLS)');

-- Editor: puede editarlo.
select test_helpers.act_as('a1000000-0000-4000-8000-000000000002');
select is(test_helpers.try($$
  update public.pets set species_data = '{"training":"advanced"}' where id = 'b1000000-0000-4000-8000-000000000001' $$),
  'ok', 'el editor lo edita');
reset role;

-- ---------------------------------------------------------------------
-- 3. Registro diario: daily_logs.species_data
-- ---------------------------------------------------------------------
select test_helpers.act_as('a1000000-0000-4000-8000-000000000001');

select is(test_helpers.try($$ select test_helpers.save_species('b1000000-0000-4000-8000-000000000001',
  (now() at time zone 'UTC')::date, '{"walks":2,"water":3,"stool":"normal","vomit":false}') $$),
  'ok', 'perro: registro solo con datos de especie (no vacío)');
select is(test_helpers.try($$ select test_helpers.save_species('b1000000-0000-4000-8000-000000000001',
  (now() at time zone 'UTC')::date - 1, '{"water":5}') $$),
  'P0001|species_data_invalid|water', 'scale3 fuera de 2/3/4');
select is(test_helpers.try($$ select test_helpers.save_species('b1000000-0000-4000-8000-000000000001',
  (now() at time zone 'UTC')::date - 1, '{"hay_eaten":"usual"}') $$),
  'P0001|species_data_invalid|hay_eaten', 'campo diario de conejo en un perro');
select is(test_helpers.try($$ select test_helpers.save_species('b1000000-0000-4000-8000-000000000001',
  (now() at time zone 'UTC')::date - 1, '{"microchip":"yes"}') $$),
  'P0001|species_data_invalid|microchip', 'un campo de la ficha no vale en el registro');
select is(test_helpers.try($$ select test_helpers.save_species('b1000000-0000-4000-8000-000000000001',
  (now() at time zone 'UTC')::date - 1, '{}') $$),
  '23514', 'registro vacío (sin nada) sigue rechazado');

-- NULL = conservar (llamada de una app antigua, 15 argumentos).
select public.save_daily_log(
  'b1000000-0000-4000-8000-000000000001', (now() at time zone 'UTC')::date,
  3::smallint, null, null, null, null, null, null, false, null, null, '{}');
select is((select species_data->>'stool' from public.daily_logs
  where pet_id = 'b1000000-0000-4000-8000-000000000001' and log_date = (now() at time zone 'UTC')::date),
  'normal', 'sin p_species_data se conserva lo guardado');

-- '{}' = vaciar.
select test_helpers.save_species('b1000000-0000-4000-8000-000000000001', (now() at time zone 'UTC')::date, '{}', 3::smallint);
select is((select species_data from public.daily_logs
  where pet_id = 'b1000000-0000-4000-8000-000000000001' and log_date = (now() at time zone 'UTC')::date),
  '{}'::jsonb, 'con {} se vacía');

-- Conejo
select is(test_helpers.try($$ select test_helpers.save_species('b1000000-0000-4000-8000-000000000003',
  (now() at time zone 'UTC')::date, '{"hay_eaten":"less","droppings":"fewer","hunched":true}', 3::smallint) $$),
  'ok', 'conejo: campos propios');

-- Un texto largo nunca llega a guardarse: no hay campos de texto libre (el
-- CHECK de 4096 bytes es la red de seguridad si algún día los hubiera).
select is(test_helpers.try(format($$ select test_helpers.save_species('b1000000-0000-4000-8000-000000000003',
  (now() at time zone 'UTC')::date - 1, %L) $$, jsonb_build_object('hay_eaten', repeat('x', 5000))::text)),
  'P0001|species_data_invalid|hay_eaten', 'un texto largo en species_data: rechazado');
reset role;
select is(test_helpers.try($$ update public.daily_logs set species_data = jsonb_build_object('x', repeat('x', 5000))
  where pet_id = 'b1000000-0000-4000-8000-000000000003' $$),
  'P0001|species_data_invalid|x', 'ni siquiera como postgres se salta la validación');
select test_helpers.act_as('a1000000-0000-4000-8000-000000000001');
reset role;

-- Datos de otra especie en un registro antiguo: se conservan y el registro se sigue editando.
select test_helpers.act_as('a1000000-0000-4000-8000-000000000001');
update public.pets set species_id = (select id from public.species where code = 'cat'), species_data = '{}'
where id = 'b1000000-0000-4000-8000-000000000003';
select is(test_helpers.try($$ select public.save_daily_log(
  'b1000000-0000-4000-8000-000000000003', (now() at time zone 'UTC')::date,
  4::smallint, null, null, null, null, null, null, false, null, null, '{}') $$),
  'ok', 'tras cambiar la especie, el registro antiguo se edita sin tocar sus datos');
select is((select species_data->>'hay_eaten' from public.daily_logs
  where pet_id = 'b1000000-0000-4000-8000-000000000003' and log_date = (now() at time zone 'UTC')::date),
  'less', 'los datos de la especie anterior se conservan');
select is(test_helpers.try($$ select test_helpers.save_species('b1000000-0000-4000-8000-000000000003',
  (now() at time zone 'UTC')::date, '{"hay_eaten":"less","droppings":"fewer","hunched":true,"hiding":true}', 4::smallint) $$),
  'ok', 'añadir un campo de la especie nueva sin tocar los antiguos');
select is(test_helpers.try($$ select test_helpers.save_species('b1000000-0000-4000-8000-000000000003',
  (now() at time zone 'UTC')::date, '{"hay_eaten":"none"}', 4::smallint) $$),
  'P0001|species_data_invalid|hay_eaten', 'cambiar un dato de la especie anterior: rechazado');
reset role;

-- Viewer: lee los datos del día, no guarda.
select test_helpers.act_as('a1000000-0000-4000-8000-000000000003');
select is(test_helpers.try($$ select test_helpers.save_species('b1000000-0000-4000-8000-000000000001',
  (now() at time zone 'UTC')::date, '{"water":2}', 3::smallint) $$), '42501', 'el viewer no guarda');
reset role;

-- Ajeno: no ve nada.
select test_helpers.act_as('a1000000-0000-4000-8000-000000000004');
select is((select count(*)::int from public.daily_logs where pet_id = 'b1000000-0000-4000-8000-000000000001'),
  0, 'un ajeno no ve los registros');
select is((select count(*)::int from public.pets where id = 'b1000000-0000-4000-8000-000000000001'),
  0, 'un ajeno no ve la ficha');
reset role;

-- ---------------------------------------------------------------------
-- 4. Orientación con IA por especie
-- ---------------------------------------------------------------------
select test_helpers.act_as('a1000000-0000-4000-8000-000000000001');
select is(test_helpers.try($$ select public.request_ai_analysis('b1000000-0000-4000-8000-000000000004', null, '{}') $$),
  'P0001|ai_species_unsupported', 'reptil: sin orientación con IA');
select is(test_helpers.try($$ select public.request_ai_analysis('b1000000-0000-4000-8000-000000000002', null, '{}') $$),
  'ok', 'gato: orientación disponible');
reset role;

select * from finish();
rollback;
