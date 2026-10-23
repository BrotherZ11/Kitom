-- =====================================================================
-- KITOM · Pruebas de co-tutores por email (migración *_pet_invitations_by_email.sql)
-- =====================================================================
-- pgTAP. Solo contra la BD local: `npx supabase test db`, o
--   docker exec -i supabase_db_Kitom psql -U postgres -d postgres -f - < supabase/tests/database/pet_invitations.test.sql
-- Todo ocurre en una transacción que termina en ROLLBACK. Requiere el catálogo
-- de especies (supabase/seed.sql).
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

-- Dueña, invitada, otra cuenta (el trigger handle_new_user crea los perfiles con su nombre).
insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('f0000000-0000-4000-8000-000000000001', 'owner-inv@example.test', 'authenticated', 'authenticated', '{"full_name":"Olga"}'),
  ('f0000000-0000-4000-8000-000000000002', 'guest-inv@example.test', 'authenticated', 'authenticated', '{"full_name":"Gema"}'),
  ('f0000000-0000-4000-8000-000000000003', 'other-inv@example.test', 'authenticated', 'authenticated', '{"full_name":"Otto"}');

insert into public.pets (id, owner_id, name, species_id)
select 'f1000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'Kika', s.id
from public.species s where s.code = 'dog';

insert into public.pets (id, owner_id, name, species_id, is_active)
select 'f1000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001', 'Archivada', s.id, false
from public.species s where s.code = 'dog';

-- ---------------------------------------------------------------------
-- 1. Invitar por email
-- ---------------------------------------------------------------------
select test_helpers.act_as('f0000000-0000-4000-8000-000000000001');

select lives_ok(
  $$ select public.invite_pet_member_by_email('f1000000-0000-4000-8000-000000000001', '  GUEST-inv@Example.test ', 'editor') $$,
  'la propietaria invita por email (sin distinguir mayúsculas ni espacios)'
);

select test_helpers.reset_role();
select results_eq(
  $$ select user_id, role::text, status::text, invited_by from public.pet_co_owners
     where pet_id = 'f1000000-0000-4000-8000-000000000001' $$,
  $$ values ('f0000000-0000-4000-8000-000000000002'::uuid, 'editor', 'pending', 'f0000000-0000-4000-8000-000000000001'::uuid) $$,
  'se crea una invitación pendiente con el rol pedido'
);

select test_helpers.act_as('f0000000-0000-4000-8000-000000000001');
select lives_ok(
  $$ select public.invite_pet_member_by_email('f1000000-0000-4000-8000-000000000001', 'nadie@example.test') $$,
  'un email sin cuenta responde igual (no revela si existe)'
);
select lives_ok(
  $$ select public.invite_pet_member_by_email('f1000000-0000-4000-8000-000000000001', 'owner-inv@example.test') $$,
  'el propio email responde igual'
);
select lives_ok(
  $$ select public.invite_pet_member_by_email('f1000000-0000-4000-8000-000000000001', 'guest-inv@example.test') $$,
  'invitar de nuevo a quien ya tiene una invitación activa responde igual'
);

select test_helpers.reset_role();
select is(
  (select count(*)::int from public.pet_co_owners where pet_id = 'f1000000-0000-4000-8000-000000000001'),
  1,
  'sin cuenta, el propio email o una invitación repetida no crean filas'
);

select test_helpers.act_as('f0000000-0000-4000-8000-000000000001');
select throws_ok(
  $$ select public.invite_pet_member_by_email('f1000000-0000-4000-8000-000000000001', 'sin-arroba') $$,
  'P0001', 'Email no válido',
  'un email sin formato válido se rechaza'
);
select throws_ok(
  $$ select public.invite_pet_member_by_email('f1000000-0000-4000-8000-000000000002', 'other-inv@example.test') $$,
  'P0001', 'Solo el propietario principal puede invitar co-tutores',
  'una mascota archivada no admite invitaciones'
);

-- Quien no es la propietaria no puede usarla (ni para sondear emails).
select test_helpers.act_as('f0000000-0000-4000-8000-000000000003');
select throws_ok(
  $$ select public.invite_pet_member_by_email('f1000000-0000-4000-8000-000000000001', 'guest-inv@example.test') $$,
  'P0001', 'Solo el propietario principal puede invitar co-tutores',
  'otra cuenta no puede invitar en una mascota ajena'
);

select test_helpers.act_as_anon();
select throws_ok(
  $$ select public.invite_pet_member_by_email('f1000000-0000-4000-8000-000000000001', 'guest-inv@example.test') $$,
  '42501', null,
  'anon no puede ejecutar la función'
);

-- ---------------------------------------------------------------------
-- 2. Invitaciones pendientes de la invitada
-- ---------------------------------------------------------------------
select test_helpers.act_as('f0000000-0000-4000-8000-000000000002');
select results_eq(
  $$ select pet_name, role::text, invited_by_name from public.get_my_pet_invitations() $$,
  $$ values ('Kika'::text, 'editor'::text, 'Olga'::text) $$,
  'la invitada ve el nombre de la mascota y de quien la invita'
);

select test_helpers.act_as('f0000000-0000-4000-8000-000000000003');
select is_empty(
  $$ select * from public.get_my_pet_invitations() $$,
  'otra cuenta no ve invitaciones ajenas'
);

-- ---------------------------------------------------------------------
-- 3. Miembros de la mascota
-- ---------------------------------------------------------------------
select test_helpers.act_as('f0000000-0000-4000-8000-000000000003');
select throws_ok(
  $$ select * from public.get_pet_members('f1000000-0000-4000-8000-000000000001') $$,
  'P0001', 'No tienes acceso a esta mascota',
  'quien no es miembro no ve los miembros'
);

select test_helpers.act_as('f0000000-0000-4000-8000-000000000001');
select results_eq(
  $$ select full_name, status::text from public.get_pet_members('f1000000-0000-4000-8000-000000000001') $$,
  $$ values ('Gema'::text, 'pending'::text) $$,
  'la propietaria ve la invitación pendiente con el nombre'
);

-- Al aceptar, deja de estar pendiente y pasa a ser miembro (puede ver los miembros).
select test_helpers.act_as('f0000000-0000-4000-8000-000000000002');
select lives_ok(
  $$ select public.accept_pet_invitation((select invitation_id from public.get_my_pet_invitations() limit 1)) $$,
  'la invitada acepta con la RPC existente'
);
select is_empty(
  $$ select * from public.get_my_pet_invitations() $$,
  'tras aceptar ya no tiene invitaciones pendientes'
);
select results_eq(
  $$ select full_name, status::text from public.get_pet_members('f1000000-0000-4000-8000-000000000001') $$,
  $$ values ('Gema'::text, 'accepted'::text) $$,
  'la nueva co-tutora ve los miembros'
);

select test_helpers.reset_role();

select * from finish();

rollback;
