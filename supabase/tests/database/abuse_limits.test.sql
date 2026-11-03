-- =====================================================================
-- KITOM · Límites de abuso de IA e invitaciones (*_abuse_limits_and_db_hardening.sql)
-- =====================================================================
-- pgTAP. Solo contra la BD local: `npx supabase test db`, o
--   docker exec -i supabase_db_Kitom psql -U postgres -d postgres -f - < supabase/tests/database/abuse_limits.test.sql
-- Todo ocurre en una transacción que termina en ROLLBACK. Requiere los catálogos
-- (supabase/seed.sql: especies y logros).
-- Cubre: 1 solicitud de IA por minuto (ai_rate_limited), 3 fallos por día UTC
-- (ai_failure_limit; ai_misconfigured no cuenta; sobreviven al borrado de la
-- mascota), reclamo con processing_started_at; invitaciones: 20 intentos en
-- 24 h (invite_rate_limited, también sin cuenta), qué cuenta y qué no, purga;
-- identidad oculta de las invitaciones pendientes (get_pet_members y la
-- política SELECT de pet_co_owners). Las carreras: concurrency/abuse_limits_concurrency.sh.
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

-- Lo que pasaría esperando un minuto (now() no avanza en la transacción).
create function test_helpers.age_ai_usage() returns void
  language sql security definer as $$
  update private.ai_analysis_usage set created_at = created_at - interval '61 seconds';
$$;

-- La Edge Function marca el último análisis de la usuaria como fallido con un código.
create function test_helpers.fail_last(uid uuid, code text) returns void
  language sql security definer as $$
  update public.ai_analysis_requests set status = 'failed', error_message = code
  where id = (select id from public.ai_analysis_requests
              where requested_by = uid and status <> 'failed'
              order by created_at desc, id limit 1);
$$;

create function test_helpers.usage_count(uid uuid) returns integer
  language sql security definer as $$
  select count(*)::int from private.ai_analysis_usage where user_id = uid;
$$;

create function test_helpers.attempts(uid uuid) returns integer
  language sql security definer as $$
  select count(*)::int from private.pet_invitation_attempts where inviter_id = uid;
$$;

grant execute on all functions in schema test_helpers to anon, authenticated;

-- IA: Pía (premium, sin cupo mensual que interfiera) y Fede (free). Invitaciones:
-- Olga (dueña), Inés (invitada), Teo (co-tutor aceptado), Luis (otra cuenta).
insert into auth.users (id, email, aud, role, raw_user_meta_data, email_confirmed_at) values
  ('a7000000-0000-4000-8000-000000000001', 'abuse-premium@example.test', 'authenticated', 'authenticated', '{"full_name":"Pía"}', now()),
  ('a7000000-0000-4000-8000-000000000002', 'abuse-free@example.test', 'authenticated', 'authenticated', '{"full_name":"Fede"}', now()),
  ('a7000000-0000-4000-8000-000000000011', 'abuse-owner@example.test', 'authenticated', 'authenticated', '{"full_name":"Olga"}', now()),
  ('a7000000-0000-4000-8000-000000000012', 'abuse-guest@example.test', 'authenticated', 'authenticated', '{"full_name":"Inés"}', now()),
  ('a7000000-0000-4000-8000-000000000013', 'abuse-member@example.test', 'authenticated', 'authenticated', '{"full_name":"Teo"}', now()),
  ('a7000000-0000-4000-8000-000000000014', 'abuse-other@example.test', 'authenticated', 'authenticated', '{"full_name":"Luis"}', now());

update public.profiles set disclaimer_accepted_at = now(), disclaimer_version = '1.0'
where id in ('a7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000002');
update public.subscriptions set plan = 'premium' where user_id = 'a7000000-0000-4000-8000-000000000001';

insert into public.pets (id, owner_id, name, species_id)
select v.id, v.owner_id, v.name, s.id
from (values
  ('a8000000-0000-4000-8000-000000000001'::uuid, 'a7000000-0000-4000-8000-000000000001'::uuid, 'Nube'),
  ('a8000000-0000-4000-8000-000000000002'::uuid, 'a7000000-0000-4000-8000-000000000002'::uuid, 'Rayo'),
  ('a8000000-0000-4000-8000-000000000011'::uuid, 'a7000000-0000-4000-8000-000000000011'::uuid, 'Kira')
) as v (id, owner_id, name)
cross join public.species s where s.code = 'dog';

