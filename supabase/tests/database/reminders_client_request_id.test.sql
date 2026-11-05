-- =====================================================================
-- KITOM · Pruebas de reminders.client_request_id (migración *_reminders_client_request_id.sql)
-- =====================================================================
-- pgTAP. Solo contra la BD local: `npx supabase test db`, o
--   docker exec -i supabase_db_Kitom psql -U postgres -d postgres -f - < supabase/tests/database/reminders_client_request_id.test.sql
-- Todo ocurre en una transacción que termina en ROLLBACK. Las altas de la app
-- son `insert … returning` (PostgREST `insert().select()`), como aquí. Requiere
-- el catálogo de especies (supabase/seed.sql). La concurrencia real está en
-- supabase/tests/concurrency/reminders_concurrency.sh.
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
create function test_helpers.create_reminder(pet uuid, creator uuid, request_id uuid, reminder_title text) returns uuid
  language plpgsql as $$
declare
  created uuid;
begin
  insert into public.reminders (pet_id, created_by, type, title, due_at, client_request_id)
  values (pet, creator, 'medication', reminder_title, now() + interval '1 day', request_id)
  returning id into created;
  return created;
end $$;

grant execute on all functions in schema test_helpers to anon, authenticated;

-- A propietaria · B editora · C lector · D otra cuenta, con su propia mascota.
insert into auth.users (id, email, aud, role) values
  ('e6000000-0000-4000-8000-000000000001', 'rcrid-a@example.test', 'authenticated', 'authenticated'),
  ('e6000000-0000-4000-8000-000000000002', 'rcrid-b@example.test', 'authenticated', 'authenticated'),
  ('e6000000-0000-4000-8000-000000000003', 'rcrid-c@example.test', 'authenticated', 'authenticated'),
  ('e6000000-0000-4000-8000-000000000004', 'rcrid-d@example.test', 'authenticated', 'authenticated');

insert into public.pets (id, owner_id, name, species_id)
select v.id, v.owner_id, v.name, s.id
from (values
  ('e7000000-0000-4000-8000-000000000001'::uuid, 'e6000000-0000-4000-8000-000000000001'::uuid, 'Kika'),
  ('e7000000-0000-4000-8000-000000000002'::uuid, 'e6000000-0000-4000-8000-000000000004'::uuid, 'Rex')
) as v (id, owner_id, name)
cross join public.species s where s.code = 'cat';

insert into public.pet_co_owners (pet_id, user_id, role, status, invited_by, accepted_at) values
  ('e7000000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000002', 'editor', 'accepted', 'e6000000-0000-4000-8000-000000000001', now()),
  ('e7000000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000003', 'viewer', 'accepted', 'e6000000-0000-4000-8000-000000000001', now());

-- =====================================================================
-- 1. Esquema, índice, grants y RLS
-- =====================================================================
select is(
  (select row(data_type, is_nullable, column_default)::text from information_schema.columns
   where table_schema = 'public' and table_name = 'reminders' and column_name = 'client_request_id'),
  row('uuid', 'YES', null::text)::text, 'esquema: client_request_id uuid, admite NULL, sin default');
select is(
  (select indexdef from pg_indexes where schemaname = 'public' and indexname = 'reminders_creator_client_request_id_key'),
  'CREATE UNIQUE INDEX reminders_creator_client_request_id_key ON public.reminders USING btree (created_by, client_request_id) WHERE (client_request_id IS NOT NULL)',
  'índice: único por (created_by, client_request_id), solo con clave');
select ok(
  has_column_privilege('authenticated', 'public.reminders', 'client_request_id', 'INSERT'),
  'grants: authenticated puede insertar client_request_id');
select ok(
  not has_column_privilege('authenticated', 'public.reminders', 'client_request_id', 'UPDATE'),
  'grants: authenticated NO puede actualizar client_request_id');
select ok(
  not has_column_privilege('authenticated', 'public.reminders', 'id', 'INSERT'),
  'grants: authenticated sigue sin poder fijar reminders.id');
