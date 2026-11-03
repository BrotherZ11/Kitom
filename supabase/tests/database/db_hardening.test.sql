-- =====================================================================
-- KITOM · Longitudes, rendimiento de RLS y limpieza programada (*_abuse_limits_and_db_hardening.sql)
-- =====================================================================
-- pgTAP. Solo contra la BD local: `npx supabase test db`, o
--   docker exec -i supabase_db_Kitom psql -U postgres -d postgres -f - < supabase/tests/database/db_hardening.test.sql
-- Todo ocurre en una transacción que termina en ROLLBACK (también los secretos
-- de Vault y la petición de pg_net de la sección 5: pg_net solo envía lo
-- confirmado y, aun así, la URL es un puerto local cerrado). Requiere los
-- catálogos (supabase/seed.sql).
-- Cubre: CHECK de longitud (SEC-18) en el máximo y uno más; registro con un
-- nombre largo de Google; feedback; las 22 políticas con (select auth.uid()) y
-- su comportamiento; STABLE; claves foráneas con índice; pg_cron, pg_net y la
-- tarea de limpieza sin secretos y con ellos.
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

create function test_helpers.reset_role() returns void
  language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

create function test_helpers.hint_of(statement text) returns text
  language plpgsql as $$
declare
  error_hint text;
begin
  execute statement;
  return 'sin error';
exception when others then
  get stacked diagnostics error_hint = pg_exception_hint;
  return coalesce(nullif(error_hint, ''), 'sin hint');
end $$;

grant execute on all functions in schema test_helpers to anon, authenticated;

insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('a9000000-0000-4000-8000-000000000001', 'hard-a@example.test', 'authenticated', 'authenticated', '{"full_name":"Ana"}'),
  ('a9000000-0000-4000-8000-000000000002', 'hard-b@example.test', 'authenticated', 'authenticated', '{"full_name":"Bea"}'),
  ('a9000000-0000-4000-8000-000000000003', 'hard-long@example.test', 'authenticated', 'authenticated',
   jsonb_build_object('full_name', repeat('n', 300)));

insert into public.pets (id, owner_id, name, species_id)
select v.id, v.owner_id, v.name, s.id
from (values
  ('aa000000-0000-4000-8000-000000000001'::uuid, 'a9000000-0000-4000-8000-000000000001'::uuid, 'Coco'),
  ('aa000000-0000-4000-8000-000000000002'::uuid, 'a9000000-0000-4000-8000-000000000002'::uuid, 'Lima')
) as v (id, owner_id, name)
cross join public.species s where s.code = 'dog';

insert into public.ai_analysis_requests (id, pet_id, requested_by, status)
values ('ab000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000001',
        'a9000000-0000-4000-8000-000000000001', 'completed');

-- ---------------------------------------------------------------------
-- 1. Longitudes (SEC-18)
-- ---------------------------------------------------------------------
-- pets: como la app (authenticated): el CHECK de listas usa una función privada.
select test_helpers.act_as('a9000000-0000-4000-8000-000000000001');

select lives_ok(
  $$ update public.pets
     set name = repeat('a', 100), breed_status = 'known', breed = repeat('b', 100), temperament_notes = repeat('t', 2000),
         known_conditions = array_fill(repeat('c', 200), array[100]),
         allergies = array(select 'x' || g from generate_series(1, 100) g)
     where id = 'aa000000-0000-4000-8000-000000000001' $$,
  'pets: en el máximo (nombre y raza 100, notas 2000, 100 elementos de 200) se acepta');
select lives_ok(
  $$ update public.pets set temperament_notes = null, known_conditions = null, allergies = '{}'
     where id = 'aa000000-0000-4000-8000-000000000001' $$,
  'pets: vacíos y nulos se aceptan');
select throws_like(
  $$ update public.pets set name = repeat('a', 101) where id = 'aa000000-0000-4000-8000-000000000001' $$,
  '%pets_name_length_check%', 'pets: nombre de 101 se rechaza');
select throws_like(
  $$ update public.pets set breed = repeat('b', 101) where id = 'aa000000-0000-4000-8000-000000000001' $$,
  '%pets_breed_length_check%', 'pets: raza de 101 se rechaza');
