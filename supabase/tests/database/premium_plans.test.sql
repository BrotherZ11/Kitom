-- =====================================================================
-- KITOM · Kitom Premium (*_premium_plans.sql)
-- =====================================================================
-- pgTAP. Solo contra la BD local: `npx supabase test db`, o
--   docker exec -i supabase_db_Kitom psql -U postgres -d postgres -f - < supabase/tests/database/premium_plans.test.sql
-- Todo ocurre en una transacción que termina en ROLLBACK. Requiere los catálogos
-- (supabase/seed.sql: especies).
-- Cubre: privilegios (get_my_plan, apply_subscription_state, tablas de
-- suscripción), plan efectivo (caducado, cancelado, gracia), cupo de IA,
-- get_my_plan, límite de mascotas (alta repetida con la misma clave,
-- transferencias y service_role sin límite), invitar co-tutores solo con
-- Premium (sin revelar emails) y apply_subscription_state (idempotencia,
-- estado antiguo, cuenta desconocida, compra que cambia de cuenta).
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

create function test_helpers.state_of(statement text) returns text
  language plpgsql as $$
declare
  v_state text;
begin
  execute statement;
  return 'ok';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate;
  return v_state;
end $$;

create function test_helpers.is_premium(uid uuid) returns boolean
  language sql security definer as $$ select private.is_premium(uid) $$;

create function test_helpers.add_ai_usage(uid uuid, n integer) returns void
  language sql security definer as $$
  insert into private.ai_analysis_usage (analysis_id, user_id, counts)
  select gen_random_uuid(), uid, true from generate_series(1, n);
$$;

grant execute on all functions in schema test_helpers to anon, authenticated;

-- Fran (gratuito), Pía (Premium), Iker (invitable) y Rut (la que recibe una compra).
insert into auth.users (id, email, aud, role, raw_user_meta_data, email_confirmed_at) values
  ('ac000000-0000-4000-8000-000000000001', 'pp-free@example.test',    'authenticated', 'authenticated', '{"full_name":"Fran"}', now()),
  ('ac000000-0000-4000-8000-000000000002', 'pp-premium@example.test', 'authenticated', 'authenticated', '{"full_name":"Pía"}', now()),
  ('ac000000-0000-4000-8000-000000000003', 'pp-invitee@example.test', 'authenticated', 'authenticated', '{"full_name":"Iker"}', now()),
  ('ac000000-0000-4000-8000-000000000004', 'pp-other@example.test',   'authenticated', 'authenticated', '{"full_name":"Rut"}', now());

update public.subscriptions
set plan = 'premium', status = 'active', current_period_end = now() + interval '20 days'
where user_id = 'ac000000-0000-4000-8000-000000000002';

-- Una mascota de cada una (insertadas como postgres: sin límite).
insert into public.pets (id, owner_id, name, species_id)
select v.id::uuid, v.owner::uuid, v.name, s.id
from (values
  ('bc000000-0000-4000-8000-000000000001', 'ac000000-0000-4000-8000-000000000001', 'Nube'),
  ('bc000000-0000-4000-8000-000000000002', 'ac000000-0000-4000-8000-000000000002', 'Rayo')
) as v (id, owner, name)
join public.species s on s.code = 'dog';

-- ---------------------------------------------------------------------
-- 1. Esquema y privilegios
-- ---------------------------------------------------------------------
select has_function('public', 'get_my_plan', 'get_my_plan existe');
select ok(not has_function_privilege('anon', 'public.get_my_plan()', 'execute'), 'anon no ejecuta get_my_plan');
select ok(has_function_privilege('authenticated', 'public.get_my_plan()', 'execute'), 'authenticated sí');

select ok(not has_function_privilege(r,
  'public.apply_subscription_state(uuid, text, text, timestamptz, boolean, public.subscription_status, timestamptz, timestamptz, timestamptz, boolean, text, text, jsonb)',
  'execute'), format('%s no ejecuta apply_subscription_state', r))
from unnest(array['anon', 'authenticated']) as r;
select ok(has_function_privilege('service_role',
  'public.apply_subscription_state(uuid, text, text, timestamptz, boolean, public.subscription_status, timestamptz, timestamptz, timestamptz, boolean, text, text, jsonb)',
  'execute'), 'service_role sí ejecuta apply_subscription_state');