select is(
  (select array_agg(policyname::text order by policyname) from pg_policies where schemaname = 'public' and tablename = 'reminders'),
  array['reminders: delete editors', 'reminders: insert editors', 'reminders: select members', 'reminders: update editors'],
  'rls: se mantienen las políticas de reminders');

-- =====================================================================
-- 2. Altas con clave
-- =====================================================================
select test_helpers.act_as('e6000000-0000-4000-8000-000000000002');

select lives_ok(
  $$ select test_helpers.create_reminder('e7000000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000002', 'ab000000-0000-4000-8000-000000000001', 'Pastilla') $$,
  'alta: con clave, como editora (insert … returning)');
select throws_ok(
  $$ select test_helpers.create_reminder('e7000000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000002', 'ab000000-0000-4000-8000-000000000001', 'Pastilla') $$,
  '23505', null, 'reenvío: la misma alta (misma clave) da 23505, no otro recordatorio');
select is(
  (select count(*)::int from public.reminders where client_request_id = 'ab000000-0000-4000-8000-000000000001'),
  1, 'reenvío: queda un solo recordatorio con esa clave');
select is(
  (select title from public.reminders
   where created_by = 'e6000000-0000-4000-8000-000000000002' and client_request_id = 'ab000000-0000-4000-8000-000000000001'),
  'Pastilla', 'recuperación: la editora lo lee por su clave (RLS)');
select lives_ok(
  $$ select test_helpers.create_reminder('e7000000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000002', 'ab000000-0000-4000-8000-000000000002', 'Pastilla') $$,
  'alta: otra clave crea otro recordatorio, aunque sea igual (dos iguales son legítimos)');
select lives_ok(
  $$ select test_helpers.create_reminder('e7000000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000002', null, 'Sin clave') $$,
  'alta sin clave (online): sin cambios');
select lives_ok(
  $$ select test_helpers.create_reminder('e7000000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000002', null, 'Sin clave') $$,
  'alta sin clave: varias filas con NULL no chocan');