select throws_like(
  $$ update public.pets set temperament_notes = repeat('t', 2001) where id = 'aa000000-0000-4000-8000-000000000001' $$,
  '%pets_temperament_notes_length_check%', 'pets: notas de 2001 se rechazan');
select throws_like(
  $$ update public.pets set known_conditions = array_fill('c'::text, array[101]) where id = 'aa000000-0000-4000-8000-000000000001' $$,
  '%pets_known_conditions_length_check%', 'pets: 101 condiciones se rechazan');
select throws_like(
  $$ update public.pets set known_conditions = array['ok', repeat('c', 201)] where id = 'aa000000-0000-4000-8000-000000000001' $$,
  '%pets_known_conditions_length_check%', 'pets: una condición de 201 se rechaza');
select throws_like(
  $$ update public.pets set allergies = array_fill('a'::text, array[101]) where id = 'aa000000-0000-4000-8000-000000000001' $$,
  '%pets_allergies_length_check%', 'pets: 101 alergias se rechazan');
select throws_like(
  $$ update public.pets set allergies = array[repeat('a', 201)] where id = 'aa000000-0000-4000-8000-000000000001' $$,
  '%pets_allergies_length_check%', 'pets: una alergia de 201 se rechaza');
select throws_like(
  $$ insert into public.pets (owner_id, name, species_id)
     select 'a9000000-0000-4000-8000-000000000001', repeat('a', 101), id from public.species where code = 'dog' $$,
  '%pets_name_length_check%', 'pets: también al crear');
select throws_ok(
  $$ select private.text_array_within('{}', 1, 1) $$,
  '42501', null, 'pets: la función del CHECK no se puede llamar por nombre (sin USAGE de private)');

set local role service_role;
select lives_ok(
  $$ update public.pets set allergies = array['polen'] where id = 'aa000000-0000-4000-8000-000000000001' $$,
  'pets: service_role también puede escribir (EXECUTE sobre la función del CHECK)');
reset role;

-- profiles
select test_helpers.act_as('a9000000-0000-4000-8000-000000000001');
select lives_ok(
  $$ update public.profiles set full_name = repeat('n', 200) where id = 'a9000000-0000-4000-8000-000000000001' $$,
  'profiles: nombre de 200 se acepta');
select throws_like(
  $$ update public.profiles set full_name = repeat('n', 201) where id = 'a9000000-0000-4000-8000-000000000001' $$,
  '%profiles_full_name_length_check%', 'profiles: nombre de 201 se rechaza');
select test_helpers.reset_role();
select is(
  (select char_length(full_name) from public.profiles where id = 'a9000000-0000-4000-8000-000000000003'),
  200,
  'profiles: un nombre de 300 de Google se recorta a 200 al registrarse (el registro no falla)');

-- reminders
select lives_ok(
  $$ insert into public.reminders (pet_id, created_by, type, title, description, due_at)
     values ('aa000000-0000-4000-8000-000000000001', 'a9000000-0000-4000-8000-000000000001', 'other',
             repeat('r', 200), repeat('d', 2000), now() + interval '1 day') $$,
  'reminders: título 200 y descripción 2000 se aceptan');
select throws_like(
  $$ insert into public.reminders (pet_id, created_by, type, title, due_at)
     values ('aa000000-0000-4000-8000-000000000001', 'a9000000-0000-4000-8000-000000000001', 'other',
             repeat('r', 201), now() + interval '1 day') $$,
  '%reminders_title_length_check%', 'reminders: título de 201 se rechaza');
select throws_like(
  $$ insert into public.reminders (pet_id, created_by, type, title, description, due_at)
     values ('aa000000-0000-4000-8000-000000000001', 'a9000000-0000-4000-8000-000000000001', 'other',
             'x', repeat('d', 2001), now() + interval '1 day') $$,
  '%reminders_description_length_check%', 'reminders: descripción de 2001 se rechaza');

-- feedback de IA
select test_helpers.act_as('a9000000-0000-4000-8000-000000000001');
select lives_ok(
  $$ select public.submit_ai_feedback('ab000000-0000-4000-8000-000000000001', 'useful', repeat('f', 1000)) $$,
  'feedback: comentario de 1000 se acepta');