select ok(not has_table_privilege(r, t, p), format('%s sin %s en %s', r, p, t))
from unnest(array['anon', 'authenticated']) as r,
     unnest(array['public.subscriptions', 'public.subscription_events']) as t,
     unnest(array['INSERT', 'UPDATE', 'DELETE']) as p;
select ok(not has_table_privilege('anon', t, 'SELECT'), format('anon sin SELECT en %s', t))
from unnest(array['public.subscriptions', 'public.subscription_events']) as t;
select ok(not has_column_privilege('authenticated', 'public.subscriptions', 'provider_state_at', 'select'),
  'authenticated no lee provider_state_at');
select ok(has_column_privilege('authenticated', 'public.subscriptions', 'plan', 'select'),
  'authenticated sigue leyendo su plan');

-- Ni aunque lo intente con su sesión: sin privilegio.
select test_helpers.act_as('ac000000-0000-4000-8000-000000000001');
select is(
  test_helpers.state_of($$ update public.subscriptions set plan = 'premium' where user_id = 'ac000000-0000-4000-8000-000000000001' $$),
  '42501', 'un usuario no puede hacerse Premium con un UPDATE');
reset role;

-- ---------------------------------------------------------------------
-- 2. Plan efectivo
-- ---------------------------------------------------------------------
select ok(not test_helpers.is_premium('ac000000-0000-4000-8000-000000000001'), 'gratuito: no Premium');
select ok(test_helpers.is_premium('ac000000-0000-4000-8000-000000000002'), 'Premium activo');

update public.subscriptions set cancel_at_period_end = true where user_id = 'ac000000-0000-4000-8000-000000000002';
select ok(test_helpers.is_premium('ac000000-0000-4000-8000-000000000002'), 'cancelada pero dentro del periodo: sigue Premium');

update public.subscriptions set status = 'past_due' where user_id = 'ac000000-0000-4000-8000-000000000002';
select ok(test_helpers.is_premium('ac000000-0000-4000-8000-000000000002'), 'periodo de gracia (past_due): sigue Premium');

update public.subscriptions set status = 'active', current_period_end = now() - interval '1 minute'
where user_id = 'ac000000-0000-4000-8000-000000000002';
select ok(not test_helpers.is_premium('ac000000-0000-4000-8000-000000000002'),
  'periodo vencido aunque no llegara el webhook de caducidad: ya no es Premium');

update public.subscriptions set status = 'expired', current_period_end = now() + interval '20 days'
where user_id = 'ac000000-0000-4000-8000-000000000002';
select ok(not test_helpers.is_premium('ac000000-0000-4000-8000-000000000002'), 'estado expired: no Premium');

update public.subscriptions set status = 'trialing', cancel_at_period_end = false
where user_id = 'ac000000-0000-4000-8000-000000000002';
select ok(test_helpers.is_premium('ac000000-0000-4000-8000-000000000002'), 'en prueba gratuita: Premium');

update public.subscriptions set status = 'active' where user_id = 'ac000000-0000-4000-8000-000000000002';

-- ---------------------------------------------------------------------
-- 3. get_my_plan y cupo de IA
-- ---------------------------------------------------------------------
select test_helpers.act_as('ac000000-0000-4000-8000-000000000001');
select is(
  (select row(plan, is_premium, owned_pets, max_owned_pets, history_days, can_invite_co_owners, ai_monthly_used, ai_monthly_limit)::text
   from public.get_my_plan()),
  '(free,f,1,2,30,f,0,3)', 'get_my_plan del plan gratuito');
reset role;

select test_helpers.add_ai_usage('ac000000-0000-4000-8000-000000000001', 3);
select test_helpers.act_as('ac000000-0000-4000-8000-000000000001');
select is((select row(can_request, would_use_full_history, monthly_used, monthly_limit)::text from public.get_ai_analysis_entitlement()),
  '(f,f,3,3)', 'gratuito con 3 consultas este mes: sin cupo');
select is((select ai_monthly_used from public.get_my_plan()), 3, 'get_my_plan cuenta las consultas del mes');
reset role;