-- La clave no se puede cambiar, ni ponerla a un recordatorio existente.
select throws_ok(
  $$ update public.reminders set client_request_id = 'ab000000-0000-4000-8000-000000000009'
     where client_request_id = 'ab000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'update: client_request_id no se puede cambiar');
select throws_ok(
  $$ update public.reminders set client_request_id = 'ab000000-0000-4000-8000-000000000009' where title = 'Sin clave' $$,
  '42501', null, 'update: no se puede añadir una clave a un recordatorio existente');

-- La misma clave en dos cuentas no choca ni revela la otra (ligada al creador).
select test_helpers.act_as('e6000000-0000-4000-8000-000000000004');
select lives_ok(
  $$ select test_helpers.create_reminder('e7000000-0000-4000-8000-000000000002', 'e6000000-0000-4000-8000-000000000004', 'ab000000-0000-4000-8000-000000000001', 'De D') $$,
  'aislamiento: otra cuenta puede usar la misma clave (no revela la de B)');
select is(
  (select count(*)::int from public.reminders where client_request_id = 'ab000000-0000-4000-8000-000000000001'),
  1, 'aislamiento: D solo ve su recordatorio con esa clave (RLS)');
select throws_ok(
  $$ select test_helpers.create_reminder('e7000000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000004', 'ab000000-0000-4000-8000-000000000003', 'Ajeno') $$,
  '42501', null, 'rls: D no puede crear en la mascota de A, con o sin clave');
select throws_ok(
  $$ select test_helpers.create_reminder('e7000000-0000-4000-8000-000000000002', 'e6000000-0000-4000-8000-000000000002', 'ab000000-0000-4000-8000-000000000004', 'Suplantado') $$,
  '42501', null, 'rls: D no puede crear a nombre de B');

-- Lector y anónimo: nunca crean.
select test_helpers.act_as('e6000000-0000-4000-8000-000000000003');
select throws_ok(
  $$ select test_helpers.create_reminder('e7000000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000003', 'ab000000-0000-4000-8000-000000000005', 'Lector') $$,
  '42501', null, 'lector: no puede crear');
select test_helpers.act_as_anon();
select throws_ok(
  $$ select test_helpers.create_reminder('e7000000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000001', 'ab000000-0000-4000-8000-000000000006', 'Anon') $$,
  '42501', null, 'anon: no puede crear');

-- =====================================================================
-- 3. Permiso revocado tras un alta con respuesta perdida
-- =====================================================================
-- El reenvío debe dar 42501 (RLS antes que el índice), no 23505: la app lo
-- trata como «sin permiso» y conserva la operación, sin descartarla.
select test_helpers.reset_role();
update public.pet_co_owners set role = 'viewer'
where pet_id = 'e7000000-0000-4000-8000-000000000001' and user_id = 'e6000000-0000-4000-8000-000000000002';

select test_helpers.act_as('e6000000-0000-4000-8000-000000000002');
select throws_ok(
  $$ select test_helpers.create_reminder('e7000000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000002', 'ab000000-0000-4000-8000-000000000001', 'Pastilla') $$,
  '42501', null, 'bajada a lector: el reenvío con la clave ya usada da 42501, no 23505');
select is(
  (select title from public.reminders
   where created_by = 'e6000000-0000-4000-8000-000000000002' and client_request_id = 'ab000000-0000-4000-8000-000000000001'),
  'Pastilla', 'bajada a lector: como sigue siendo miembro, aún lee su fila por la clave');

select test_helpers.reset_role();
select is(
  (select count(*)::int from public.reminders where client_request_id = 'ab000000-0000-4000-8000-000000000001'),
  2, 'resultado: una fila por cuenta con esa clave, ninguna duplicada');

-- =====================================================================
-- 4. Filas sin creador (created_by NULL): no chocan en el índice
-- =====================================================================
-- created_by pasa a NULL al borrarse la cuenta (FK ON DELETE SET NULL): aquí con
-- service_role, para tener dos filas con la misma clave; el borrado real, en la sección 5.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
update public.reminders set created_by = null
where client_request_id = 'ab000000-0000-4000-8000-000000000002';
select test_helpers.reset_role();
insert into public.reminders (pet_id, created_by, type, title, due_at, client_request_id)
values ('e7000000-0000-4000-8000-000000000001', null, 'bath', 'Sin creador', now() + interval '1 day', 'ab000000-0000-4000-8000-000000000002');
select is(
  (select count(*)::int from public.reminders where created_by is null and client_request_id = 'ab000000-0000-4000-8000-000000000002'),
  2, 'sin creador: dos filas con created_by NULL y la misma clave no chocan');

-- =====================================================================
-- 5. Borrado real de la cuenta (D-11, migración *_account_deletion_audit_triggers.sql)
-- =====================================================================
insert into auth.users (id, email, aud, role) values
  ('e6000000-0000-4000-8000-000000000005', 'rcrid-e@example.test', 'authenticated', 'authenticated');
insert into public.reminders (pet_id, created_by, type, title, due_at, client_request_id)
values ('e7000000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000005', 'bath', 'De E', now() + interval '1 day', 'ab000000-0000-4000-8000-000000000007');
select lives_ok(
  $$ delete from auth.users where id = 'e6000000-0000-4000-8000-000000000005' $$,
  'cuenta borrada: se puede borrar aunque creó un recordatorio con clave');
select results_eq(
  $$ select created_by, title from public.reminders where client_request_id = 'ab000000-0000-4000-8000-000000000007' $$,
  $$ values (null::uuid, 'De E') $$,
  'cuenta borrada: la fila se queda sin autor y conserva su clave');
select lives_ok(
  $$ select test_helpers.create_reminder('e7000000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000001', 'ab000000-0000-4000-8000-000000000007', 'De A') $$,
  'cuenta borrada: la misma clave en otra cuenta no choca con esa fila');

select * from finish();
rollback;