insert into public.pet_co_owners (pet_id, user_id, invited_by, role, status, accepted_at) values
  ('a8000000-0000-4000-8000-000000000011', 'a7000000-0000-4000-8000-000000000013',
   'a7000000-0000-4000-8000-000000000011', 'editor', 'accepted', now());

-- ---------------------------------------------------------------------
-- 1. IA: una solicitud por minuto (SEC-21)
-- ---------------------------------------------------------------------
select test_helpers.act_as('a7000000-0000-4000-8000-000000000001');

select lives_ok($$ select public.request_ai_analysis('a8000000-0000-4000-8000-000000000001', null) $$,
  'frecuencia: la primera solicitud pasa');
select is(
  test_helpers.hint_of($$ select public.request_ai_analysis('a8000000-0000-4000-8000-000000000001', null) $$),
  'ai_rate_limited',
  'frecuencia: otra en el mismo minuto se rechaza con ai_rate_limited');
select throws_like(
  $$ select public.request_ai_analysis('a8000000-0000-4000-8000-000000000001', null) $$,
  'Espera un minuto%',
  'frecuencia: con un mensaje legible');
select is(test_helpers.usage_count('a7000000-0000-4000-8000-000000000001'), 1,
  'frecuencia: la rechazada no deja fila en el registro');

-- Otro usuario no se ve afectado.
select test_helpers.act_as('a7000000-0000-4000-8000-000000000002');
select lives_ok($$ select public.request_ai_analysis('a8000000-0000-4000-8000-000000000002', null) $$,
  'frecuencia: es por usuario (otra cuenta pide a la vez)');

select test_helpers.age_ai_usage();
select test_helpers.act_as('a7000000-0000-4000-8000-000000000001');
select lives_ok($$ select public.request_ai_analysis('a8000000-0000-4000-8000-000000000001', null) $$,
  'frecuencia: pasado el minuto se puede volver a pedir');

-- ---------------------------------------------------------------------
-- 2. IA: tres fallos en el día UTC (SEC-06)
-- ---------------------------------------------------------------------
-- Pía tiene 2 solicitudes. Falla la última por configuración (no cuenta).
select test_helpers.fail_last('a7000000-0000-4000-8000-000000000001', 'ai_misconfigured');

select test_helpers.reset_role();
select results_eq(
  $$ select counts, failed_at is not null, failure_code from private.ai_analysis_usage
     where user_id = 'a7000000-0000-4000-8000-000000000001' order by counts desc, analysis_id $$,
  $$ values (true, false, null::text), (false, true, 'ai_misconfigured'::text) $$,
  'fallos: el registro anota cuándo y con qué código falló');

select test_helpers.fail_last('a7000000-0000-4000-8000-000000000001', 'ai_unavailable');
select test_helpers.age_ai_usage();
select test_helpers.act_as('a7000000-0000-4000-8000-000000000001');
select lives_ok($$ select public.request_ai_analysis('a8000000-0000-4000-8000-000000000001', null) $$,
  'fallos: con 1 fallo que cuenta (y uno de configuración) se sigue pudiendo pedir');
select test_helpers.fail_last('a7000000-0000-4000-8000-000000000001', 'invalid_json');
select test_helpers.age_ai_usage();
select lives_ok($$ select public.request_ai_analysis('a8000000-0000-4000-8000-000000000001', null) $$,
  'fallos: con 2 también');
select test_helpers.fail_last('a7000000-0000-4000-8000-000000000001', 'timeout');
select test_helpers.age_ai_usage();

select is(
  test_helpers.hint_of($$ select public.request_ai_analysis('a8000000-0000-4000-8000-000000000001', null) $$),
  'ai_failure_limit',
  'fallos: con 3 en el día, la siguiente se rechaza con ai_failure_limit');
select throws_like(
  $$ select public.request_ai_analysis('a8000000-0000-4000-8000-000000000001', null) $$,
  'Hoy no se han podido completar%',
  'fallos: con un mensaje legible (sin la palabra prohibida)');

-- Borrar la mascota no borra los fallos (registro sin FK a pets).
select lives_ok($$ delete from public.pets where id = 'a8000000-0000-4000-8000-000000000001' $$,
  'fallos: la dueña borra la mascota');
