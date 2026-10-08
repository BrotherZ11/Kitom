-- =====================================================================
-- KITOM · Pruebas de daily_logs (migración *_daily_logs_fixes.sql)
-- =====================================================================
-- pgTAP. Solo contra la BD local: `npx supabase test db`, o
--   docker exec -i supabase_db_Kitom psql -U postgres -d postgres -f - < supabase/tests/database/daily_logs.test.sql
-- Todo ocurre en una transacción que termina en ROLLBACK: no deja usuarios,
-- mascotas, registros ni el esquema auxiliar test_helpers.
-- Requiere los catálogos de supabase/seed.sql (especie dog, logros).
-- =====================================================================
begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

-- ---------------------------------------------------------------------
-- Auxiliares (se deshacen con el ROLLBACK)
-- ---------------------------------------------------------------------
create schema test_helpers;
grant usage on schema test_helpers to anon, authenticated;

-- "Hoy" de un propietario con timezone por defecto (UTC).
create function test_helpers.today() returns date
  language sql stable as $$ select (now() at time zone 'UTC')::date $$;

-- Actuar como un usuario autenticado (lo que hace PostgREST con un JWT).
-- Llamar siempre como postgres (después de `reset role`).
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

-- Backend (Edge Functions): auth.role() = 'service_role'. Se usa para
-- sembrar historiales de más de 7 días en las pruebas de rachas.
create function test_helpers.act_as_service() returns void
  language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end $$;

-- postgres sin JWT: auth.role() = NULL (los triggers no se saltan nada).
create function test_helpers.act_as_postgres() returns void
  language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
end $$;

-- Atajo de la RPC con parámetros opcionales (la RPC real exige todos).
create function test_helpers.save(
  p_pet uuid, p_date date,
  p_mood smallint default null, p_energy smallint default null,
  p_unusual boolean default false, p_unusual_notes text default null,
  p_notes text default null, p_tags text[] default '{}'
) returns public.daily_logs
  language sql security invoker as $$
  select * from public.save_daily_log(
    p_pet, p_date, p_energy, null, p_mood, null, null, null, null,
    p_unusual, p_unusual_notes, p_notes, p_tags)
$$;

grant execute on all functions in schema test_helpers to anon, authenticated;

-- Usuarios: A owner · E editor · V viewer · O ajeno · S owner de rachas
insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-4000-8000-000000000001', 'dl-owner@example.test',    'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-000000000002', 'dl-editor@example.test',   'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-000000000003', 'dl-viewer@example.test',   'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-000000000004', 'dl-outsider@example.test', 'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-000000000005', 'dl-streaks@example.test',  'authenticated', 'authenticated');

-- Mascotas: P y P2 de A; S1..S4, M, C, C2 de S
insert into public.pets (id, owner_id, name, species_id)
select v.id::uuid, v.owner::uuid, v.name, s.id
from (values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'P'),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'P2'),
  ('b0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000005', 'S1'),
  ('b0000000-0000-4000-8000-000000000012', 'a0000000-0000-4000-8000-000000000005', 'S2'),
  ('b0000000-0000-4000-8000-000000000013', 'a0000000-0000-4000-8000-000000000005', 'S3'),
  ('b0000000-0000-4000-8000-000000000014', 'a0000000-0000-4000-8000-000000000005', 'S4'),
  ('b0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000005', 'M'),
  ('b0000000-0000-4000-8000-000000000021', 'a0000000-0000-4000-8000-000000000005', 'C'),
  ('b0000000-0000-4000-8000-000000000022', 'a0000000-0000-4000-8000-000000000005', 'C2')
) as v(id, owner, name)
cross join public.species s
where s.code = 'dog';

insert into public.pet_co_owners (pet_id, user_id, invited_by, role, status, accepted_at) values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'editor', 'accepted', now()),
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'viewer', 'accepted', now());

-- =====================================================================
-- 1. Catálogo de logros
-- =====================================================================
select is(
  (select count(*)::int from public.achievements_catalog where code in ('first_log', 'streak_7', 'streak_30')),
  3, 'catálogo: existen first_log, streak_7 y streak_30');

