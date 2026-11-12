-- =====================================================================
-- KITOM · Quién lee los registros diarios (resumen de bienestar, fase 15)
-- =====================================================================
-- pgTAP. Solo local: `npx supabase test db`. El resumen se calcula en el
-- cliente con las filas que deja leer la RLS (`daily_logs: select members`
-- → is_pet_member): esta prueba fija que solo el propietario y los
-- co-tutores ACEPTADOS (editor o viewer) las leen, y que una invitación
-- pendiente, rechazada o revocada no ve nada, ni tras cambiar el rol.
-- Todo en una transacción con ROLLBACK.
-- =====================================================================
begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

create schema test_helpers;
grant usage on schema test_helpers to authenticated;

create function test_helpers.act_as(uid uuid) returns void
  language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create function test_helpers.visible_logs(p_pet uuid) returns integer
  language sql stable security invoker as $$
  select count(*)::int from public.daily_logs where pet_id = p_pet
$$;

grant execute on all functions in schema test_helpers to authenticated;

-- A owner · E editor · V viewer · P pendiente · D rechazada · R revocada · O ajeno
insert into auth.users (id, email, aud, role) values
  ('a2000000-0000-4000-8000-000000000001', 'ra-owner@example.test',    'authenticated', 'authenticated'),
  ('a2000000-0000-4000-8000-000000000002', 'ra-editor@example.test',   'authenticated', 'authenticated'),
  ('a2000000-0000-4000-8000-000000000003', 'ra-viewer@example.test',   'authenticated', 'authenticated'),
  ('a2000000-0000-4000-8000-000000000004', 'ra-pending@example.test',  'authenticated', 'authenticated'),
  ('a2000000-0000-4000-8000-000000000005', 'ra-declined@example.test', 'authenticated', 'authenticated'),
  ('a2000000-0000-4000-8000-000000000006', 'ra-revoked@example.test',  'authenticated', 'authenticated'),
  ('a2000000-0000-4000-8000-000000000007', 'ra-outsider@example.test', 'authenticated', 'authenticated');

insert into public.pets (id, owner_id, name, species_id)
select 'b2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'K', id
from public.species where code = 'dog';

insert into public.pet_co_owners (id, pet_id, user_id, invited_by, role, status, accepted_at) values
  ('c2000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000001', 'editor', 'accepted', now()),
  ('c2000000-0000-4000-8000-000000000003', 'b2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000001', 'viewer', 'accepted', now()),
  ('c2000000-0000-4000-8000-000000000004', 'b2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000004', 'a2000000-0000-4000-8000-000000000001', 'viewer', 'pending', null),
  ('c2000000-0000-4000-8000-000000000005', 'b2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000005', 'a2000000-0000-4000-8000-000000000001', 'editor', 'declined', null),
  ('c2000000-0000-4000-8000-000000000006', 'b2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000006', 'a2000000-0000-4000-8000-000000000001', 'editor', 'revoked', now());

-- Tres días de registros (como service_role no pasa la ventana de 7 días: aquí, dentro de ella).
insert into public.daily_logs (pet_id, logged_by, log_date, energy_level, species_data)
select 'b2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001',
       (now() at time zone 'UTC')::date - d, 3, '{"water": 3}'::jsonb
from generate_series(0, 2) as d;

select test_helpers.act_as('a2000000-0000-4000-8000-000000000001');
select is(test_helpers.visible_logs('b2000000-0000-4000-8000-000000000001'), 3, 'el propietario lee los 3 registros');
reset role;

select test_helpers.act_as('a2000000-0000-4000-8000-000000000002');
select is(test_helpers.visible_logs('b2000000-0000-4000-8000-000000000001'), 3, 'un editor aceptado los lee');
reset role;

select test_helpers.act_as('a2000000-0000-4000-8000-000000000003');
select is(test_helpers.visible_logs('b2000000-0000-4000-8000-000000000001'), 3, 'un viewer aceptado los lee');
select is((select species_data->>'water' from public.daily_logs where pet_id = 'b2000000-0000-4000-8000-000000000001' limit 1),
  '3', 'el viewer lee también los datos de la especie');
reset role;

select test_helpers.act_as('a2000000-0000-4000-8000-000000000004');
select is(test_helpers.visible_logs('b2000000-0000-4000-8000-000000000001'), 0, 'una invitación pendiente no ve nada');
reset role;

select test_helpers.act_as('a2000000-0000-4000-8000-000000000005');
select is(test_helpers.visible_logs('b2000000-0000-4000-8000-000000000001'), 0, 'una invitación rechazada no ve nada');
reset role;

select test_helpers.act_as('a2000000-0000-4000-8000-000000000006');
select is(test_helpers.visible_logs('b2000000-0000-4000-8000-000000000001'), 0, 'un acceso revocado no ve nada');
reset role;

select test_helpers.act_as('a2000000-0000-4000-8000-000000000007');
select is(test_helpers.visible_logs('b2000000-0000-4000-8000-000000000001'), 0, 'un ajeno no ve nada (lista vacía, sin error)');
reset role;

-- Cambio de rol: de editor a viewer sigue leyendo; al revocarlo deja de leer.
update public.pet_co_owners set role = 'viewer' where id = 'c2000000-0000-4000-8000-000000000002';
select test_helpers.act_as('a2000000-0000-4000-8000-000000000002');
select is(test_helpers.visible_logs('b2000000-0000-4000-8000-000000000001'), 3, 'de editor a viewer: sigue leyendo');
reset role;

update public.pet_co_owners set status = 'revoked' where id = 'c2000000-0000-4000-8000-000000000002';
select test_helpers.act_as('a2000000-0000-4000-8000-000000000002');
select is(test_helpers.visible_logs('b2000000-0000-4000-8000-000000000001'), 0, 'revocado después: deja de leer en la siguiente consulta');
reset role;

select * from finish();
rollback;
