-- =====================================================================
-- KITOM · Pruebas del CHECK pets_photo_path_own_pet (migración *_pets_photo_path_own_pet.sql)
-- =====================================================================
-- pgTAP. Solo contra la BD local: `npx supabase test db`, o
--   docker exec -i supabase_db_Kitom psql -U postgres -d postgres -f - < supabase/tests/database/pets_photo_path.test.sql
-- Todo ocurre en una transacción que termina en ROLLBACK. Las escrituras son
-- las de la app: el propietario (authenticated, RLS) cambia photo_path.
-- Requiere el catálogo de especies (supabase/seed.sql).
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

create function test_helpers.reset_role() returns void
  language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

grant execute on all functions in schema test_helpers to anon, authenticated;

insert into auth.users (id, email, aud, role) values
  ('e1000000-0000-4000-8000-000000000001', 'photo-a@example.test', 'authenticated', 'authenticated');

insert into public.pets (id, owner_id, name, species_id)
select v.id, 'e1000000-0000-4000-8000-000000000001', v.name, s.id
from (values
  ('e1000000-0000-4000-8000-0000000000a1'::uuid, 'Propia'),
  ('e1000000-0000-4000-8000-0000000000a2'::uuid, 'Otra del mismo dueño')) as v(id, name)
cross join public.species s where s.code = 'dog';

-- =====================================================================
-- 1. Esquema y grants (sin cambios de permisos)
-- =====================================================================
select ok(
  exists (select 1 from pg_constraint
          where conname = 'pets_photo_path_own_pet' and conrelid = 'public.pets'::regclass and contype = 'c' and convalidated),
  'esquema: CHECK pets_photo_path_own_pet, validado');
select ok(
  has_column_privilege('authenticated', 'public.pets', 'photo_path', 'UPDATE'),
  'grants: authenticated sigue pudiendo cambiar photo_path (la app lo necesita)');