select is(
  test_helpers.hint_of($$ select public.submit_ai_feedback('ab000000-0000-4000-8000-000000000001', 'useful', repeat('f', 1001)) $$),
  'ai_feedback_too_long',
  'feedback: comentario de 1001 se rechaza con ai_feedback_too_long');
select test_helpers.act_as('a9000000-0000-4000-8000-000000000002');
select throws_ok(
  $$ select public.submit_ai_feedback('ab000000-0000-4000-8000-000000000001', 'useful', 'x') $$,
  'P0001', 'Solo el usuario que solicitó el análisis puede enviar o modificar su feedback',
  'feedback: sigue siendo solo de quien lo pidió');
select test_helpers.reset_role();
select throws_like(
  $$ update public.ai_analysis_requests set feedback_comment = repeat('f', 1001) where id = 'ab000000-0000-4000-8000-000000000001' $$,
  '%ai_analysis_requests_feedback_comment_length_check%', 'feedback: el CHECK también protege la columna');

-- analytics_events
select test_helpers.act_as('a9000000-0000-4000-8000-000000000001');
select lives_ok(
  $$ insert into public.analytics_events (user_id, event_name, properties)
     values ('a9000000-0000-4000-8000-000000000001', repeat('e', 100), jsonb_build_object('k', repeat('v', 8000))) $$,
  'analytics_events: nombre de 100 y propiedades de ~8 KB se aceptan');
select throws_like(
  $$ insert into public.analytics_events (user_id, event_name) values ('a9000000-0000-4000-8000-000000000001', repeat('e', 101)) $$,
  '%analytics_events_event_name_length_check%', 'analytics_events: nombre de 101 se rechaza');
select throws_like(
  $$ insert into public.analytics_events (user_id, event_name, properties)
     values ('a9000000-0000-4000-8000-000000000001', 'x', jsonb_build_object('k', repeat('v', 8200))) $$,
  '%analytics_events_properties_size_check%', 'analytics_events: propiedades de más de 8 KB se rechazan');
select test_helpers.reset_role();

-- ---------------------------------------------------------------------
-- 2. Políticas: (select auth.uid()) y misma semántica
-- ---------------------------------------------------------------------
select results_eq(
  $$ select count(*)::int from pg_policies
     where schemaname = 'public'
       and (coalesce(qual, '') || coalesce(with_check, '')) ~ 'auth\.(uid|role)\(\)' $$,
  $$ values (22) $$,
  'políticas: 22 políticas de public usan auth.uid()/auth.role()');
select is_empty(
  $$ select policyname from pg_policies
     where schemaname = 'public'
       and regexp_replace(regexp_replace(coalesce(qual, '') || ' ' || coalesce(with_check, ''),
             '\( SELECT auth\.uid\(\) AS uid\)', '', 'g'),
             '\( SELECT auth\.role\(\) AS role\)', '', 'g') ~ 'auth\.(uid|role)\(\)' $$,
  'políticas: ninguna llama a auth.uid()/auth.role() sin (select …) (initPlan, una vez por consulta)');
select results_eq(
  $$ select tablename::text collate "default", policyname::text collate "default",
            cmd collate "default", roles::text collate "default"
     from pg_policies
     where schemaname = 'public'
       and (coalesce(qual, '') || coalesce(with_check, '')) ~ 'auth\.(uid|role)\(\)'
     order by 1, 2 $$,
  $$ values
     ('achievements_catalog', 'achievements_catalog: select authenticated', 'SELECT', '{public}'),
     ('analytics_events', 'analytics_events: insert own', 'INSERT', '{public}'),
     ('breeds', 'breeds: select authenticated', 'SELECT', '{public}'),
     ('catalog_translations', 'catalog_translations: select authenticated', 'SELECT', '{public}'),
     ('clinic_referrals', 'clinic_referrals: select own', 'SELECT', '{public}'),
     ('daily_logs', 'daily_logs: insert editors', 'INSERT', '{public}'),
     ('notification_preferences', 'notif_prefs: manage own', 'ALL', '{public}'),
     ('pet_co_owners', 'co_owners: select members or self', 'SELECT', '{public}'),
     ('pets', 'pets: delete owner', 'DELETE', '{public}'),
     ('pets', 'pets: insert own', 'INSERT', '{public}'),
     ('pets', 'pets: select members', 'SELECT', '{public}'),
     ('profiles', 'profiles: insert own', 'INSERT', '{public}'),
     ('profiles', 'profiles: select own', 'SELECT', '{public}'),
     ('profiles', 'profiles: update own', 'UPDATE', '{public}'),
     ('push_tokens', 'push_tokens: manage own', 'ALL', '{public}'),
     ('reminders', 'reminders: insert editors', 'INSERT', '{public}'),
     ('species', 'species: select authenticated', 'SELECT', '{public}'),
     ('subscription_events', 'subscription_events: select own', 'SELECT', '{public}'),
     ('subscriptions', 'subscriptions: select own', 'SELECT', '{public}'),
     ('symptom_species', 'symptom_species: select authenticated', 'SELECT', '{public}'),
     ('symptoms_catalog', 'symptoms: select authenticated', 'SELECT', '{public}'),
     ('vet_clinics', 'vet_clinics: select authenticated', 'SELECT', '{public}') $$,
  'políticas: mismos nombres, comandos y roles');