select test_helpers.reset_role();
insert into public.pets (id, owner_id, name, species_id)
select 'a8000000-0000-4000-8000-000000000003', 'a7000000-0000-4000-8000-000000000001', 'Nube 2', s.id
from public.species s where s.code = 'dog';
select test_helpers.act_as('a7000000-0000-4000-8000-000000000001');
select is(
  test_helpers.hint_of($$ select public.request_ai_analysis('a8000000-0000-4000-8000-000000000003', null) $$),
  'ai_failure_limit',
  'fallos: borrar y recrear la mascota no devuelve los intentos');

-- Los fallos de ayer (UTC) no cuentan.
select test_helpers.reset_role();
update private.ai_analysis_usage
set failed_at = date_trunc('day', now(), 'UTC') - interval '1 second'
where user_id = 'a7000000-0000-4000-8000-000000000001' and failed_at is not null;
select test_helpers.act_as('a7000000-0000-4000-8000-000000000001');
select lives_ok($$ select public.request_ai_analysis('a8000000-0000-4000-8000-000000000003', null) $$,
  'fallos: el límite es por día UTC (los de ayer no cuentan)');

-- Un fallo sigue sin gastar cupo mensual (free: 3 al mes).
select test_helpers.act_as('a7000000-0000-4000-8000-000000000002');
select test_helpers.fail_last('a7000000-0000-4000-8000-000000000002', 'ai_unavailable');
select results_eq(
  $$ select can_request, monthly_used from public.get_ai_analysis_entitlement() $$,
  $$ values (true, 0) $$,
  'fallos: un fallo no gasta cupo mensual');

-- ---------------------------------------------------------------------
-- 3. Reclamo con hora (SEC-16)
-- ---------------------------------------------------------------------
select throws_ok(
  $$ select public.claim_ai_analysis_for_processing(gen_random_uuid()) $$,
  '42501', null,
  'reclamo: authenticated no puede reclamar');

select test_helpers.reset_role();
select is(
  public.claim_ai_analysis_for_processing(
    (select id from public.ai_analysis_requests where pet_id = 'a8000000-0000-4000-8000-000000000003' and status = 'pending' limit 1)),
  true,
  'reclamo: el servicio reclama una pendiente');
select results_eq(
  $$ select status::text, processing_started_at = now() from public.ai_analysis_requests
     where pet_id = 'a8000000-0000-4000-8000-000000000003' $$,
  $$ values ('processing'::text, true) $$,
  'reclamo: queda en processing con processing_started_at');
select is(
  public.claim_ai_analysis_for_processing(
    (select id from public.ai_analysis_requests where pet_id = 'a8000000-0000-4000-8000-000000000003' limit 1)),
  false,
  'reclamo: no se puede reclamar dos veces');
select ok(
  not has_column_privilege('authenticated', 'public.ai_analysis_requests', 'processing_started_at', 'SELECT'),
  'reclamo: la columna no es visible para la app (grants por columna)');

-- ---------------------------------------------------------------------
-- 4. Invitaciones: la identidad de una pendiente queda oculta (SEC-04)
-- ---------------------------------------------------------------------
select test_helpers.act_as('a7000000-0000-4000-8000-000000000011');
select lives_ok(
  $$ select public.invite_pet_member_by_email('a8000000-0000-4000-8000-000000000011', 'abuse-guest@example.test') $$,
  'identidad: la dueña invita a Inés');

select results_eq(
  $$ select status::text, user_id, full_name from public.get_pet_members('a8000000-0000-4000-8000-000000000011')
     order by status $$,
  $$ values ('accepted'::text, 'a7000000-0000-4000-8000-000000000013'::uuid, 'Teo'::text),
            ('pending'::text, null::uuid, null::text) $$,
  'identidad: la dueña ve la invitación pendiente sin user_id ni nombre; al aceptado, con nombre');
select ok(
  (select invitation_id is not null from public.get_pet_members('a8000000-0000-4000-8000-000000000011')
   where status = 'pending'),
  'identidad: la pendiente conserva invitation_id (para anularla)');