select test_helpers.add_ai_usage('ac000000-0000-4000-8000-000000000002', 7);
select test_helpers.act_as('ac000000-0000-4000-8000-000000000002');
select is((select row(can_request, would_use_full_history, monthly_used, monthly_limit)::text from public.get_ai_analysis_entitlement()),
  '(t,t,7,)', 'Premium: sin límite mensual y con historial completo');
select is(
  (select row(plan, is_premium, max_owned_pets, history_days, can_invite_co_owners, ai_monthly_limit)::text from public.get_my_plan()),
  '(premium,t,,,t,)', 'get_my_plan de Premium: sin límites');
reset role;

-- Premium caducado: vuelve al cupo gratuito.
update public.subscriptions set current_period_end = now() - interval '1 day' where user_id = 'ac000000-0000-4000-8000-000000000002';
select test_helpers.act_as('ac000000-0000-4000-8000-000000000002');
select is((select row(can_request, monthly_limit)::text from public.get_ai_analysis_entitlement()),
  '(f,3)', 'Premium caducado: vuelve al límite de 3');
select is((select row(plan, is_premium)::text from public.get_my_plan()),
  '(premium,f)', 'get_my_plan distingue el plan guardado del efectivo');
reset role;
update public.subscriptions set current_period_end = now() + interval '20 days' where user_id = 'ac000000-0000-4000-8000-000000000002';

-- ---------------------------------------------------------------------
-- 4. Límite de mascotas
-- ---------------------------------------------------------------------
select test_helpers.act_as('ac000000-0000-4000-8000-000000000001');
select lives_ok(
  $$ insert into public.pets (owner_id, name, species_id, client_request_id)
     select 'ac000000-0000-4000-8000-000000000001', 'Brisa', id, 'cc000000-0000-4000-8000-000000000001'
     from public.species where code = 'cat' $$,
  'gratuito: la segunda mascota se crea');
select is(
  test_helpers.hint_of($$ insert into public.pets (owner_id, name, species_id)
     select 'ac000000-0000-4000-8000-000000000001', 'Tercera', id from public.species where code = 'cat' $$),
  'pet_limit_reached', 'gratuito: la tercera no (pet_limit_reached)');
select is(
  test_helpers.state_of($$ insert into public.pets (owner_id, name, species_id, client_request_id)
     select 'ac000000-0000-4000-8000-000000000001', 'Brisa', id, 'cc000000-0000-4000-8000-000000000001'
     from public.species where code = 'cat' $$),
  '23505', 'el reenvío de un alta ya creada sigue dando 23505 (el motor la reconoce), no el límite');
reset role;

-- Una mascota archivada no cuenta.
update public.pets set is_active = false where id = 'bc000000-0000-4000-8000-000000000001';
select test_helpers.act_as('ac000000-0000-4000-8000-000000000001');
select lives_ok(
  $$ insert into public.pets (owner_id, name, species_id)
     select 'ac000000-0000-4000-8000-000000000001', 'Tras archivar', id from public.species where code = 'dog' $$,
  'una mascota archivada no cuenta para el límite');
select is((select owned_pets from public.get_my_plan()), 2, 'get_my_plan cuenta solo las activas');
reset role;

-- Premium: sin límite.
select test_helpers.act_as('ac000000-0000-4000-8000-000000000002');
select lives_ok(
  $$ insert into public.pets (owner_id, name, species_id)
     select 'ac000000-0000-4000-8000-000000000002', 'P' || g, s.id
     from public.species s, generate_series(1, 4) g where s.code = 'dog' $$,
  'Premium: cinco mascotas propias');
reset role;

-- service_role (sin auth.uid()) no se limita.
select lives_ok(
  $$ insert into public.pets (owner_id, name, species_id)
     select 'ac000000-0000-4000-8000-000000000001', 'Servicio', id from public.species where code = 'dog' $$,
  'un alta sin sesión de usuario (servicio) no se limita');

