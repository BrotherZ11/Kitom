-- =====================================================================
-- KITOM · Pruebas de pets.client_request_id (migración *_pets_client_request_id.sql)
-- =====================================================================
-- pgTAP. Solo contra la BD local: `npx supabase test db`, o
--   docker exec -i supabase_db_Kitom psql -U postgres -d postgres -f - < supabase/tests/database/pets_client_request_id.test.sql
-- Todo ocurre en una transacción que termina en ROLLBACK. Las altas de la app
-- son `insert … returning` (PostgREST `insert().select()`), como aquí.
-- Requiere el catálogo de especies (supabase/seed.sql). La concurrencia real
-- (dos altas a la vez) está en supabase/tests/concurrency/pets_client_request_id_concurrency.sh.
-- =====================================================================
begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

-- ---------------------------------------------------------------------
-- Auxiliares (se deshacen con el ROLLBACK)
-- ---------------------------------------------------------------------
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

create function test_helpers.reset_role() returns void
  language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- Alta como la de la app (insert … returning), con o sin clave. Devuelve el id.
create function test_helpers.create_pet(owner uuid, request_id uuid, pet_name text) returns uuid
  language plpgsql as $$
declare
  created uuid;
begin
  insert into public.pets (owner_id, name, species_id, client_request_id)
  select owner, pet_name, s.id, request_id from public.species s where s.code = 'dog'
  returning id into created;
  return created;
end $$;

grant execute on all functions in schema test_helpers to anon, authenticated;

insert into auth.users (id, email, aud, role) values
  ('e0000000-0000-4000-8000-000000000001', 'crid-a@example.test', 'authenticated', 'authenticated'),
  ('e0000000-0000-4000-8000-000000000002', 'crid-b@example.test', 'authenticated', 'authenticated');

-- =====================================================================
-- 1. Esquema, índice, grants y RLS
-- =====================================================================
select is(
  (select row(data_type, is_nullable, column_default)::text from information_schema.columns
   where table_schema = 'public' and table_name = 'pets' and column_name = 'client_request_id'),
  row('uuid', 'YES', null::text)::text, 'esquema: client_request_id uuid, admite NULL, sin default');
select is(
  (select indexdef from pg_indexes where schemaname = 'public' and indexname = 'pets_owner_client_request_id_key'),
  'CREATE UNIQUE INDEX pets_owner_client_request_id_key ON public.pets USING btree (owner_id, client_request_id) WHERE (client_request_id IS NOT NULL)',
  'índice: único por (owner_id, client_request_id), solo con clave');
select ok(
  has_column_privilege('authenticated', 'public.pets', 'client_request_id', 'INSERT'),
  'grants: authenticated puede insertar client_request_id');
select ok(
  not has_column_privilege('authenticated', 'public.pets', 'client_request_id', 'UPDATE'),
  'grants: authenticated NO puede actualizar client_request_id');
select ok(
  not has_column_privilege('authenticated', 'public.pets', 'id', 'INSERT'),
  'grants: authenticated sigue sin poder fijar pets.id');
select is(
  (select array_agg(policyname::text order by policyname) from pg_policies where schemaname = 'public' and tablename = 'pets'),
  array['pets: delete owner', 'pets: insert own', 'pets: select members', 'pets: update editors'],
  'rls: se mantienen las políticas de pets');

-- =====================================================================
-- 2. Altas con clave
-- =====================================================================
select test_helpers.act_as('e0000000-0000-4000-8000-000000000001');

select lives_ok(
  $$ select test_helpers.create_pet('e0000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000001', 'Luna') $$,
  'alta: con clave, como el propietario (insert … returning)');
select throws_ok(
  $$ select test_helpers.create_pet('e0000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000001', 'Luna') $$,
  '23505', null, 'reenvío: el mismo alta (misma clave) da 23505, no otra mascota');
select is(
  (select count(*)::int from public.pets where client_request_id = 'aa000000-0000-4000-8000-000000000001'),
  1, 'reenvío: queda una sola mascota con esa clave');
select is(
  (select name from public.pets
   where owner_id = 'e0000000-0000-4000-8000-000000000001' and client_request_id = 'aa000000-0000-4000-8000-000000000001'),
  'Luna', 'recuperación: el propietario lee la mascota por su clave (RLS)');
select lives_ok(
  $$ select test_helpers.create_pet('e0000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000002', 'Kira') $$,
  'alta: otra clave del mismo propietario crea otra mascota');
select lives_ok(
  $$ select test_helpers.create_pet('e0000000-0000-4000-8000-000000000001', null, 'Sin clave') $$,
  'alta sin clave (online): sin cambios');
select lives_ok(
  $$ select test_helpers.create_pet('e0000000-0000-4000-8000-000000000001', null, 'Sin clave') $$,
  'alta sin clave: varias filas con NULL no chocan');

-- La clave no se puede cambiar, ni ponerla a una mascota existente.
select throws_ok(
  $$ update public.pets set client_request_id = 'aa000000-0000-4000-8000-000000000009'
     where client_request_id = 'aa000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'update: client_request_id no se puede cambiar');
select throws_ok(
  $$ update public.pets set client_request_id = 'aa000000-0000-4000-8000-000000000009' where name = 'Sin clave' $$,
  '42501', null, 'update: no se puede añadir una clave a una mascota existente');

-- Un alta con la clave de otra cuenta no la ve ni choca con ella (ligada al propietario).
select test_helpers.act_as('e0000000-0000-4000-8000-000000000002');
select lives_ok(
  $$ select test_helpers.create_pet('e0000000-0000-4000-8000-000000000002', 'aa000000-0000-4000-8000-000000000001', 'De B') $$,
  'aislamiento: otra cuenta puede usar la misma clave (no revela la de A)');
select is(
  (select count(*)::int from public.pets where client_request_id = 'aa000000-0000-4000-8000-000000000001'),
  1, 'aislamiento: B solo ve su mascota con esa clave (RLS)');
select throws_ok(
  $$ select test_helpers.create_pet('e0000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000003', 'Suplantada') $$,
  '42501', null, 'rls: B no puede crear una mascota a nombre de A, con o sin clave');

select test_helpers.act_as_anon();
select throws_ok(
  $$ select test_helpers.create_pet('e0000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000004', 'Anon') $$,
  '42501', null, 'anon: no puede crear mascotas');

select test_helpers.reset_role();
select is(
  (select count(*)::int from public.pets where owner_id = 'e0000000-0000-4000-8000-000000000001'),
  4, 'resultado: A tiene 4 mascotas (Luna, Kira y dos sin clave), ninguna duplicada');

select * from finish();
rollback;