-- Tampoco leyendo la tabla directamente (PostgREST): solo las aceptadas de los demás.
select results_eq(
  $$ select user_id, status::text from public.pet_co_owners where pet_id = 'a8000000-0000-4000-8000-000000000011' $$,
  $$ values ('a7000000-0000-4000-8000-000000000013'::uuid, 'accepted'::text) $$,
  'identidad: la dueña no lee la fila pendiente en pet_co_owners');

select test_helpers.act_as('a7000000-0000-4000-8000-000000000013');
select results_eq(
  $$ select status::text, user_id from public.get_pet_members('a8000000-0000-4000-8000-000000000011') order by status $$,
  $$ values ('accepted'::text, 'a7000000-0000-4000-8000-000000000013'::uuid), ('pending'::text, null::uuid) $$,
  'identidad: un co-tutor tampoco ve quién es la invitada');
select is(
  (select count(*)::int from public.pet_co_owners where pet_id = 'a8000000-0000-4000-8000-000000000011'),
  1,
  'identidad: el co-tutor solo lee su propia fila aceptada');

-- La invitada sí ve su propia fila y su invitación.
select test_helpers.act_as('a7000000-0000-4000-8000-000000000012');
select results_eq(
  $$ select user_id, status::text from public.pet_co_owners where pet_id = 'a8000000-0000-4000-8000-000000000011' $$,
  $$ values ('a7000000-0000-4000-8000-000000000012'::uuid, 'pending'::text) $$,
  'identidad: la invitada lee su propia fila pendiente');
select results_eq(
  $$ select pet_name, invited_by_name from public.get_my_pet_invitations() $$,
  $$ values ('Kira'::text, 'Olga'::text) $$,
  'identidad: y su invitación con el nombre de la mascota y de quien invita');

-- La dueña puede anular la pendiente por su invitation_id; una rechazada o
-- revocada tampoco la ve nadie más que la invitada.
select test_helpers.act_as('a7000000-0000-4000-8000-000000000011');
select lives_ok(
  $$ select public.revoke_pet_invitation(
       (select invitation_id from public.get_pet_members('a8000000-0000-4000-8000-000000000011') where status = 'pending')) $$,
  'identidad: la dueña anula la invitación pendiente con invitation_id');
select is(
  (select count(*)::int from public.pet_co_owners
   where pet_id = 'a8000000-0000-4000-8000-000000000011' and status <> 'accepted'),
  0,
  'identidad: la fila revocada no es visible para la dueña');

-- Invitada otra vez, acepta: ya se ve con su nombre.
select lives_ok(
  $$ select public.invite_pet_member_by_email('a8000000-0000-4000-8000-000000000011', 'abuse-guest@example.test', 'viewer') $$,
  'identidad: la dueña la invita de nuevo');
select test_helpers.act_as('a7000000-0000-4000-8000-000000000012');
select lives_ok(
  $$ select public.accept_pet_invitation((select invitation_id from public.get_my_pet_invitations() limit 1)) $$,
  'identidad: la invitada acepta');
select test_helpers.act_as('a7000000-0000-4000-8000-000000000011');
select results_eq(
  $$ select user_id, full_name from public.get_pet_members('a8000000-0000-4000-8000-000000000011')
     where user_id = 'a7000000-0000-4000-8000-000000000012' $$,
  $$ values ('a7000000-0000-4000-8000-000000000012'::uuid, 'Inés'::text) $$,
  'identidad: aceptada, la dueña ve su nombre');

-- ---------------------------------------------------------------------
-- 5. Invitaciones: 20 intentos en 24 h por propietario (SEC-04)
-- ---------------------------------------------------------------------
select is(test_helpers.attempts('a7000000-0000-4000-8000-000000000011'), 2,
  'límite: cada invitación por email cuenta un intento');

-- No cuentan: un email mal formado ni una mascota ajena.
select throws_ok(
  $$ select public.invite_pet_member_by_email('a8000000-0000-4000-8000-000000000011', 'sin-arroba') $$,
  'P0001', 'Email no válido', 'límite: un email mal formado se rechaza como siempre');
select test_helpers.act_as('a7000000-0000-4000-8000-000000000014');
select throws_ok(
  $$ select public.invite_pet_member_by_email('a8000000-0000-4000-8000-000000000011', 'x@example.test') $$,
  'P0001', 'Solo el propietario principal puede invitar co-tutores', 'límite: quien no es dueño se rechaza como siempre');
