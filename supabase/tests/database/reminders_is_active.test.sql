-- =====================================================================
-- KITOM · Pruebas de reminders.is_active (migración *_reminders_is_active.sql)
-- =====================================================================
-- pgTAP. Solo contra la BD local: `npx supabase test db`, o
--   docker exec -i supabase_db_Kitom psql -U postgres -d postgres -f - < supabase/tests/database/reminders_is_active.test.sql
-- Todo ocurre en una transacción que termina en ROLLBACK. Requiere el catálogo
-- de especies (supabase/seed.sql). Los permisos generales de reminders están
-- en reminders.test.sql.
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

create function test_helpers.reset_role() returns void
  language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

grant execute on all functions in schema test_helpers to anon, authenticated;

-- ---------------------------------------------------------------------
-- 1. Columna y grants
-- ---------------------------------------------------------------------
select has_column('public', 'reminders', 'is_active', 'reminders tiene is_active');
select col_type_is('public', 'reminders', 'is_active', 'boolean', 'is_active es boolean');
select col_not_null('public', 'reminders', 'is_active', 'is_active no admite NULL');
select col_default_is('public', 'reminders', 'is_active', 'true', 'is_active es true por defecto');
select ok(
  has_column_privilege('authenticated', 'public.reminders', 'is_active', 'INSERT')
    and has_column_privilege('authenticated', 'public.reminders', 'is_active', 'UPDATE'),
  'authenticated puede escribir is_active al crear y al editar'
);
select ok(
  not has_column_privilege('authenticated', 'public.reminders', 'pet_id', 'UPDATE')
    and not has_column_privilege('authenticated', 'public.reminders', 'created_by', 'UPDATE'),
  'la migración no abre pet_id ni created_by'
);

-- ---------------------------------------------------------------------
-- 2. Datos
-- ---------------------------------------------------------------------
insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('e3000000-0000-4000-8000-000000000001', 'owner-act@example.test', 'authenticated', 'authenticated', '{"full_name":"Olga"}'),
  ('e3000000-0000-4000-8000-000000000002', 'editor-act@example.test', 'authenticated', 'authenticated', '{"full_name":"Edu"}'),
  ('e3000000-0000-4000-8000-000000000003', 'viewer-act@example.test', 'authenticated', 'authenticated', '{"full_name":"Vera"}'),
  ('e3000000-0000-4000-8000-000000000004', 'other-act@example.test', 'authenticated', 'authenticated', '{"full_name":"Otto"}');

insert into public.pets (id, owner_id, name, species_id)
select 'e4000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001', 'Kika', s.id
from public.species s where s.code = 'cat';

insert into public.pet_co_owners (pet_id, user_id, role, status, invited_by, accepted_at) values
  ('e4000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000002', 'editor', 'accepted', 'e3000000-0000-4000-8000-000000000001', now()),
  ('e4000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000003', 'viewer', 'accepted', 'e3000000-0000-4000-8000-000000000001', now());

insert into public.reminders (id, pet_id, created_by, type, title, due_at) values
  ('e5000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001',
   'medication', 'Antibiótico', now() + interval '1 day');

select is(
  (select is_active from public.reminders where id = 'e5000000-0000-4000-8000-000000000001'),
  true, 'un recordatorio creado sin is_active queda activo'
);

-- ---------------------------------------------------------------------
-- 3. Quién puede activarlo y desactivarlo
-- ---------------------------------------------------------------------
select test_helpers.act_as('e3000000-0000-4000-8000-000000000003');
select results_eq(
  $$ with u as (update public.reminders set is_active = false where id = 'e5000000-0000-4000-8000-000000000001' returning 1)
     select count(*)::int from u $$,
  $$ values (0) $$,
  'el co-tutor lector no puede desactivarlo'
);

select test_helpers.act_as('e3000000-0000-4000-8000-000000000004');
select results_eq(
  $$ with u as (update public.reminders set is_active = false where id = 'e5000000-0000-4000-8000-000000000001' returning 1)
     select count(*)::int from u $$,
  $$ values (0) $$,
  'otra cuenta no puede desactivarlo'
);

select test_helpers.act_as('e3000000-0000-4000-8000-000000000002');
select results_eq(
  $$ with u as (update public.reminders set is_active = false where id = 'e5000000-0000-4000-8000-000000000001' returning is_active)
     select * from u $$,
  $$ values (false) $$,
  'la co-tutora editora lo desactiva'
);
select is(
  (select status::text from public.reminders where id = 'e5000000-0000-4000-8000-000000000001'),
  'pending', 'desactivar no cambia status (sigue pendiente)'
);
select is(
  (select completed_at from public.reminders where id = 'e5000000-0000-4000-8000-000000000001'),
  null, 'ni pone completed_at'
);

select test_helpers.act_as('e3000000-0000-4000-8000-000000000001');
select results_eq(
  $$ with u as (update public.reminders set is_active = true where id = 'e5000000-0000-4000-8000-000000000001' returning is_active)
     select * from u $$,
  $$ values (true) $$,
  'la propietaria lo vuelve a activar'
);
select lives_ok(
  $$ insert into public.reminders (pet_id, created_by, type, title, due_at, is_active)
     values ('e4000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001', 'bath', 'Baño en pausa', now() + interval '2 days', false)
     returning id, is_active $$,
  'se puede crear ya desactivado'
);
select throws_ok(
  $$ update public.reminders set is_active = null where id = 'e5000000-0000-4000-8000-000000000001' $$,
  '23502', null,
  'is_active no acepta NULL'
);

select test_helpers.act_as('e3000000-0000-4000-8000-000000000003');
select is(
  (select count(*)::int from public.reminders where pet_id = 'e4000000-0000-4000-8000-000000000001' and not is_active),
  1, 'el lector ve si un recordatorio está desactivado'
);

select test_helpers.reset_role();
select * from finish();
rollback;
