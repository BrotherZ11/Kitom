-- =====================================================================
-- KITOM · Pruebas de permisos de reminders (esquema base, sin migraciones nuevas)
-- =====================================================================
-- pgTAP. Solo contra la BD local: `npx supabase test db`, o
--   docker exec -i supabase_db_Kitom psql -U postgres -d postgres -f - < supabase/tests/database/reminders.test.sql
-- Todo ocurre en una transacción que termina en ROLLBACK. Requiere el catálogo
-- de especies (supabase/seed.sql).
-- Cubre lo que la agenda de la app da por hecho: RLS por can_edit_pet /
-- is_pet_member, GRANT por columna (pet_id y created_by no se cambian),
-- trigger protect_reminder_audit_fields, sync_reminder_completion, CHECK de
-- recurrence_rule y la precondición eq('updated_at', base) de las ediciones.
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

grant execute on all functions in schema test_helpers to anon, authenticated;

-- Propietaria, co-tutora editora, co-tutor lector, editora con la invitación sin aceptar y otra cuenta
-- (con su propia mascota, para intentar mover recordatorios a ella).
insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('e0000000-0000-4000-8000-000000000001', 'owner-rem@example.test', 'authenticated', 'authenticated', '{"full_name":"Olga"}'),
  ('e0000000-0000-4000-8000-000000000002', 'editor-rem@example.test', 'authenticated', 'authenticated', '{"full_name":"Edu"}'),
  ('e0000000-0000-4000-8000-000000000003', 'viewer-rem@example.test', 'authenticated', 'authenticated', '{"full_name":"Vera"}'),
  ('e0000000-0000-4000-8000-000000000004', 'pending-rem@example.test', 'authenticated', 'authenticated', '{"full_name":"Pía"}'),
  ('e0000000-0000-4000-8000-000000000005', 'other-rem@example.test', 'authenticated', 'authenticated', '{"full_name":"Otto"}');

insert into public.pets (id, owner_id, name, species_id)
select v.id, v.owner_id, v.name, s.id
from public.species s,
  (values
    ('e1000000-0000-4000-8000-000000000001'::uuid, 'e0000000-0000-4000-8000-000000000001'::uuid, 'Kika'),
    ('e1000000-0000-4000-8000-000000000002'::uuid, 'e0000000-0000-4000-8000-000000000001'::uuid, 'Nala'),
    ('e1000000-0000-4000-8000-000000000003'::uuid, 'e0000000-0000-4000-8000-000000000005'::uuid, 'Rex')
  ) as v(id, owner_id, name)
where s.code = 'dog';

insert into public.pet_co_owners (pet_id, user_id, role, status, invited_by, accepted_at) values
  ('e1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002', 'editor', 'accepted', 'e0000000-0000-4000-8000-000000000001', now()),
  ('e1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000003', 'viewer', 'accepted', 'e0000000-0000-4000-8000-000000000001', now()),
  ('e1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000004', 'editor', 'pending', 'e0000000-0000-4000-8000-000000000001', null);

-- Un recordatorio «leído antes» (updated_at anterior: en la transacción now() no avanza).
insert into public.reminders (id, pet_id, created_by, type, title, due_at, created_at, updated_at) values
  ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001',
   'vaccine', 'Rabia', now() + interval '2 days', now() - interval '1 day', now() - interval '1 day');