select is(test_helpers.attempts('a7000000-0000-4000-8000-000000000011'), 2,
  'límite: ni el email mal formado ni la mascota ajena cuentan');
select is(test_helpers.attempts('a7000000-0000-4000-8000-000000000014'), 0,
  'límite: ni dejan intentos a quien no es dueño');

-- 18 intentos más (cuentas inexistentes) hasta 20.
select test_helpers.act_as('a7000000-0000-4000-8000-000000000011');
select lives_ok(
  $$ select public.invite_pet_member_by_email('a8000000-0000-4000-8000-000000000011', 'nadie-' || g || '@example.test')
     from generate_series(1, 18) g $$,
  'límite: hasta 20 en 24 h, exista o no la cuenta');
select is(
  test_helpers.hint_of($$ select public.invite_pet_member_by_email('a8000000-0000-4000-8000-000000000011', 'nadie-21@example.test') $$),
  'invite_rate_limited',
  'límite: el 21.º se rechaza con invite_rate_limited (email sin cuenta)');
select is(
  test_helpers.hint_of($$ select public.invite_pet_member_by_email('a8000000-0000-4000-8000-000000000011', 'abuse-other@example.test') $$),
  'invite_rate_limited',
  'límite: y con un email con cuenta (misma respuesta)');
select throws_like(
  $$ select public.invite_pet_member_by_email('a8000000-0000-4000-8000-000000000011', 'abuse-other@example.test') $$,
  'Has enviado demasiadas invitaciones%',
  'límite: con un mensaje legible');

select test_helpers.reset_role();
select is(
  (select count(*)::int from public.pet_co_owners
   where user_id = 'a7000000-0000-4000-8000-000000000014'),
  0,
  'límite: la invitación rechazada no crea fila');
select is(test_helpers.attempts('a7000000-0000-4000-8000-000000000011'), 20,
  'límite: los rechazados no suman intentos');

-- Pasadas 24 h vuelve a poder; los de más de 2 días se purgan.
update private.pet_invitation_attempts set created_at = created_at - interval '25 hours'
where inviter_id = 'a7000000-0000-4000-8000-000000000011';
insert into private.pet_invitation_attempts (inviter_id, created_at)
values ('a7000000-0000-4000-8000-000000000011', now() - interval '3 days');
select test_helpers.act_as('a7000000-0000-4000-8000-000000000011');
select lives_ok(
  $$ select public.invite_pet_member_by_email('a8000000-0000-4000-8000-000000000011', 'abuse-other@example.test') $$,
  'límite: pasadas 24 h se puede volver a invitar');
select test_helpers.reset_role();
select is(
  (select count(*)::int from private.pet_invitation_attempts
   where inviter_id = 'a7000000-0000-4000-8000-000000000011' and created_at < now() - interval '2 days'),
  0,
  'límite: los intentos de más de 2 días se purgan');

-- Borrar la mascota no devuelve intentos.
delete from public.pets where id = 'a8000000-0000-4000-8000-000000000011';
select is(test_helpers.attempts('a7000000-0000-4000-8000-000000000011'), 21,
  'límite: borrar la mascota no borra los intentos');

-- ---------------------------------------------------------------------
-- 6. Registros privados
-- ---------------------------------------------------------------------
select ok(
  (select relrowsecurity from pg_class where oid = 'private.pet_invitation_attempts'::regclass),
  'privado: pet_invitation_attempts con RLS');
select ok(
  not has_table_privilege('anon', 'private.pet_invitation_attempts', 'SELECT, INSERT, UPDATE, DELETE')
  and not has_table_privilege('authenticated', 'private.pet_invitation_attempts', 'SELECT, INSERT, UPDATE, DELETE')
  and not has_table_privilege('service_role', 'private.pet_invitation_attempts', 'SELECT, INSERT, UPDATE, DELETE'),
  'privado: sin privilegios para anon, authenticated ni service_role');
select test_helpers.act_as('a7000000-0000-4000-8000-000000000011');
select throws_ok(
  $$ select count(*) from private.pet_invitation_attempts $$,
  '42501', null,
  'privado: authenticated no puede leer los intentos');
select test_helpers.reset_role();

select * from finish();

rollback;
