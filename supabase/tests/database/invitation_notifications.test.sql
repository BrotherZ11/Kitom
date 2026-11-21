-- =====================================================================
-- KITOM · Pruebas de los avisos de invitación (migración *_invitation_notifications.sql)
-- =====================================================================
-- pgTAP. Solo contra la BD local: `npx supabase test db`, o
--   docker exec -i supabase_db_Kitom psql -U postgres -d postgres -f - < supabase/tests/database/invitation_notifications.test.sql
-- Todo ocurre en una transacción que termina en ROLLBACK. Requiere el catálogo
-- de especies (supabase/seed.sql). En una transacción now() no avanza: las
-- reservas «caducadas» se simulan atrasando claimed_at.
-- =====================================================================
begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

create schema test_helpers;
grant usage on schema test_helpers to anon, authenticated, service_role;

create function test_helpers.act_as(uid uuid) returns void
  language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create function test_helpers.act_as_service() returns void
  language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
end $$;

create function test_helpers.reset_role() returns void
  language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- Atrasa la reserva de un aviso (simula que pasaron más de 5 min).
create function test_helpers.expire_claim(p_invitation uuid) returns void
  language sql security definer as $$
  update private.pet_invitation_notifications
     set claimed_at = claimed_at - interval '6 minutes'
   where invitation_id = p_invitation;
$$;

grant execute on all functions in schema test_helpers to anon, authenticated, service_role;

insert into auth.users (id, email, aud, role, raw_user_meta_data, email_confirmed_at) values
  ('f2000000-0000-4000-8000-000000000001', 'owner-notify@example.test', 'authenticated', 'authenticated', '{"full_name":"Olga"}', now()),
  ('f2000000-0000-4000-8000-000000000002', 'guest-notify@example.test', 'authenticated', 'authenticated', '{"full_name":"Gema"}', now()),
  ('f2000000-0000-4000-8000-000000000003', 'other-notify@example.test', 'authenticated', 'authenticated', '{"full_name":"Otto"}', now());

-- Invitar exige Premium (*_premium_plans); estas pruebas no tratan del plan.
update public.subscriptions set plan = 'premium'
where user_id in ('f2000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000003');

update public.profiles set locale = 'en' where id = 'f2000000-0000-4000-8000-000000000002';

insert into public.pets (id, owner_id, name, species_id)
select 'f3000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'Kika', s.id
from public.species s where s.code = 'dog';

insert into public.pets (id, owner_id, name, species_id)
select 'f3000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000003', 'Tom', s.id
from public.species s where s.code = 'cat';

insert into public.push_tokens (user_id, token, platform, last_seen_at) values
  ('f2000000-0000-4000-8000-000000000002', 'ExponentPushToken[guest-old]', 'android', now() - interval '2 days'),
  ('f2000000-0000-4000-8000-000000000002', 'ExponentPushToken[guest-new]', 'android', now()),
  ('f2000000-0000-4000-8000-000000000003', 'ExponentPushToken[other]', 'ios', now());

insert into public.push_tokens (user_id, token, platform, is_active) values
  ('f2000000-0000-4000-8000-000000000002', 'ExponentPushToken[guest-inactive]', 'android', false);

-- ---------------------------------------------------------------------
-- 1. Encolar
-- ---------------------------------------------------------------------
select test_helpers.act_as('f2000000-0000-4000-8000-000000000001');
select lives_ok(
  $$ select public.invite_pet_member_by_email('f3000000-0000-4000-8000-000000000001', 'guest-notify@example.test', 'editor') $$,
  'la propietaria invita por email'
);
select lives_ok(
  $$ select public.invite_pet_member_by_email('f3000000-0000-4000-8000-000000000001', 'nadie-notify@example.test') $$,
  'un email sin cuenta responde igual'
);
select test_helpers.reset_role();

select results_eq(
  $$ select n.invited_at = co.invited_at, n.attempts, n.email_done, n.push_done, n.completed_at is null
       from private.pet_invitation_notifications n
       join public.pet_co_owners co on co.id = n.invitation_id
      where co.pet_id = 'f3000000-0000-4000-8000-000000000001' $$,
  $$ values (true, 0, false, false, true) $$,
  'la invitación deja un único aviso pendiente (sin cuenta, ninguno)'
);