-- Una transferencia a una cuenta gratuita con el límite cubierto se permite
-- (es un UPDATE, no un alta; también la usa delete-account).
insert into public.pet_co_owners (pet_id, user_id, invited_by, role, status, accepted_at)
select id, 'ac000000-0000-4000-8000-000000000001', 'ac000000-0000-4000-8000-000000000002', 'editor', 'accepted', now()
from public.pets where owner_id = 'ac000000-0000-4000-8000-000000000002' and name = 'P1';
select test_helpers.act_as('ac000000-0000-4000-8000-000000000002');
select lives_ok(
  $$ select public.transfer_pet_ownership(
       (select id from public.pets where owner_id = 'ac000000-0000-4000-8000-000000000002' and name = 'P1'),
       'ac000000-0000-4000-8000-000000000001') $$,
  'una transferencia no pasa por el límite de altas');
reset role;

-- ---------------------------------------------------------------------
-- 5. Invitar co-tutores
-- ---------------------------------------------------------------------
select test_helpers.act_as('ac000000-0000-4000-8000-000000000001');
select is(
  test_helpers.hint_of($$ select public.invite_pet_member_by_email('bc000000-0000-4000-8000-000000000001', 'pp-invitee@example.test', 'editor') $$),
  'not_pet_owner', 'sobre una mascota archivada sigue siendo not_pet_owner (orden de comprobaciones)');
reset role;
update public.pets set is_active = true where id = 'bc000000-0000-4000-8000-000000000001';

select test_helpers.act_as('ac000000-0000-4000-8000-000000000001');
select is(
  test_helpers.hint_of($$ select public.invite_pet_member_by_email('bc000000-0000-4000-8000-000000000001', 'pp-invitee@example.test', 'editor') $$),
  'premium_required', 'gratuito: invitar a una cuenta existente pide Premium');
select is(
  test_helpers.hint_of($$ select public.invite_pet_member_by_email('bc000000-0000-4000-8000-000000000001', 'nadie@example.test', 'editor') $$),
  'premium_required', 'gratuito: con un email sin cuenta, la misma respuesta (no revela cuentas)');
select is(
  test_helpers.hint_of($$ select public.invite_pet_member_by_email('bc000000-0000-4000-8000-000000000001', 'no-es-un-email', 'editor') $$),
  'premium_required', 'gratuito: Premium se comprueba antes que el formato del email');
select is(
  test_helpers.hint_of($$ select public.invite_pet_member('bc000000-0000-4000-8000-000000000001', 'ac000000-0000-4000-8000-000000000003', 'editor') $$),
  'premium_required', 'gratuito: invite_pet_member (por id) también pide Premium');
select is(
  test_helpers.hint_of($$ select public.invite_pet_member_by_email('bc000000-0000-4000-8000-000000000002', 'pp-invitee@example.test', 'editor') $$),
  'not_pet_owner', 'sobre una mascota ajena: not_pet_owner, como antes');
reset role;

select is((select count(*)::int from public.pet_co_owners where pet_id = 'bc000000-0000-4000-8000-000000000001'), 0,
  'ninguna invitación creada sin Premium');

select test_helpers.act_as('ac000000-0000-4000-8000-000000000002');
select lives_ok(
  $$ select public.invite_pet_member_by_email('bc000000-0000-4000-8000-000000000002', 'pp-invitee@example.test', 'editor') $$,
  'Premium: invita');
reset role;
select is((select status::text from public.pet_co_owners
           where pet_id = 'bc000000-0000-4000-8000-000000000002' and user_id = 'ac000000-0000-4000-8000-000000000003'),
  'pending', 'la invitación queda pendiente');

-- Aceptar no exige Premium.
select test_helpers.act_as('ac000000-0000-4000-8000-000000000003');
select lives_ok(
  $$ select public.accept_pet_invitation(
       (select id from public.pet_co_owners where pet_id = 'bc000000-0000-4000-8000-000000000002'
        and user_id = 'ac000000-0000-4000-8000-000000000003')) $$,
  'una cuenta gratuita acepta una invitación');
reset role;

-- ---------------------------------------------------------------------
-- 6. apply_subscription_state
-- ---------------------------------------------------------------------
select is(
  public.apply_subscription_state('ac000000-0000-4000-8000-000000000001', 'evt-1', 'INITIAL_PURCHASE', now(), true, 'trialing',
    now(), now() + interval '7 days', now() + interval '7 days', false, 'revenuecat', 'GPA.1', '{"store":"PLAY_STORE"}'),
  'applied', 'aplica una compra');