select results_eq(
  $$ select qual is null, with_check from pg_policies where schemaname = 'public' and policyname = 'profiles: update own' $$,
  $$ values (false, null::text) $$,
  'políticas: profiles update sigue sin WITH CHECK propio (como antes)');

-- Comportamiento (el resto lo cubren las suites existentes).
select test_helpers.act_as('a9000000-0000-4000-8000-000000000001');
select is((select count(*)::int from public.profiles), 1, 'semántica: cada usuario ve solo su perfil');
select is((select count(*)::int from public.subscriptions), 1, 'semántica: y solo su suscripción');
select is((select count(*)::int from public.notification_preferences), 1, 'semántica: y solo sus preferencias');
select is(
  (select count(*)::int from public.pets where id in ('aa000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000002')),
  1, 'semántica: ve su mascota y no la ajena');
select ok((select count(*) > 0 from public.species), 'semántica: authenticated lee los catálogos');
select lives_ok(
  $$ insert into public.pets (owner_id, name, species_id)
     select 'a9000000-0000-4000-8000-000000000001', 'Nueva', id from public.species where code = 'dog'
     returning id $$,
  'semántica: crea su mascota con RETURNING (insert().select())');
select throws_ok(
  $$ insert into public.pets (owner_id, name, species_id)
     select 'a9000000-0000-4000-8000-000000000002', 'Ajena', id from public.species where code = 'dog' $$,
  '42501', null, 'semántica: no crea mascotas a nombre de otro');
update public.notification_preferences set marketing_notifications_enabled = true
where user_id = 'a9000000-0000-4000-8000-000000000002';
delete from public.pets where id = 'aa000000-0000-4000-8000-000000000002';
select test_helpers.act_as_anon();
select is((select count(*)::int from public.species), 0, 'semántica: anon no lee los catálogos');
select is((select count(*)::int from public.catalog_translations), 0, 'semántica: ni sus traducciones');
select test_helpers.reset_role();
select is(
  (select marketing_notifications_enabled from public.notification_preferences
   where user_id = 'a9000000-0000-4000-8000-000000000002'),
  false, 'semántica: no cambia las preferencias de otro');
select is(
  (select count(*)::int from public.pets where id = 'aa000000-0000-4000-8000-000000000002'),
  1, 'semántica: no borra la mascota de otro');

-- ---------------------------------------------------------------------
-- 3. Funciones de las políticas: STABLE
-- ---------------------------------------------------------------------
select results_eq(
  $$ select proname::text collate "default", provolatile::text collate "default", prosecdef, proconfig::text[] collate "default"
     from pg_proc
     where oid in ('public.is_pet_member(uuid)'::regprocedure, 'public.can_edit_pet(uuid)'::regprocedure)
     order by 1 $$,
  $$ values ('can_edit_pet', 's', true, array['search_path=public']),
            ('is_pet_member', 's', true, array['search_path=public']) $$,
  'is_pet_member y can_edit_pet: STABLE, SECURITY DEFINER y search_path fijo');