-- ---------------------------------------------------------------------
-- 1. Crear
-- ---------------------------------------------------------------------
select test_helpers.act_as('e0000000-0000-4000-8000-000000000001');
select lives_ok(
  $$ insert into public.reminders (pet_id, created_by, type, title, due_at, recurrence_rule)
     values ('e1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'medication', 'Pastilla', now() + interval '1 hour', 'FREQ=DAILY')
     returning id $$,
  'la propietaria crea un recordatorio (con RETURNING, como insert().select())'
);

select test_helpers.act_as('e0000000-0000-4000-8000-000000000002');
select lives_ok(
  $$ insert into public.reminders (pet_id, created_by, type, title, due_at)
     values ('e1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002', 'bath', 'Baño', now() + interval '3 days')
     returning id $$,
  'la co-tutora editora crea un recordatorio'
);
select throws_ok(
  $$ insert into public.reminders (pet_id, created_by, type, title, due_at)
     values ('e1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'bath', 'Suplantado', now()) $$,
  '42501', null,
  'la editora no puede crear a nombre de otra cuenta (created_by = auth.uid())'
);

select test_helpers.act_as('e0000000-0000-4000-8000-000000000003');
select throws_ok(
  $$ insert into public.reminders (pet_id, created_by, type, title, due_at)
     values ('e1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000003', 'bath', 'Lector', now()) $$,
  '42501', null,
  'el co-tutor lector no puede crear'
);

select test_helpers.act_as('e0000000-0000-4000-8000-000000000004');
select throws_ok(
  $$ insert into public.reminders (pet_id, created_by, type, title, due_at)
     values ('e1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000004', 'bath', 'Sin aceptar', now()) $$,
  '42501', null,
  'una invitación de editora sin aceptar no da permiso para crear'
);

select test_helpers.act_as('e0000000-0000-4000-8000-000000000005');
select throws_ok(
  $$ insert into public.reminders (pet_id, created_by, type, title, due_at)
     values ('e1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000005', 'bath', 'Ajeno', now()) $$,
  '42501', null,
  'otra cuenta no puede crear en una mascota ajena'
);

select test_helpers.act_as_anon();
select throws_ok(
  $$ insert into public.reminders (pet_id, created_by, type, title, due_at)
     values ('e1000000-0000-4000-8000-000000000001', null, 'bath', 'Anónimo', now()) $$,
  '42501', null,
  'sin sesión no se puede crear'
);

select test_helpers.act_as('e0000000-0000-4000-8000-000000000001');
select throws_ok(
  $$ insert into public.reminders (pet_id, created_by, type, title, due_at, recurrence_rule)
     values ('e1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'bath', 'Regla', now(), 'cada lunes') $$,
  '23514', null,
  'recurrence_rule fuera de FREQ=DAILY|WEEKLY|MONTHLY|YEARLY se rechaza'
);
select throws_ok(
  $$ insert into public.reminders (pet_id, created_by, type, title, due_at, status)
     values ('e1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'bath', 'Mal tipo', now(), 'paused') $$,
  '22P02', null,
  'status solo admite los valores del enum'
);

-- ---------------------------------------------------------------------
-- 2. Leer
-- ---------------------------------------------------------------------
select test_helpers.act_as('e0000000-0000-4000-8000-000000000003');
select is(
  (select count(*)::int from public.reminders where pet_id = 'e1000000-0000-4000-8000-000000000001'),
  3, 'el co-tutor lector ve los recordatorios de la mascota'
);

select test_helpers.act_as('e0000000-0000-4000-8000-000000000004');
select is((select count(*)::int from public.reminders), 0, 'con la invitación sin aceptar no se ve nada');

select test_helpers.act_as('e0000000-0000-4000-8000-000000000005');
select is((select count(*)::int from public.reminders), 0, 'otra cuenta no ve los recordatorios ajenos');

select test_helpers.act_as_anon();
select throws_ok(
  $$ select count(*) from public.reminders $$,
  '42501', null,
  'sin sesión no se puede leer (anon no tiene EXECUTE sobre is_pet_member)'
);

-- ---------------------------------------------------------------------
-- 3. Editar (con la precondición de la app)
-- ---------------------------------------------------------------------
select test_helpers.act_as('e0000000-0000-4000-8000-000000000003');
select results_eq(
  $$ with u as (update public.reminders set title = 'Lector' where id = 'e2000000-0000-4000-8000-000000000001' returning 1)
     select count(*)::int from u $$,
  $$ values (0) $$,
  'el co-tutor lector no puede editar (0 filas)'
);

select test_helpers.act_as('e0000000-0000-4000-8000-000000000005');
select results_eq(
  $$ with u as (update public.reminders set title = 'Ajeno' where id = 'e2000000-0000-4000-8000-000000000001' returning 1)
     select count(*)::int from u $$,
  $$ values (0) $$,
  'otra cuenta no puede editar (0 filas)'
);

select test_helpers.act_as('e0000000-0000-4000-8000-000000000002');
select results_eq(
  $$ with u as (
       update public.reminders set title = 'Rabia (refuerzo)'
       where id = 'e2000000-0000-4000-8000-000000000001' and updated_at = now() - interval '1 day'
       returning 1)
     select count(*)::int from u $$,
  $$ values (1) $$,
  'la editora edita con la versión que leyó (eq updated_at)'
);
select results_eq(
  $$ with u as (
       update public.reminders set title = 'Pisado'
       where id = 'e2000000-0000-4000-8000-000000000001' and updated_at = now() - interval '1 day'
       returning 1)
     select count(*)::int from u $$,
  $$ values (0) $$,
  'con una versión ya cambiada no se toca nada (la app lo trata como conflicto)'
);

-- Reasignar a otra mascota o cambiar quién lo creó: sin GRANT de UPDATE sobre esas columnas.
select throws_ok(
  $$ update public.reminders set pet_id = 'e1000000-0000-4000-8000-000000000003' where id = 'e2000000-0000-4000-8000-000000000001' $$,
  '42501', null,
  'la editora no puede mover un recordatorio a una mascota ajena'
);
select test_helpers.act_as('e0000000-0000-4000-8000-000000000001');
select throws_ok(
  $$ update public.reminders set pet_id = 'e1000000-0000-4000-8000-000000000002' where id = 'e2000000-0000-4000-8000-000000000001' $$,
  '42501', null,
  'ni la propietaria puede moverlo a otra mascota suya'
);
select throws_ok(
  $$ update public.reminders set created_by = 'e0000000-0000-4000-8000-000000000002' where id = 'e2000000-0000-4000-8000-000000000001' $$,
  '42501', null,
  'created_by no se puede cambiar'
);
select throws_ok(
  $$ update public.reminders set created_at = now() where id = 'e2000000-0000-4000-8000-000000000001' $$,
  '42501', null,
  'created_at no se puede cambiar'
);

-- Aunque alguien con privilegios lo intentara sin pasar por los grants, el trigger lo para.
select test_helpers.reset_role();
select set_config('request.jwt.claims', json_build_object('sub', 'e0000000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
select throws_ok(
  $$ update public.reminders set pet_id = 'e1000000-0000-4000-8000-000000000002' where id = 'e2000000-0000-4000-8000-000000000001' $$,
  'P0001', 'No se puede modificar pet_id de un recordatorio existente',
  'el trigger protect_reminder_audit_fields impide cambiar pet_id'
);
select test_helpers.reset_role();

-- ---------------------------------------------------------------------
-- 4. Hecho / pendiente (sync_reminder_completion)
-- ---------------------------------------------------------------------
select test_helpers.act_as('e0000000-0000-4000-8000-000000000002');
update public.reminders set status = 'completed' where id = 'e2000000-0000-4000-8000-000000000001';
select isnt(
  (select completed_at from public.reminders where id = 'e2000000-0000-4000-8000-000000000001'),
  null, 'al marcarlo hecho el servidor pone completed_at'
);
update public.reminders set status = 'pending' where id = 'e2000000-0000-4000-8000-000000000001';
select is(
  (select completed_at from public.reminders where id = 'e2000000-0000-4000-8000-000000000001'),
  null, 'al volver a pendiente se quita completed_at'
);

-- ---------------------------------------------------------------------
-- 5. Borrar
-- ---------------------------------------------------------------------
select test_helpers.act_as('e0000000-0000-4000-8000-000000000003');
select results_eq(
  $$ with d as (delete from public.reminders where title = 'Baño' returning 1) select count(*)::int from d $$,
  $$ values (0) $$,
  'el co-tutor lector no puede borrar'
);
select test_helpers.act_as('e0000000-0000-4000-8000-000000000005');
select results_eq(
  $$ with d as (delete from public.reminders where title = 'Baño' returning 1) select count(*)::int from d $$,
  $$ values (0) $$,
  'otra cuenta no puede borrar'
);
select test_helpers.act_as('e0000000-0000-4000-8000-000000000002');
select results_eq(
  $$ with d as (delete from public.reminders where title = 'Baño' returning 1) select count(*)::int from d $$,
  $$ values (1) $$,
  'la editora borra un recordatorio de la mascota'
);

-- ---------------------------------------------------------------------
-- 6. Perder el acceso
-- ---------------------------------------------------------------------
select test_helpers.reset_role();
delete from public.pet_co_owners
where pet_id = 'e1000000-0000-4000-8000-000000000001' and user_id = 'e0000000-0000-4000-8000-000000000002';

select test_helpers.act_as('e0000000-0000-4000-8000-000000000002');
select is((select count(*)::int from public.reminders), 0, 'sin la co-tutoría deja de ver los recordatorios');
select results_eq(
  $$ with u as (update public.reminders set title = 'Sin acceso' where id = 'e2000000-0000-4000-8000-000000000001' returning 1)
     select count(*)::int from u $$,
  $$ values (0) $$,
  'y ya no puede editarlos'
);

-- ---------------------------------------------------------------------
-- 7. Borrar la mascota se lleva sus recordatorios (al final: es destructivo)
-- ---------------------------------------------------------------------
select test_helpers.act_as('e0000000-0000-4000-8000-000000000001');
delete from public.pets where id = 'e1000000-0000-4000-8000-000000000001';
select test_helpers.reset_role();
select is(
  (select count(*)::int from public.reminders where pet_id = 'e1000000-0000-4000-8000-000000000001'),
  0, 'al borrar la mascota se borran en cascada sus recordatorios (2+ filas)'
);

select * from finish();
rollback;