create temporary table inv as
select id from public.pet_co_owners
where pet_id = 'f3000000-0000-4000-8000-000000000001' and user_id = 'f2000000-0000-4000-8000-000000000002';
grant select on inv to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. Permisos
-- ---------------------------------------------------------------------
select test_helpers.act_as('f2000000-0000-4000-8000-000000000001');
select throws_ok(
  $$ select * from public.pet_invitation_notifications_claim('f2000000-0000-4000-8000-000000000001') $$,
  '42501', null,
  'authenticated no puede reservar avisos'
);
select throws_ok(
  $$ select public.pet_invitation_notifications_complete((select id from inv), now(), true, 'sent', true, 'sent') $$,
  '42501', null,
  'authenticated no puede anotar resultados'
);
select throws_ok(
  $$ select * from private.pet_invitation_notifications $$,
  '42501', null,
  'authenticated no ve la cola'
);
select test_helpers.act_as_service();
select throws_ok(
  $$ select * from private.pet_invitation_notifications $$,
  '42501', null,
  'service_role tampoco ve la cola directamente (solo por las RPC)'
);
select throws_ok(
  $$ select * from public.pet_invitation_notifications_claim('f2000000-0000-4000-8000-000000000001', 0) $$,
  '22023', 'invitation_notify_invalid_parameter',
  'un límite fuera de rango se rechaza'
);

-- ---------------------------------------------------------------------
-- 3. Reservar
-- ---------------------------------------------------------------------
select is(
  (select count(*)::int from public.pet_invitation_notifications_claim('f2000000-0000-4000-8000-000000000003')),
  0,
  'otra cuenta no reserva los avisos de las invitaciones ajenas'
);

create temporary table claim1 as
select * from public.pet_invitation_notifications_claim('f2000000-0000-4000-8000-000000000001');

select results_eq(
  $$ select invitation_id, invitee_id, invitee_email, invitee_locale, inviter_name, pet_name, role::text,
            alerts_enabled, send_email, send_push, push_tokens
       from claim1 $$,
  $$ values ((select id from inv), 'f2000000-0000-4000-8000-000000000002'::uuid, 'guest-notify@example.test',
             'en', 'Olga', 'Kika', 'editor', true, true, true,
             array['ExponentPushToken[guest-new]', 'ExponentPushToken[guest-old]']) $$,
  'la reserva trae el email, el idioma y los tokens activos de la invitada, los nombres y el rol'
);

select is(
  (select count(*)::int from public.pet_invitation_notifications_claim('f2000000-0000-4000-8000-000000000001')),
  0,
  'un aviso reservado no se vuelve a reservar mientras dura la reserva'
);

-- ---------------------------------------------------------------------
-- 4. Anotar resultados
-- ---------------------------------------------------------------------
select is(
  public.pet_invitation_notifications_complete((select id from inv), (select invited_at from claim1),
    true, 'sent', false, 'expo_http', array['ExponentPushToken[guest-old]', 'ExponentPushToken[other]']),
  true,
  'se anota el email enviado y el push fallido'
);

select test_helpers.reset_role();
select results_eq(
  $$ select email_done, push_done, email_status, push_status, claimed_at is null, completed_at is null, attempts
       from private.pet_invitation_notifications where invitation_id = (select id from inv) $$,
  $$ values (true, false, 'sent', 'expo_http', true, true, 1) $$,
  'el aviso queda a medias, liberado para reintentar el push'
);
select results_eq(
  $$ select token, is_active from public.push_tokens
      where token in ('ExponentPushToken[guest-old]', 'ExponentPushToken[other]') order by token $$,
  $$ values ('ExponentPushToken[guest-old]', false), ('ExponentPushToken[other]', true) $$,
  'se desactiva el token no registrado de la invitada, nunca el de otra cuenta'
);

select test_helpers.act_as_service();
select results_eq(
  $$ select send_email, send_push, push_tokens from public.pet_invitation_notifications_claim('f2000000-0000-4000-8000-000000000001') $$,
  $$ values (false, true, array['ExponentPushToken[guest-new]']) $$,
  'el reintento solo pide el canal pendiente y los tokens aún activos'
);