select is(
  (select row(plan, status, cancel_at_period_end, provider, provider_subscription_id)::text from public.subscriptions
   where user_id = 'ac000000-0000-4000-8000-000000000001'),
  '(premium,trialing,f,revenuecat,GPA.1)', 'queda Premium en prueba');
select ok(test_helpers.is_premium('ac000000-0000-4000-8000-000000000001'), 'y es Premium efectivo');

select is(
  public.apply_subscription_state('ac000000-0000-4000-8000-000000000001', 'evt-1', 'INITIAL_PURCHASE', now(), false, 'expired',
    null, null, null, false, 'revenuecat', null, null),
  'duplicate', 'el mismo evento dos veces: no-op');
select ok(test_helpers.is_premium('ac000000-0000-4000-8000-000000000001'), 'el duplicado no cambia nada');

select is(
  public.apply_subscription_state('ac000000-0000-4000-8000-000000000001', 'evt-0', 'RENEWAL', now() - interval '1 hour', false, 'expired',
    null, null, null, false, 'revenuecat', null, null),
  'stale', 'un estado leído antes que el guardado no lo pisa');
select ok(test_helpers.is_premium('ac000000-0000-4000-8000-000000000001'), 'sigue Premium tras el estado antiguo');
select is((select count(*)::int from public.subscription_events e join public.subscriptions s on s.id = e.subscription_id
           where s.user_id = 'ac000000-0000-4000-8000-000000000001'), 2,
  'el evento antiguo queda registrado aunque no se aplique');

select is(
  public.apply_subscription_state('ac000000-0000-4000-8000-000000000099', 'evt-x', 'RENEWAL', now(), true, 'active',
    null, null, null, false, 'revenuecat', null, null),
  'unknown_user', 'una cuenta que no existe: unknown_user, sin error');

select is(
  test_helpers.hint_of($$ select public.apply_subscription_state(null, 'evt-y', 'RENEWAL', now(), true, 'active',
    null, null, null, false, 'revenuecat', null, null) $$),
  'invalid_request', 'sin usuario: invalid_request');

-- La compra pasa a otra cuenta (TRANSFER): se suelta de la anterior sin chocar con el índice único.
select is(
  public.apply_subscription_state('ac000000-0000-4000-8000-000000000004', 'evt-2:ac000000-0000-4000-8000-000000000004', 'TRANSFER',
    now() + interval '1 second', true, 'active', now(), now() + interval '30 days', null, false, 'revenuecat', 'GPA.1', null),
  'applied', 'la compra se aplica a la cuenta nueva');
select is((select provider_subscription_id from public.subscriptions where user_id = 'ac000000-0000-4000-8000-000000000001'),
  null, 'y se suelta de la anterior');
select is(
  public.apply_subscription_state('ac000000-0000-4000-8000-000000000001', 'evt-2:ac000000-0000-4000-8000-000000000001', 'TRANSFER',
    now() + interval '1 second', false, 'expired', null, null, null, false, 'revenuecat', null, null),
  'applied', 'la anterior recibe su estado sin Premium');
select ok(not test_helpers.is_premium('ac000000-0000-4000-8000-000000000001'), 'la anterior ya no es Premium');
select ok(test_helpers.is_premium('ac000000-0000-4000-8000-000000000004'), 'la nueva sí');

-- Una cuenta sin fila de suscripción (anterior al trigger) recibe la suya.
delete from public.subscriptions where user_id = 'ac000000-0000-4000-8000-000000000003';
select is(
  public.apply_subscription_state('ac000000-0000-4000-8000-000000000003', 'evt-3', 'INITIAL_PURCHASE', now(), true, 'active',
    now(), now() + interval '30 days', null, false, 'revenuecat', 'GPA.3', null),
  'applied', 'sin fila previa, se crea y se aplica');
select ok(test_helpers.is_premium('ac000000-0000-4000-8000-000000000003'), 'y queda Premium');

select * from finish();
rollback;