-- ---------------------------------------------------------------------
-- 4. Toda clave foránea de public y private tiene índice
-- ---------------------------------------------------------------------
select is_empty(
  $$ select c.conrelid::regclass::text || '.' || c.conname
     from pg_constraint c
     where c.contype = 'f'
       and c.connamespace in ('public'::regnamespace, 'private'::regnamespace)
       and not exists (
         select 1 from pg_index i
         where i.indrelid = c.conrelid
           and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] @> c.conkey
           and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] <@ c.conkey) $$,
  'índices: ninguna clave foránea sin índice que empiece por sus columnas');

-- ---------------------------------------------------------------------
-- 5. Limpieza programada (pg_cron + pg_net + Vault)
-- ---------------------------------------------------------------------
select results_eq(
  $$ select extname::text collate "default", extnamespace::regnamespace::text collate "default" from pg_extension
     where extname in ('pg_cron', 'pg_net') order by 1 $$,
  $$ values ('pg_cron', 'pg_catalog'), ('pg_net', 'extensions') $$,
  'cron: pg_cron en pg_catalog y pg_net en extensions');
select results_eq(
  $$ select jobname::text collate "default", schedule collate "default", command collate "default",
            username::text collate "default", active
     from cron.job where jobname like 'kitom-%' order by 1 $$,
  $$ values
     ('kitom-pet-storage-cleanup', '*/30 * * * *', 'select private.invoke_pet_storage_cleanup(''process'')', 'postgres', true),
     ('kitom-pet-storage-cleanup-audit', '17 4 * * *', 'select private.invoke_pet_storage_cleanup(''audit'')', 'postgres', true) $$,
  'cron: las dos tareas existen, como postgres y activas');
select ok(
  not has_function_privilege('anon', 'private.invoke_pet_storage_cleanup(text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.invoke_pet_storage_cleanup(text)', 'EXECUTE')
  and not has_function_privilege('service_role', 'private.invoke_pet_storage_cleanup(text)', 'EXECUTE'),
  'cron: la función de la tarea solo la ejecuta postgres');
select ok(
  (select proconfig = array['search_path=""'] and not prosecdef from pg_proc
   where oid = 'private.invoke_pet_storage_cleanup(text)'::regprocedure),
  'cron: SECURITY INVOKER con search_path vacío');

-- Sin secretos: no hace nada y no falla.
delete from vault.secrets where name in ('kitom_project_url', 'pet_storage_cleanup_secret');
create temporary table queued_before as select count(*) as n from net.http_request_queue;
select is(private.invoke_pet_storage_cleanup('process'), null, 'cron: sin secretos en Vault no hace nada (NULL, sin error)');
select is(private.invoke_pet_storage_cleanup('audit'), null, 'cron: tampoco la auditoría');

-- Solo uno de los dos, o valores no válidos: tampoco.
select vault.create_secret('http://127.0.0.1:9/', 'kitom_project_url');
select is(private.invoke_pet_storage_cleanup('process'), null, 'cron: con la URL pero sin el secreto, nada');
select vault.create_secret('demasiado-corto', 'pet_storage_cleanup_secret');
select is(private.invoke_pet_storage_cleanup('process'), null, 'cron: con un secreto de menos de 32 caracteres, nada');
select is(
  (select count(*) from net.http_request_queue) - (select n from queued_before),
  0::bigint,
  'cron: no se ha encolado ninguna petición');

-- Con los dos: encola un POST a la función con la cabecera (se deshace con el ROLLBACK).
select vault.update_secret((select id from vault.secrets where name = 'pet_storage_cleanup_secret'), repeat('s', 40));
select isnt(private.invoke_pet_storage_cleanup('process'), null, 'cron: con URL y secreto encola la petición');
select results_eq(
  $$ select method::text, url, headers ->> 'x-kitom-cleanup-secret', convert_from(body, 'UTF8')::jsonb, timeout_milliseconds
     from net.http_request_queue order by id desc limit 1 $$,
  $$ values ('POST', 'http://127.0.0.1:9/functions/v1/pet-storage-cleanup', repeat('s', 40), '{"task": "process"}'::jsonb, 60000) $$,
  'cron: POST a /functions/v1/pet-storage-cleanup con x-kitom-cleanup-secret y la tarea');
select is(
  test_helpers.hint_of($$ select private.invoke_pet_storage_cleanup('delete everything') $$),
  'pet_storage_cleanup_invalid_task',
  'cron: una tarea desconocida se rechaza');

select * from finish();

rollback;