select ok(
  not has_column_privilege('authenticated', 'public.pets', 'id', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.pets', 'id', 'INSERT'),
  'grants: authenticated sigue sin poder fijar ni cambiar el id');

-- =====================================================================
-- 2. Aceptados (como propietario, con RLS)
-- =====================================================================
select test_helpers.act_as('e1000000-0000-4000-8000-000000000001');

select lives_ok(
  $$update public.pets set photo_path = 'e1000000-0000-4000-8000-0000000000a1/0b6f3c2e-8a4d-4f1e-9c7b-2d5e6f708192.jpg'
    where id = 'e1000000-0000-4000-8000-0000000000a1'$$,
  'acepta: {id propio}/{uuid}.jpg (lo que genera la app)');
select lives_ok(
  $$update public.pets set photo_path = 'e1000000-0000-4000-8000-0000000000a1/p1.jpg'
    where id = 'e1000000-0000-4000-8000-0000000000a1'$$,
  'acepta: {id propio}/{nombre corto}.jpg');
select lives_ok(
  $$update public.pets set photo_path = null where id = 'e1000000-0000-4000-8000-0000000000a1'$$,
  'acepta: NULL (sin foto)');
select lives_ok(
  $$update public.pets set name = 'Propia 2' where id = 'e1000000-0000-4000-8000-0000000000a1'$$,
  'acepta: cambiar otra columna de una mascota sin foto');

-- =====================================================================
-- 3. Rechazados (23514, el CHECK), uno por forma
-- =====================================================================
select throws_ok(
  $$update public.pets set photo_path = 'e1000000-0000-4000-8000-0000000000a2/0b6f3c2e-8a4d-4f1e-9c7b-2d5e6f708192.jpg'
    where id = 'e1000000-0000-4000-8000-0000000000a1'$$,
  '23514', null, 'rechaza: la carpeta de otra mascota (aunque sea del mismo dueño)');
select throws_ok(
  $$update public.pets set photo_path = 'E1000000-0000-4000-8000-0000000000A1/x.jpg'
    where id = 'e1000000-0000-4000-8000-0000000000a1'$$,
  '23514', null, 'rechaza: el propio id en mayúsculas (las políticas lo aceptarían como la misma mascota)');
select throws_ok(
  $$update public.pets set photo_path = 'e1000000-0000-4000-8000-0000000000a1/sub/x.jpg'
    where id = 'e1000000-0000-4000-8000-0000000000a1'$$,
  '23514', null, 'rechaza: subcarpetas');
select throws_ok(
  $$update public.pets set photo_path = 'e1000000-0000-4000-8000-0000000000a1/../e1000000-0000-4000-8000-0000000000a2/x.jpg'
    where id = 'e1000000-0000-4000-8000-0000000000a1'$$,
  '23514', null, 'rechaza: segmentos ..');
select throws_ok(
  $$update public.pets set photo_path = 'e1000000-0000-4000-8000-0000000000a1/x.png'
    where id = 'e1000000-0000-4000-8000-0000000000a1'$$,
  '23514', null, 'rechaza: otra extensión');
select throws_ok(
  $$update public.pets set photo_path = 'e1000000-0000-4000-8000-0000000000a1/x.JPG'
    where id = 'e1000000-0000-4000-8000-0000000000a1'$$,
  '23514', null, 'rechaza: .JPG (la app solo genera .jpg)');
select throws_ok(
  $$update public.pets set photo_path = 'e1000000-0000-4000-8000-0000000000a1/-x.jpg'
    where id = 'e1000000-0000-4000-8000-0000000000a1'$$,
  '23514', null, 'rechaza: nombre que empieza por -');
select throws_ok(
  $$update public.pets set photo_path = 'e1000000-0000-4000-8000-0000000000a1/' || repeat('a', 129) || '.jpg'
    where id = 'e1000000-0000-4000-8000-0000000000a1'$$,
  '23514', null, 'rechaza: nombre de más de 128 caracteres');
select throws_ok(
  $$update public.pets set photo_path = 'e1000000-0000-4000-8000-0000000000a1/.jpg'
    where id = 'e1000000-0000-4000-8000-0000000000a1'$$,
  '23514', null, 'rechaza: nombre vacío');
select throws_ok(
  $$update public.pets set photo_path = 'x.jpg' where id = 'e1000000-0000-4000-8000-0000000000a1'$$,
  '23514', null, 'rechaza: sin carpeta');
select throws_ok(
  $$update public.pets set photo_path = 'e1000000-0000-4000-8000-0000000000a1x.jpg'
    where id = 'e1000000-0000-4000-8000-0000000000a1'$$,
  '23514', null, 'rechaza: el id sin barra');
select throws_ok(
  $$update public.pets set photo_path = 'https://example.test/e1000000-0000-4000-8000-0000000000a1/x.jpg'
    where id = 'e1000000-0000-4000-8000-0000000000a1'$$,
  '23514', null, 'rechaza: una URL');
select throws_ok(
  $$update public.pets set photo_path = 'e1000000-0000-4000-8000-0000000000a1/x.jpg '
    where id = 'e1000000-0000-4000-8000-0000000000a1'$$,
  '23514', null, 'rechaza: espacios al final');

select test_helpers.reset_role();

-- =====================================================================
-- 4. Alta: solo con el id de la fila nueva (la app nunca da foto al crear)
-- =====================================================================
select lives_ok(
  $$insert into public.pets (id, owner_id, name, species_id, photo_path)
    select 'e1000000-0000-4000-8000-0000000000a3', 'e1000000-0000-4000-8000-000000000001', 'Con foto', s.id,
           'e1000000-0000-4000-8000-0000000000a3/a.jpg'
    from public.species s where s.code = 'dog'$$,
  'alta: acepta una foto de la propia fila nueva');
select throws_ok(
  $$insert into public.pets (id, owner_id, name, species_id, photo_path)
    select 'e1000000-0000-4000-8000-0000000000a4', 'e1000000-0000-4000-8000-000000000001', 'Ajena', s.id,
           'e1000000-0000-4000-8000-0000000000a1/a.jpg'
    from public.species s where s.code = 'dog'$$,
  '23514', null, 'alta: rechaza la foto de otra mascota');

select * from finish();
rollback;