select is(
  public.pet_invitation_notifications_complete((select id from inv), (select invited_at from claim1) - interval '1 second',
    true, 'sent', true, 'sent'),
  false,
  'un resultado de otra versión de la invitación no se anota'
);
select throws_ok(
  $$ select public.pet_invitation_notifications_complete((select id from inv), (select invited_at from claim1), true, 'Texto libre', true, 'sent') $$,
  '22023', 'invitation_notify_invalid_parameter',
  'los estados solo admiten códigos'
);

select is(
  public.pet_invitation_notifications_complete((select id from inv), (select invited_at from claim1),
    false, null, true, 'sent'),
  true,
  'se anota el push enviado'
);

select test_helpers.reset_role();
select results_eq(
  $$ select email_done, push_done, email_status, push_status, completed_at is not null
       from private.pet_invitation_notifications where invitation_id = (select id from inv) $$,
  $$ values (true, true, 'sent', 'sent', true) $$,
  'con los dos canales hechos el aviso se completa y conserva el estado anterior del email'
);

select test_helpers.act_as_service();
select is(
  (select count(*)::int from public.pet_invitation_notifications_claim('f2000000-0000-4000-8000-000000000001')),
  0,
  'un aviso completado no se vuelve a reservar'
);
select is(
  public.pet_invitation_notifications_complete((select id from inv), (select invited_at from claim1), true, 'sent', true, 'sent'),
  false,
  'un aviso completado no se vuelve a anotar'
);

-- ---------------------------------------------------------------------
-- 5. Renovar la invitación vuelve a avisar
-- ---------------------------------------------------------------------
select test_helpers.act_as('f2000000-0000-4000-8000-000000000002');
select lives_ok(
  $$ select public.decline_pet_invitation((select id from inv)) $$,
  'la invitada rechaza la invitación'
);
select test_helpers.act_as_service();
select is(
  (select count(*)::int from public.pet_invitation_notifications_claim('f2000000-0000-4000-8000-000000000001')),
  0,
  'una invitación rechazada no se avisa'
);

select test_helpers.act_as('f2000000-0000-4000-8000-000000000001');
select lives_ok(
  $$ select public.invite_pet_member_by_email('f3000000-0000-4000-8000-000000000001', 'guest-notify@example.test') $$,
  'la propietaria la vuelve a invitar'
);
select test_helpers.reset_role();
select results_eq(
  $$ select attempts, email_done, push_done, email_status, completed_at is null
       from private.pet_invitation_notifications where invitation_id = (select id from inv) $$,
  $$ values (0, false, false, null::text, true) $$,
  'la invitación renovada vuelve a dejar el aviso pendiente'
);

-- ---------------------------------------------------------------------
-- 6. Preferencias, reintentos y reservas caducadas
-- ---------------------------------------------------------------------
update public.notification_preferences set alert_notifications_enabled = false
where user_id = 'f2000000-0000-4000-8000-000000000002';

select test_helpers.act_as_service();
select results_eq(
  $$ select alerts_enabled from public.pet_invitation_notifications_claim('f2000000-0000-4000-8000-000000000001') $$,
  $$ values (false) $$,
  'la reserva informa de que la invitada apagó los avisos (la función no envía nada)'
);

select test_helpers.expire_claim((select id from inv));
select is(
  (select count(*)::int from public.pet_invitation_notifications_claim('f2000000-0000-4000-8000-000000000001')),
  1,
  'una reserva caducada se puede volver a tomar'
);
select test_helpers.expire_claim((select id from inv));
select is(
  (select count(*)::int from public.pet_invitation_notifications_claim('f2000000-0000-4000-8000-000000000001')),
  1,
  'tercera reserva'
);
select test_helpers.expire_claim((select id from inv));
select is(
  (select count(*)::int from public.pet_invitation_notifications_claim('f2000000-0000-4000-8000-000000000001')),
  0,
  'tras 3 reservas sin terminar, el aviso se abandona'
);

-- ---------------------------------------------------------------------
-- 7. Borrados en cascada
-- ---------------------------------------------------------------------
select test_helpers.reset_role();
delete from public.pets where id = 'f3000000-0000-4000-8000-000000000001';
select is(
  (select count(*)::int from private.pet_invitation_notifications where invitation_id = (select id from inv)),
  0,
  'borrar la mascota borra sus avisos'
);

select * from finish();
rollback;