-- =====================================================================
-- 2. Grants y RPC (como postgres)
-- =====================================================================
select ok(not has_table_privilege('anon', 'public.daily_logs',
  'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  'grants: anon no tiene ningún privilegio sobre daily_logs');
select ok(not exists (
    select 1 from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'daily_logs' and grantee = 'anon'),
  'grants: anon no tiene privilegios por columna');
select ok(not has_table_privilege('authenticated', 'public.daily_logs', 'TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  'grants: authenticated sin TRUNCATE/REFERENCES/TRIGGER/MAINTAIN');
select ok(has_table_privilege('authenticated', 'public.daily_logs', 'SELECT')
      and has_table_privilege('authenticated', 'public.daily_logs', 'DELETE'),
  'grants: authenticated conserva SELECT y DELETE');
select is(
  (select array_agg(column_name::text order by column_name) from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'daily_logs' and grantee = 'authenticated' and privilege_type = 'UPDATE'),
  array['activity_level', 'appetite_level', 'energy_level', 'mood_level', 'notes', 'sleep_quality',
        'social_interaction_level', 'tags', 'unusual_behavior', 'unusual_behavior_notes', 'vocalization_level'],
  'grants: UPDATE solo de columnas de datos (sin id, pet_id, logged_by, log_date, timestamps, last_edited_by)');
select is(
  (select array_agg(column_name::text order by column_name) from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'daily_logs' and grantee = 'authenticated' and privilege_type = 'INSERT'),
  array['activity_level', 'appetite_level', 'energy_level', 'log_date', 'logged_by', 'mood_level', 'notes', 'pet_id',
        'sleep_quality', 'social_interaction_level', 'tags', 'unusual_behavior', 'unusual_behavior_notes', 'vocalization_level'],
  'grants: INSERT sin id, created_at, updated_at ni last_edited_by');
select ok(not has_function_privilege('anon',
  'public.save_daily_log(uuid, date, smallint, smallint, smallint, smallint, smallint, smallint, smallint, boolean, text, text, text[])', 'EXECUTE'),
  'rpc: anon (ni PUBLIC) no puede ejecutar save_daily_log');
select ok(has_function_privilege('authenticated',
  'public.save_daily_log(uuid, date, smallint, smallint, smallint, smallint, smallint, smallint, smallint, boolean, text, text, text[])', 'EXECUTE'),
  'rpc: authenticated puede ejecutar save_daily_log');
select ok(not (select prosecdef from pg_proc where oid = 'public.save_daily_log(uuid, date, smallint, smallint, smallint, smallint, smallint, smallint, smallint, boolean, text, text, text[])'::regprocedure),
  'rpc: save_daily_log es SECURITY INVOKER');
select is(
  (select array_agg(policyname::text order by policyname) from pg_policies where schemaname = 'public' and tablename = 'daily_logs'),
  array['daily_logs: delete editors', 'daily_logs: insert editors', 'daily_logs: select members', 'daily_logs: update editors'],
  'rls: se mantienen las cuatro políticas');

-- =====================================================================
-- 3. Logro ausente: award_pet_achievement no rompe
-- =====================================================================
update public.achievements_catalog set code = 'first_log__disabled' where code = 'first_log';
select test_helpers.act_as('a0000000-0000-4000-8000-000000000005');
select lives_ok($$ select test_helpers.save('b0000000-0000-4000-8000-000000000031', test_helpers.today(), 3::smallint) $$,
  'logros: guardar con first_log ausente del catálogo no falla');
reset role;
select is((select count(*)::int from public.pet_achievements where pet_id = 'b0000000-0000-4000-8000-000000000031'),
  0, 'logros: sin first_log en el catálogo no se otorga nada');
select is((select current_streak from public.pet_streaks where pet_id = 'b0000000-0000-4000-8000-000000000031'),
  1, 'logros: la racha se calcula igualmente');
update public.achievements_catalog set code = 'first_log' where code = 'first_log__disabled';

-- =====================================================================
-- 4. anon
-- =====================================================================
select test_helpers.act_as_anon();
select throws_ok($$ select count(*) from public.daily_logs $$, '42501', null, 'anon: no puede leer');
select throws_ok($$ insert into public.daily_logs (pet_id, log_date, mood_level)
                    values ('b0000000-0000-4000-8000-000000000001', current_date, 3) $$,
  '42501', null, 'anon: no puede insertar');
select throws_ok($$ select public.save_daily_log('b0000000-0000-4000-8000-000000000001', current_date,
                    null, null, 3::smallint, null, null, null, null, false, null, null, '{}') $$,
  '42501', null, 'anon: no puede ejecutar la RPC');
reset role;

-- =====================================================================
-- 5. CRUD del owner (A sobre P)
-- =====================================================================
select test_helpers.act_as('a0000000-0000-4000-8000-000000000001');
select is((select row(logged_by, last_edited_by, mood_level)::text
           from test_helpers.save('b0000000-0000-4000-8000-000000000001', test_helpers.today(), 4::smallint)),
  row('a0000000-0000-4000-8000-000000000001'::uuid, null::uuid, 4::smallint)::text,
  'owner crea: devuelve la fila con logged_by = owner y sin last_edited_by');
select is((select row(logged_by, last_edited_by, mood_level, energy_level)::text
           from test_helpers.save('b0000000-0000-4000-8000-000000000001', test_helpers.today(), 2::smallint, 5::smallint)),
  row('a0000000-0000-4000-8000-000000000001'::uuid, 'a0000000-0000-4000-8000-000000000001'::uuid, 2::smallint, 5::smallint)::text,
  'owner guarda otra vez el mismo día: actualiza, mantiene logged_by y pone last_edited_by');
select is((select count(*)::int from public.daily_logs
           where pet_id = 'b0000000-0000-4000-8000-000000000001' and log_date = test_helpers.today()),
  1, 'upsert: no crea duplicados');
select results_eq($$ with u as (update public.daily_logs set notes = 'Paseo largo'
                    where pet_id = 'b0000000-0000-4000-8000-000000000001' and log_date = test_helpers.today()
                    returning 1) select count(*)::int from u $$,
  array[1], 'owner edita con UPDATE directo de una columna de datos');
select results_eq($$ with d as (delete from public.daily_logs
                    where pet_id = 'b0000000-0000-4000-8000-000000000001' and log_date = test_helpers.today()
                    returning 1) select count(*)::int from d $$,
  array[1], 'owner borra');
-- Registro del owner para las pruebas del editor
select lives_ok($$ select test_helpers.save('b0000000-0000-4000-8000-000000000001', test_helpers.today(), 3::smallint) $$,
  'owner crea el registro de hoy (para el editor)');
reset role;

-- =====================================================================
-- 6. Editor (E sobre P)
-- =====================================================================
select test_helpers.act_as('a0000000-0000-4000-8000-000000000002');
select is((select logged_by from test_helpers.save('b0000000-0000-4000-8000-000000000001', test_helpers.today() - 1, 3::smallint)),
  'a0000000-0000-4000-8000-000000000002'::uuid, 'editor crea: logged_by = editor');
select is((select row(logged_by, last_edited_by, mood_level)::text
           from test_helpers.save('b0000000-0000-4000-8000-000000000001', test_helpers.today(), 5::smallint)),
  row('a0000000-0000-4000-8000-000000000001'::uuid, 'a0000000-0000-4000-8000-000000000002'::uuid, 5::smallint)::text,
  'editor edita el registro del owner: logged_by sigue siendo el owner, last_edited_by = editor');
select results_eq($$ with u as (update public.daily_logs set notes = 'Editado por E'
                    where pet_id = 'b0000000-0000-4000-8000-000000000001' and log_date = test_helpers.today() - 1
                    returning 1) select count(*)::int from u $$,
  array[1], 'editor edita con UPDATE directo');
select results_eq($$ with d as (delete from public.daily_logs
                    where pet_id = 'b0000000-0000-4000-8000-000000000001' and log_date = test_helpers.today()
                    returning 1) select count(*)::int from d $$,
  array[1], 'editor borra el registro creado por el owner');
reset role;

-- =====================================================================
-- 7. Viewer (V sobre P) y usuario ajeno (O)
-- =====================================================================
select test_helpers.act_as('a0000000-0000-4000-8000-000000000003');
select is((select count(*)::int from public.daily_logs where pet_id = 'b0000000-0000-4000-8000-000000000001'),
  1, 'viewer lee los registros de la mascota');
select throws_ok($$ select test_helpers.save('b0000000-0000-4000-8000-000000000001', test_helpers.today(), 3::smallint) $$,
  '42501', null, 'viewer no crea con la RPC');
select throws_ok($$ select test_helpers.save('b0000000-0000-4000-8000-000000000001', test_helpers.today() - 1, 1::smallint) $$,
  '42501', null, 'viewer no edita con la RPC');
select throws_ok($$ insert into public.daily_logs (pet_id, logged_by, log_date, mood_level)
                    values ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003', current_date, 3) $$,
  '42501', null, 'viewer no crea con INSERT directo (RLS)');
select results_eq($$ with u as (update public.daily_logs set mood_level = 1
                    where pet_id = 'b0000000-0000-4000-8000-000000000001' returning 1) select count(*)::int from u $$,
  array[0], 'viewer no edita con UPDATE directo (RLS filtra la fila)');
select results_eq($$ with d as (delete from public.daily_logs
                    where pet_id = 'b0000000-0000-4000-8000-000000000001' returning 1) select count(*)::int from d $$,
  array[0], 'viewer no borra (RLS filtra la fila)');
reset role;

select test_helpers.act_as('a0000000-0000-4000-8000-000000000004');
select is((select count(*)::int from public.daily_logs where pet_id = 'b0000000-0000-4000-8000-000000000001'),
  0, 'ajeno: no ve registros');
select throws_ok($$ select test_helpers.save('b0000000-0000-4000-8000-000000000001', test_helpers.today(), 3::smallint) $$,
  '42501', null, 'ajeno: no puede guardar');
reset role;

select is((select mood_level from public.daily_logs
           where pet_id = 'b0000000-0000-4000-8000-000000000001' and log_date = test_helpers.today() - 1),
  3::smallint, 'viewer/ajeno: el registro no ha cambiado');

-- =====================================================================
-- 8. Integridad (A sobre P2)
-- =====================================================================
select test_helpers.act_as('a0000000-0000-4000-8000-000000000001');
select throws_ok($$ select test_helpers.save('b0000000-0000-4000-8000-000000000099', test_helpers.today(), 3::smallint) $$,
  '42501', null, 'mascota inexistente: rechazada');
select throws_like($$ select test_helpers.save('b0000000-0000-4000-8000-000000000002', test_helpers.today() + 1, 3::smallint) $$,
  '%fecha futura%', 'fecha futura: rechazada');
select throws_like($$ select test_helpers.save('b0000000-0000-4000-8000-000000000002', test_helpers.today() - 8, 3::smallint) $$,
  '%últimos 7 días%', 'fecha de hace 8 días: rechazada');
select lives_ok($$ select test_helpers.save('b0000000-0000-4000-8000-000000000002', test_helpers.today() - 7, 3::smallint) $$,
  'fecha de hace 7 días: aceptada');
select lives_ok($$ select test_helpers.save('b0000000-0000-4000-8000-000000000002', test_helpers.today(), 3::smallint) $$,
  'fecha de hoy: aceptada');
select throws_like($$ insert into public.daily_logs (pet_id, logged_by, log_date, mood_level)
                      values ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', (now() at time zone 'UTC')::date - 8, 3) $$,
  '%últimos 7 días%', 'fecha de hace 8 días con INSERT directo: rechazada');
select throws_ok($$ select test_helpers.save('b0000000-0000-4000-8000-000000000002', test_helpers.today() - 1, 0::smallint) $$,
  '23514', null, 'nivel 0: rechazado');
select throws_ok($$ select test_helpers.save('b0000000-0000-4000-8000-000000000002', test_helpers.today() - 1, 6::smallint) $$,
  '23514', null, 'nivel 6: rechazado');
select throws_ok($$ select test_helpers.save('b0000000-0000-4000-8000-000000000002', test_helpers.today() - 1, p_tags => array['birthday']) $$,
  '23514', null, 'tag fuera de la lista: rechazado');
select throws_ok($$ select test_helpers.save('b0000000-0000-4000-8000-000000000002', test_helpers.today() - 1, p_tags => array['vet_visit', null]) $$,
  '23514', null, 'tag NULL: rechazado');
select is((select tags from test_helpers.save('b0000000-0000-4000-8000-000000000002', test_helpers.today() - 1,
                                              p_tags => array['vet_visit', 'new_pet', 'vet_visit'])),
  array['new_pet', 'vet_visit'], 'tags válidos: se guardan sin duplicados y ordenados');
select lives_ok($$ select test_helpers.save('b0000000-0000-4000-8000-000000000002', test_helpers.today() - 2,
                    p_tags => array['vet_visit', 'home_change', 'new_pet']) $$,
  'los tres tags válidos: aceptados');
select throws_like($$ select test_helpers.save('b0000000-0000-4000-8000-000000000002', test_helpers.today() - 3,
                      p_unusual_notes => E' \n', p_notes => '   ') $$,
  '%daily_logs_not_empty_check%', 'registro vacío (notas solo con espacios): rechazado');
select throws_like($$ insert into public.daily_logs (pet_id, logged_by, log_date)
                      values ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', (now() at time zone 'UTC')::date - 3) $$,
  '%daily_logs_not_empty_check%', 'registro vacío con INSERT directo: rechazado');
select lives_ok($$ select test_helpers.save('b0000000-0000-4000-8000-000000000002', test_helpers.today() - 3, p_unusual => true) $$,
  'solo comportamiento inusual = true: aceptado');
select lives_ok($$ select test_helpers.save('b0000000-0000-4000-8000-000000000002', test_helpers.today() - 4, p_notes => 'Muy tranquilo') $$,
  'solo nota: aceptado');
select lives_ok($$ select test_helpers.save('b0000000-0000-4000-8000-000000000002', test_helpers.today() - 5, p_tags => array['home_change']) $$,
  'solo un tag: aceptado');
select throws_like($$ select test_helpers.save('b0000000-0000-4000-8000-000000000002', test_helpers.today() - 6, p_notes => repeat('a', 2001)) $$,
  '%daily_logs_notes_length_check%', 'nota de 2001 caracteres: rechazada');
select lives_ok($$ select test_helpers.save('b0000000-0000-4000-8000-000000000002', test_helpers.today() - 6, p_notes => repeat('á', 2000)) $$,
  'nota de 2000 caracteres (multibyte): aceptada');
select throws_like($$ select test_helpers.save('b0000000-0000-4000-8000-000000000002', test_helpers.today() - 7,
                      p_unusual => true, p_unusual_notes => repeat('a', 1001)) $$,
  '%daily_logs_unusual_behavior_notes_length_check%', 'nota de comportamiento de 1001 caracteres: rechazada');
select is((select row(energy_level, appetite_level, mood_level, activity_level, sleep_quality, vocalization_level,
                      social_interaction_level, unusual_behavior, unusual_behavior_notes, notes, tags)::text
           from public.save_daily_log('b0000000-0000-4000-8000-000000000002', test_helpers.today() - 7,
             1::smallint, 2::smallint, 3::smallint, 4::smallint, 5::smallint, 1::smallint, 2::smallint,
             true, '  Ladra a la puerta  ', E'Nota\n', array['new_pet'])),
  row(1::smallint, 2::smallint, 3::smallint, 4::smallint, 5::smallint, 1::smallint, 2::smallint,
      true, 'Ladra a la puerta', 'Nota', array['new_pet'])::text,
  'combinación completa válida: todos los campos guardados (texto recortado)');
select throws_like($$ select test_helpers.save('b0000000-0000-4000-8000-000000000002', test_helpers.today() - 7) $$,
  '%daily_logs_not_empty_check%', 'editar un registro hasta dejarlo vacío: rechazado');
reset role;

-- Registro antiguo (hace 20 días) creado por el backend: se puede editar
select test_helpers.act_as_service();
insert into public.daily_logs (pet_id, logged_by, log_date, mood_level)
values ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', test_helpers.today() - 20, 3);
select test_helpers.act_as_postgres();
select test_helpers.act_as('a0000000-0000-4000-8000-000000000001');
select is((select mood_level from test_helpers.save('b0000000-0000-4000-8000-000000000002', test_helpers.today() - 20, 5::smallint)),
  5::smallint, 'registro de hace 20 días: se edita sin límite de antigüedad');

-- =====================================================================
-- 9. Campos protegidos (A, authenticated)
-- =====================================================================
select throws_ok($$ update public.daily_logs set pet_id = 'b0000000-0000-4000-8000-000000000001'
                    where pet_id = 'b0000000-0000-4000-8000-000000000002' $$, '42501', null, 'no puede cambiar pet_id');
select throws_ok($$ update public.daily_logs set logged_by = 'a0000000-0000-4000-8000-000000000002'
                    where pet_id = 'b0000000-0000-4000-8000-000000000002' $$, '42501', null, 'no puede cambiar logged_by');
select throws_ok($$ update public.daily_logs set log_date = log_date - 1
                    where pet_id = 'b0000000-0000-4000-8000-000000000002' $$, '42501', null, 'no puede cambiar log_date');
select throws_ok($$ update public.daily_logs set created_at = now()
                    where pet_id = 'b0000000-0000-4000-8000-000000000002' $$, '42501', null, 'no puede cambiar created_at');
select throws_ok($$ update public.daily_logs set updated_at = now()
                    where pet_id = 'b0000000-0000-4000-8000-000000000002' $$, '42501', null, 'no puede cambiar updated_at');
select throws_ok($$ update public.daily_logs set last_edited_by = null
                    where pet_id = 'b0000000-0000-4000-8000-000000000002' $$, '42501', null, 'no puede cambiar last_edited_by');
select throws_ok($$ update public.daily_logs set id = gen_random_uuid()
                    where pet_id = 'b0000000-0000-4000-8000-000000000002' $$, '42501', null, 'no puede cambiar id');
select throws_ok($$ insert into public.daily_logs (id, pet_id, logged_by, log_date, mood_level)
                    values (gen_random_uuid(), 'b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', current_date, 3) $$,
  '42501', null, 'no puede enviar id al crear');
select throws_ok($$ insert into public.daily_logs (pet_id, logged_by, log_date, mood_level)
                    values ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', (now() at time zone 'UTC')::date, 3) $$,
  '42501', null, 'no puede crear con logged_by de otro usuario (RLS)');
select throws_ok($$ insert into public.daily_logs (pet_id, logged_by, log_date, mood_level)
                    values ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', (now() at time zone 'UTC')::date, 1)
                    on conflict (pet_id, log_date) do update
                    set pet_id = excluded.pet_id, logged_by = excluded.logged_by, log_date = excluded.log_date,
                        mood_level = excluded.mood_level $$,
  '42501', null, 'el upsert de PostgREST (SET de todas las columnas) no está permitido: usar la RPC');
select throws_ok($$ truncate public.daily_logs $$, '42501', null, 'no puede truncar');
reset role;

-- Segunda capa: el trigger también lo impide aunque haya privilegio (postgres sin JWT)
select test_helpers.act_as_postgres();
select throws_like($$ update public.daily_logs set log_date = log_date - 30
                      where pet_id = 'b0000000-0000-4000-8000-000000000002' and log_date = (now() at time zone 'UTC')::date $$,
  '%log_date%', 'trigger: log_date inmutable también con privilegios de tabla');
select throws_like($$ update public.daily_logs set pet_id = 'b0000000-0000-4000-8000-000000000001'
                      where pet_id = 'b0000000-0000-4000-8000-000000000002' and log_date = (now() at time zone 'UTC')::date $$,
  '%pet_id%', 'trigger: pet_id inmutable también con privilegios de tabla');

-- =====================================================================
-- 10. Rachas (owner S, timezone UTC)
-- =====================================================================
-- S1: 7 días seguidos, editar y borrar
select test_helpers.act_as('a0000000-0000-4000-8000-000000000005');
select lives_ok($$ select test_helpers.save('b0000000-0000-4000-8000-000000000011', test_helpers.today(), 3::smallint) $$,
  'rachas: primer registro');
reset role;
select is((select row(current_streak, longest_streak, last_log_date)::text from public.pet_streaks
           where pet_id = 'b0000000-0000-4000-8000-000000000011'),
  row(1, 1, test_helpers.today())::text, 'rachas: primer registro → racha 1');
select is((select array_agg(ac.code order by ac.code) from public.pet_achievements pa
           join public.achievements_catalog ac on ac.id = pa.achievement_id
           where pa.pet_id = 'b0000000-0000-4000-8000-000000000011'),
  array['first_log'], 'logros: first_log tras el primer registro');

select test_helpers.act_as('a0000000-0000-4000-8000-000000000005');
select lives_ok($$ select test_helpers.save('b0000000-0000-4000-8000-000000000011', test_helpers.today() - d, 3::smallint)
                   from generate_series(1, 6) as d $$,
  'rachas: registros de los 6 días anteriores');
reset role;
select is((select row(current_streak, longest_streak)::text from public.pet_streaks
           where pet_id = 'b0000000-0000-4000-8000-000000000011'),
  row(7, 7)::text, 'rachas: 7 días consecutivos → racha 7');
select is((select array_agg(ac.code order by ac.code) from public.pet_achievements pa
           join public.achievements_catalog ac on ac.id = pa.achievement_id
           where pa.pet_id = 'b0000000-0000-4000-8000-000000000011'),
  array['first_log', 'streak_7'], 'logros: streak_7 con 7 días, todavía sin streak_30');

select test_helpers.act_as('a0000000-0000-4000-8000-000000000005');
select lives_ok($$ select test_helpers.save('b0000000-0000-4000-8000-000000000011', test_helpers.today() - 3, 5::smallint) $$,
  'rachas: editar un día');
reset role;
select is((select row(current_streak, longest_streak)::text from public.pet_streaks
           where pet_id = 'b0000000-0000-4000-8000-000000000011'),
  row(7, 7)::text, 'rachas: editar un día no cambia la racha');
select is((select count(*)::int from public.daily_logs where pet_id = 'b0000000-0000-4000-8000-000000000011'),
  7, 'rachas: editar no crea registros');

select test_helpers.act_as('a0000000-0000-4000-8000-000000000005');
delete from public.daily_logs where pet_id = 'b0000000-0000-4000-8000-000000000011' and log_date = test_helpers.today() - 3;
reset role;
select is((select row(current_streak, longest_streak)::text from public.pet_streaks
           where pet_id = 'b0000000-0000-4000-8000-000000000011'),
  row(3, 7)::text, 'rachas: borrar un día corta la racha actual (3) y conserva longest_streak (7)');

select test_helpers.act_as('a0000000-0000-4000-8000-000000000005');
delete from public.daily_logs where pet_id = 'b0000000-0000-4000-8000-000000000011' and log_date = test_helpers.today();
reset role;
select is((select row(current_streak, longest_streak, last_log_date)::text from public.pet_streaks
           where pet_id = 'b0000000-0000-4000-8000-000000000011'),
  row(2, 7, test_helpers.today() - 1)::text, 'rachas: sin registro hoy, la racha que acaba ayer sigue viva (2)');

-- S2: hueco de un día
select test_helpers.act_as('a0000000-0000-4000-8000-000000000005');
select lives_ok($$ select test_helpers.save('b0000000-0000-4000-8000-000000000012', test_helpers.today() - d, 3::smallint)
                   from unnest(array[0, 1, 3]) as d $$,
  'rachas: registros de hoy, ayer y hace 3 días');
reset role;
select is((select row(current_streak, longest_streak)::text from public.pet_streaks
           where pet_id = 'b0000000-0000-4000-8000-000000000012'),
  row(2, 2)::text, 'rachas: hueco de un día → racha 2 (hoy y ayer)');
select test_helpers.act_as('a0000000-0000-4000-8000-000000000005');
select lives_ok($$ select test_helpers.save('b0000000-0000-4000-8000-000000000012', test_helpers.today() - 2, 3::smallint) $$,
  'rachas: registro que rellena el hueco');
reset role;
select is((select row(current_streak, longest_streak)::text from public.pet_streaks
           where pet_id = 'b0000000-0000-4000-8000-000000000012'),
  row(4, 4)::text, 'rachas: rellenar el hueco une las rachas (4)');

-- S3: 30 días seguidos (historial sembrado por el backend)
select test_helpers.act_as_service();
insert into public.daily_logs (pet_id, logged_by, log_date, mood_level)
select 'b0000000-0000-4000-8000-000000000013', 'a0000000-0000-4000-8000-000000000005', test_helpers.today() - d, 3
from generate_series(0, 29) as d;
select test_helpers.act_as_postgres();
select is((select row(current_streak, longest_streak)::text from public.pet_streaks
           where pet_id = 'b0000000-0000-4000-8000-000000000013'),
  row(30, 30)::text, 'rachas: 30 días consecutivos → racha 30');
select is((select array_agg(ac.code order by ac.code) from public.pet_achievements pa
           join public.achievements_catalog ac on ac.id = pa.achievement_id
           where pa.pet_id = 'b0000000-0000-4000-8000-000000000013'),
  array['first_log', 'streak_30', 'streak_7'], 'logros: streak_30 con 30 días');

-- S4: último registro hace 2 días → racha actual 0
select test_helpers.act_as_service();
insert into public.daily_logs (pet_id, logged_by, log_date, mood_level)
select 'b0000000-0000-4000-8000-000000000014', 'a0000000-0000-4000-8000-000000000005', test_helpers.today() - d, 3
from generate_series(2, 5) as d;
select test_helpers.act_as_postgres();
select is((select row(current_streak, longest_streak, last_log_date)::text from public.pet_streaks
           where pet_id = 'b0000000-0000-4000-8000-000000000014'),
  row(0, 4, test_helpers.today() - 2)::text, 'rachas: último registro hace 2 días → racha 0, longest 4');

-- =====================================================================
-- 11. Cascadas al borrar la mascota
-- =====================================================================
select test_helpers.act_as_service();
insert into public.daily_logs (pet_id, logged_by, log_date, mood_level)
select p.id, 'a0000000-0000-4000-8000-000000000005', test_helpers.today() - d, 3
from generate_series(0, 7) as d
cross join (values ('b0000000-0000-4000-8000-000000000021'::uuid), ('b0000000-0000-4000-8000-000000000022'::uuid)) as p(id);
select test_helpers.act_as_postgres();
select is((select count(*)::int from public.pet_streaks
           where pet_id in ('b0000000-0000-4000-8000-000000000021', 'b0000000-0000-4000-8000-000000000022')),
  2, 'cascada: las dos mascotas tienen racha antes de borrar');
select ok((select count(*) from public.pet_achievements where pet_id = 'b0000000-0000-4000-8000-000000000021') > 0,
  'cascada: la mascota tiene logros antes de borrar');

select test_helpers.act_as('a0000000-0000-4000-8000-000000000005');
select lives_ok($$ delete from public.pets where id = 'b0000000-0000-4000-8000-000000000021' $$,
  'cascada: el owner borra una mascota con registros, racha y logros');
reset role;
select is((select count(*)::int from public.daily_logs where pet_id = 'b0000000-0000-4000-8000-000000000021'),
  0, 'cascada: 0 registros de la mascota borrada');
select is((select count(*)::int from public.pet_streaks where pet_id = 'b0000000-0000-4000-8000-000000000021'),
  0, 'cascada: 0 rachas de la mascota borrada');
select is((select count(*)::int from public.pet_achievements where pet_id = 'b0000000-0000-4000-8000-000000000021'),
  0, 'cascada: 0 logros de la mascota borrada');

-- ---------------------------------------------------------------------
-- 11b. Casos de borrado independientes (orden de cascada del entorno)
-- ---------------------------------------------------------------------
insert into public.pets (id, owner_id, name, species_id)
select v.id::uuid, 'a0000000-0000-4000-8000-000000000005', v.name, s.id
from (values
  ('b0000000-0000-4000-8000-000000000040', 'D0'),  ('b0000000-0000-4000-8000-000000000041', 'D1'),
  ('b0000000-0000-4000-8000-000000000042', 'D2'),  ('b0000000-0000-4000-8000-000000000043', 'DN'),
  ('b0000000-0000-4000-8000-000000000046', 'D6'),  ('b0000000-0000-4000-8000-000000000047', 'D7'),
  ('b0000000-0000-4000-8000-000000000048', 'D8a'), ('b0000000-0000-4000-8000-000000000049', 'D8b'),
  ('b0000000-0000-4000-8000-00000000004a', 'D8c'),
  ('b0000000-0000-4000-8000-000000000051', 'A1'),  ('b0000000-0000-4000-8000-000000000052', 'A2')
) as v(id, name)
cross join public.species s
where s.code = 'dog';

-- Registros creados por el owner con la RPC (dentro de la ventana)
select test_helpers.act_as('a0000000-0000-4000-8000-000000000005');
select lives_ok($$
  select test_helpers.save(v.pet::uuid, test_helpers.today() - v.d, 3::smallint)
  from (values
    ('b0000000-0000-4000-8000-000000000041', 0),
    ('b0000000-0000-4000-8000-000000000042', 0), ('b0000000-0000-4000-8000-000000000042', 1),
    ('b0000000-0000-4000-8000-000000000046', 0), ('b0000000-0000-4000-8000-000000000046', 1),
    ('b0000000-0000-4000-8000-000000000047', 0), ('b0000000-0000-4000-8000-000000000047', 1),
    ('b0000000-0000-4000-8000-000000000047', 2),
    ('b0000000-0000-4000-8000-000000000051', 0),
    ('b0000000-0000-4000-8000-000000000052', 0), ('b0000000-0000-4000-8000-000000000052', 1)
  ) as v(pet, d) $$, 'borrado: registros de prueba creados con la RPC');
reset role;
-- Muchos registros (60 días) y tres mascotas de 5 días: sembrados por el backend
select test_helpers.act_as_service();
insert into public.daily_logs (pet_id, logged_by, log_date, mood_level)
select 'b0000000-0000-4000-8000-000000000043', 'a0000000-0000-4000-8000-000000000005', test_helpers.today() - d, 3
from generate_series(0, 59) as d;
insert into public.daily_logs (pet_id, logged_by, log_date, mood_level)
select p.id, 'a0000000-0000-4000-8000-000000000005', test_helpers.today() - d, 3
from generate_series(0, 4) as d
cross join (values ('b0000000-0000-4000-8000-000000000048'::uuid), ('b0000000-0000-4000-8000-000000000049'::uuid),
                   ('b0000000-0000-4000-8000-00000000004a'::uuid)) as p(id);
select test_helpers.act_as_postgres();

-- Caso 1: mascota sin registros
select test_helpers.act_as('a0000000-0000-4000-8000-000000000005');
select lives_ok($$ delete from public.pets where id = 'b0000000-0000-4000-8000-000000000040' $$,
  'borrado 1: mascota sin registros');
reset role;
select is((select count(*)::int from public.pets where id = 'b0000000-0000-4000-8000-000000000040'),
  0, 'borrado 1: la mascota ya no existe');

-- Caso 2: mascota con 1 registro
select is((select row(l.n, s.current_streak)::text
           from (select count(*)::int as n from public.daily_logs where pet_id = 'b0000000-0000-4000-8000-000000000041') l,
                public.pet_streaks s where s.pet_id = 'b0000000-0000-4000-8000-000000000041'),
  row(1, 1)::text, 'borrado 2: antes, 1 registro y racha 1');
select test_helpers.act_as('a0000000-0000-4000-8000-000000000005');
select lives_ok($$ delete from public.pets where id = 'b0000000-0000-4000-8000-000000000041' $$,
  'borrado 2: mascota con 1 registro');
reset role;
select is((select (select count(*) from public.daily_logs where pet_id = 'b0000000-0000-4000-8000-000000000041')
                + (select count(*) from public.pet_streaks where pet_id = 'b0000000-0000-4000-8000-000000000041'))::int,
  0, 'borrado 2: 0 registros y 0 rachas');

-- Caso 3: mascota con 2 registros (el caso que fallaba siempre)
select test_helpers.act_as('a0000000-0000-4000-8000-000000000005');
select lives_ok($$ delete from public.pets where id = 'b0000000-0000-4000-8000-000000000042' $$,
  'borrado 3: mascota con 2 registros');
reset role;
select is((select (select count(*) from public.daily_logs where pet_id = 'b0000000-0000-4000-8000-000000000042')
                + (select count(*) from public.pet_streaks where pet_id = 'b0000000-0000-4000-8000-000000000042'))::int,
  0, 'borrado 3: 0 registros y 0 rachas');

-- Caso 4: mascota con muchos registros (60) y logros
select is((select row(l.n, s.current_streak)::text
           from (select count(*)::int as n from public.daily_logs where pet_id = 'b0000000-0000-4000-8000-000000000043') l,
                public.pet_streaks s where s.pet_id = 'b0000000-0000-4000-8000-000000000043'),
  row(60, 60)::text, 'borrado 4: antes, 60 registros y racha 60');
select test_helpers.act_as('a0000000-0000-4000-8000-000000000005');
select lives_ok($$ delete from public.pets where id = 'b0000000-0000-4000-8000-000000000043' $$,
  'borrado 4: mascota con 60 registros');
reset role;
select is((select (select count(*) from public.daily_logs where pet_id = 'b0000000-0000-4000-8000-000000000043')
                + (select count(*) from public.pet_streaks where pet_id = 'b0000000-0000-4000-8000-000000000043')
                + (select count(*) from public.pet_achievements where pet_id = 'b0000000-0000-4000-8000-000000000043'))::int,
  0, 'borrado 4: 0 registros, 0 rachas y 0 logros');

-- Caso 5: mascota con registros y pet_streak → mascota C (arriba)

-- Caso 6: mascota con registros y sin fila en pet_streaks (estado al que
-- solo llega el backend: pet_streaks es una caché reconstruible)
delete from public.pet_streaks where pet_id = 'b0000000-0000-4000-8000-000000000046';
select test_helpers.act_as('a0000000-0000-4000-8000-000000000005');
select lives_ok($$ delete from public.pets where id = 'b0000000-0000-4000-8000-000000000046' $$,
  'borrado 6: mascota con registros y sin fila en pet_streaks');
reset role;
select is((select (select count(*) from public.daily_logs where pet_id = 'b0000000-0000-4000-8000-000000000046')
                + (select count(*) from public.pet_streaks where pet_id = 'b0000000-0000-4000-8000-000000000046'))::int,
  0, 'borrado 6: 0 registros y no se recrea la racha');

-- Caso 7: borrar un registro individual (la mascota sigue existiendo)
select test_helpers.act_as('a0000000-0000-4000-8000-000000000005');
select results_eq($$ with d as (delete from public.daily_logs
                    where pet_id = 'b0000000-0000-4000-8000-000000000047' and log_date = test_helpers.today() - 1
                    returning 1) select count(*)::int from d $$,
  array[1], 'borrado 7: borrar un registro individual');
reset role;
select is((select row(current_streak, longest_streak, last_log_date)::text from public.pet_streaks
           where pet_id = 'b0000000-0000-4000-8000-000000000047'),
  row(1, 3, test_helpers.today())::text, 'borrado 7: la racha se recalcula (actual 1, longest 3)');
select is((select count(*)::int from public.daily_logs where pet_id = 'b0000000-0000-4000-8000-000000000047'),
  2, 'borrado 7: quedan 2 registros');

-- Caso 8: borrar registros en distintos órdenes de fecha
-- D8a: del más antiguo al más reciente
select test_helpers.act_as('a0000000-0000-4000-8000-000000000005');
delete from public.daily_logs where pet_id = 'b0000000-0000-4000-8000-000000000048' and log_date = test_helpers.today() - 4;
delete from public.daily_logs where pet_id = 'b0000000-0000-4000-8000-000000000048' and log_date = test_helpers.today() - 3;
reset role;
select is((select row(current_streak, longest_streak)::text from public.pet_streaks
           where pet_id = 'b0000000-0000-4000-8000-000000000048'),
  row(3, 5)::text, 'borrado 8a: tras borrar los 2 más antiguos, racha 3 y longest 5');
select test_helpers.act_as('a0000000-0000-4000-8000-000000000005');
delete from public.daily_logs where pet_id = 'b0000000-0000-4000-8000-000000000048' and log_date = test_helpers.today() - 2;
delete from public.daily_logs where pet_id = 'b0000000-0000-4000-8000-000000000048' and log_date = test_helpers.today() - 1;
delete from public.daily_logs where pet_id = 'b0000000-0000-4000-8000-000000000048' and log_date = test_helpers.today();
reset role;
select is((select row(current_streak, longest_streak, last_log_date)::text from public.pet_streaks
           where pet_id = 'b0000000-0000-4000-8000-000000000048'),
  row(0, 5, null::date)::text, 'borrado 8a: sin registros, racha 0, longest 5 y sin último día');
-- D8b: del más reciente al más antiguo
select test_helpers.act_as('a0000000-0000-4000-8000-000000000005');
delete from public.daily_logs where pet_id = 'b0000000-0000-4000-8000-000000000049' and log_date = test_helpers.today();
reset role;
select is((select row(current_streak, longest_streak, last_log_date)::text from public.pet_streaks
           where pet_id = 'b0000000-0000-4000-8000-000000000049'),
  row(4, 5, test_helpers.today() - 1)::text, 'borrado 8b: sin hoy, la racha que acaba ayer sigue (4)');
select test_helpers.act_as('a0000000-0000-4000-8000-000000000005');
delete from public.daily_logs where pet_id = 'b0000000-0000-4000-8000-000000000049' and log_date = test_helpers.today() - 1;
reset role;
select is((select row(current_streak, longest_streak, last_log_date)::text from public.pet_streaks
           where pet_id = 'b0000000-0000-4000-8000-000000000049'),
  row(0, 5, test_helpers.today() - 2)::text, 'borrado 8b: último registro hace 2 días, racha 0');
-- D8c: el del medio primero y después el resto en una sola sentencia
select test_helpers.act_as('a0000000-0000-4000-8000-000000000005');
delete from public.daily_logs where pet_id = 'b0000000-0000-4000-8000-00000000004a' and log_date = test_helpers.today() - 2;
reset role;
select is((select row(current_streak, longest_streak)::text from public.pet_streaks
           where pet_id = 'b0000000-0000-4000-8000-00000000004a'),
  row(2, 5)::text, 'borrado 8c: borrar el día del medio deja racha 2');
select test_helpers.act_as('a0000000-0000-4000-8000-000000000005');
select results_eq($$ with d as (delete from public.daily_logs where pet_id = 'b0000000-0000-4000-8000-00000000004a'
                    returning 1) select count(*)::int from d $$,
  array[4], 'borrado 8c: borrar los 4 restantes en una sentencia');
reset role;
select is((select row(current_streak, longest_streak, last_log_date)::text from public.pet_streaks
           where pet_id = 'b0000000-0000-4000-8000-00000000004a'),
  row(0, 5, null::date)::text, 'borrado 8c: racha 0 y longest 5');
-- Las mascotas de 8a-8c (con racha y ya sin registros) se pueden borrar
select test_helpers.act_as('a0000000-0000-4000-8000-000000000005');
select lives_ok($$ delete from public.pets where id in ('b0000000-0000-4000-8000-000000000048',
                   'b0000000-0000-4000-8000-000000000049', 'b0000000-0000-4000-8000-00000000004a') $$,
  'borrado 8: borrar mascotas con racha y sin registros');
reset role;

-- ---------------------------------------------------------------------
-- 11c. Orden de cascada desfavorable (real)
-- ---------------------------------------------------------------------
-- Los triggers de FK se ejecutan por nombre (RI_ConstraintTrigger_a_<oid>),
-- así que el orden depende de los OID de cada entorno. Recrear la FK de
-- daily_logs le da un OID nuevo y hace que la cascada de pet_streaks se
-- ejecute ANTES que la de daily_logs. Es DDL dentro de la transacción de la
-- prueba: se deshace con el ROLLBACK.
alter table public.daily_logs drop constraint daily_logs_pet_id_fkey;
alter table public.daily_logs add constraint daily_logs_pet_id_fkey
  foreign key (pet_id) references public.pets (id) on delete cascade;
select ok(
  (select min(t.tgname::text collate "C") from pg_trigger t join pg_constraint c on c.oid = t.tgconstraint
   where c.conname = 'pet_streaks_pet_id_fkey' and t.tgrelid = 'public.pets'::regclass)
  <
  (select min(t.tgname::text collate "C") from pg_trigger t join pg_constraint c on c.oid = t.tgconstraint
   where c.conname = 'daily_logs_pet_id_fkey' and t.tgrelid = 'public.pets'::regclass),
  'orden desfavorable: la cascada de pet_streaks se ejecuta antes que la de daily_logs');
select ok((select count(*) from public.pet_streaks where pet_id = 'b0000000-0000-4000-8000-000000000022') = 1
      and (select count(*) from public.daily_logs where pet_id = 'b0000000-0000-4000-8000-000000000022') = 8,
  'orden desfavorable: C2 tiene 8 registros y su racha antes de borrar');
select test_helpers.act_as('a0000000-0000-4000-8000-000000000005');
select lives_ok($$ delete from public.pets where id = 'b0000000-0000-4000-8000-000000000022' $$,
  'cascada: borrar la mascota funciona aunque pet_streaks se borre antes que daily_logs');
reset role;
select is((select (select count(*) from public.daily_logs where pet_id = 'b0000000-0000-4000-8000-000000000022')
                + (select count(*) from public.pet_streaks where pet_id = 'b0000000-0000-4000-8000-000000000022')
                + (select count(*) from public.pet_achievements where pet_id = 'b0000000-0000-4000-8000-000000000022'))::int,
  0, 'cascada (orden desfavorable): 0 registros, 0 rachas y 0 logros');
select test_helpers.act_as('a0000000-0000-4000-8000-000000000005');
select lives_ok($$ delete from public.pets where id = 'b0000000-0000-4000-8000-000000000051' $$,
  'orden desfavorable: mascota con 1 registro');
select lives_ok($$ delete from public.pets where id = 'b0000000-0000-4000-8000-000000000052' $$,
  'orden desfavorable: mascota con 2 registros');
reset role;
select is((select (select count(*) from public.daily_logs
                   where pet_id in ('b0000000-0000-4000-8000-000000000051', 'b0000000-0000-4000-8000-000000000052'))
                + (select count(*) from public.pet_streaks
                   where pet_id in ('b0000000-0000-4000-8000-000000000051', 'b0000000-0000-4000-8000-000000000052')))::int,
  0, 'orden desfavorable: 0 registros y 0 rachas de A1 y A2');

select is((select count(*)::int from public.daily_logs l where not exists (select 1 from public.pets p where p.id = l.pet_id)),
  0, 'cascada: 0 registros huérfanos');
select is((select count(*)::int from public.pet_streaks s where not exists (select 1 from public.pets p where p.id = s.pet_id)),
  0, 'cascada: 0 rachas huérfanas');
select is((select count(*)::int from public.pet_achievements a where not exists (select 1 from public.pets p where p.id = a.pet_id)),
  0, 'cascada: 0 logros huérfanos');

-- =====================================================================
-- 12. Zona horaria del propietario
-- =====================================================================
-- Kiritimati (UTC+14) y Pago Pago (UTC-11) siempre están en días distintos.
update public.profiles set timezone = 'Pacific/Kiritimati' where id = 'a0000000-0000-4000-8000-000000000001';
select test_helpers.act_as('a0000000-0000-4000-8000-000000000001');
select lives_ok($$ select test_helpers.save('b0000000-0000-4000-8000-000000000002',
                   (now() at time zone 'Pacific/Kiritimati')::date, 3::smallint) $$,
  'timezone: "hoy" del propietario en Kiritimati aceptado');
select throws_like($$ select test_helpers.save('b0000000-0000-4000-8000-000000000002',
                     (now() at time zone 'Pacific/Kiritimati')::date + 1, 3::smallint) $$,
  '%fecha futura%', 'timezone: mañana en Kiritimati rechazado');
reset role;

-- El editor usa el calendario del propietario, no el suyo
update public.profiles set timezone = 'Pacific/Pago_Pago' where id = 'a0000000-0000-4000-8000-000000000001';
update public.profiles set timezone = 'Pacific/Kiritimati' where id = 'a0000000-0000-4000-8000-000000000002';
select test_helpers.act_as('a0000000-0000-4000-8000-000000000002');
select throws_like($$ select test_helpers.save('b0000000-0000-4000-8000-000000000001',
                     (now() at time zone 'Pacific/Kiritimati')::date, 3::smallint) $$,
  '%fecha futura%', 'timezone: el "hoy" del editor (Kiritimati) es futuro para el propietario (Pago Pago)');
select lives_ok($$ select test_helpers.save('b0000000-0000-4000-8000-000000000001',
                   (now() at time zone 'Pacific/Pago_Pago')::date, 3::smallint) $$,
  'timezone: el editor puede registrar el "hoy" del propietario');
reset role;

select * from finish();
rollback;
