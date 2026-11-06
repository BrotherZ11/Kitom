-- =====================================================================
-- KITOM · Borrar una cuenta y auditoría (migración *_account_deletion_audit_triggers.sql)
-- =====================================================================
-- pgTAP. Solo contra la BD local: `npx supabase test db`. Todo ocurre en una
-- transacción que termina en ROLLBACK. Requiere el catálogo de especies
-- (supabase/seed.sql).
--
-- El borrado se lanza sin JWT, como Auth. Las acciones de FK se ejecutan como dueño de
-- la tabla (postgres), con current_user y auth.uid() iguales a los de Auth. El borrado por
-- la API real de Auth está en
-- supabase/functions/delete-account/deletion.integration.test.mjs y las
-- sesiones simultáneas en supabase/tests/concurrency/account_deletion_concurrency.sh.
--
-- Una fila con logged_by y last_edited_by de la misma cuenta se prueba solo en
-- la integración: aquí esa fila se crearía en esta misma transacción y Postgres
-- comprobaría la FK de la otra columna antes de su acción (RI_FKey_fk_upd_check_required),
-- algo que no ocurre con filas ya confirmadas.
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

-- Lo que hace Auth: DELETE de auth.users sin JWT. postgres no puede hacer SET ROLE
-- supabase_auth_admin; da igual para los triggers: la acción de FK cambia al dueño
-- de la tabla (postgres), y eso es lo que ven (medido contra Auth real).
create function test_helpers.delete_account_without_jwt(uid uuid) returns void
  language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  delete from auth.users where id = uid;
  perform set_config('role', 'postgres', true);
end $$;

grant execute on all functions in schema test_helpers to anon, authenticated;

-- Ana y Bea: las cuentas que se borran. Olga: propietaria. Eva: editora que se
-- queda. Vera: lectora. Nico: sin relación. Tomás: propietario que transfiere.
insert into auth.users (id, email, aud, role) values
  ('e8000000-0000-4000-8000-000000000001', 'ada-ana@example.test',   'authenticated', 'authenticated'),
  ('e8000000-0000-4000-8000-000000000002', 'ada-bea@example.test',   'authenticated', 'authenticated'),
  ('e8000000-0000-4000-8000-000000000003', 'ada-olga@example.test',  'authenticated', 'authenticated'),
  ('e8000000-0000-4000-8000-000000000004', 'ada-eva@example.test',   'authenticated', 'authenticated'),
  ('e8000000-0000-4000-8000-000000000005', 'ada-vera@example.test',  'authenticated', 'authenticated'),
  ('e8000000-0000-4000-8000-000000000006', 'ada-nico@example.test',  'authenticated', 'authenticated'),
  ('e8000000-0000-4000-8000-000000000007', 'ada-tomas@example.test', 'authenticated', 'authenticated');

-- Kika (de Olga) sobrevive; Rex es de Tomás y se transfiere a Eva; Luna es de Bea
-- y su propietaria todavía no la ha resuelto.
insert into public.pets (id, owner_id, name, species_id)
select v.id, v.owner_id, v.name, s.id
from (values
  ('e9000000-0000-4000-8000-000000000001'::uuid, 'e8000000-0000-4000-8000-000000000003'::uuid, 'Kika'),
  ('e9000000-0000-4000-8000-000000000002'::uuid, 'e8000000-0000-4000-8000-000000000007'::uuid, 'Rex'),
  ('e9000000-0000-4000-8000-000000000003'::uuid, 'e8000000-0000-4000-8000-000000000002'::uuid, 'Luna')
) as v (id, owner_id, name)
cross join public.species s where s.code = 'cat';

insert into public.pet_co_owners (pet_id, user_id, role, status, invited_by, accepted_at) values
  ('e9000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000001', 'editor', 'accepted', 'e8000000-0000-4000-8000-000000000003', now()),
  ('e9000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000002', 'editor', 'accepted', 'e8000000-0000-4000-8000-000000000003', now()),
  ('e9000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000004', 'editor', 'accepted', 'e8000000-0000-4000-8000-000000000001', now()),
  ('e9000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000005', 'viewer', 'accepted', 'e8000000-0000-4000-8000-000000000003', now()),
  ('e9000000-0000-4000-8000-000000000002', 'e8000000-0000-4000-8000-000000000004', 'editor', 'accepted', 'e8000000-0000-4000-8000-000000000007', now());

-- Filas "ya guardadas": updated_at de hace una hora (en pgTAP now() no avanza).
insert into public.reminders (id, pet_id, created_by, type, title, due_at, created_at, updated_at) values
  ('ea000000-0000-4000-8000-000000000001', 'e9000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000001', 'medication', 'De Ana',  '2030-01-01 10:00+00', now() - interval '2 hours', now() - interval '1 hour'),
  ('ea000000-0000-4000-8000-000000000002', 'e9000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000003', 'bath',       'De Olga', '2030-01-02 10:00+00', now() - interval '2 hours', now() - interval '1 hour'),
  ('ea000000-0000-4000-8000-000000000003', 'e9000000-0000-4000-8000-000000000002', 'e8000000-0000-4000-8000-000000000007', 'bath',       'De Tomás','2030-01-03 10:00+00', now() - interval '2 hours', now() - interval '1 hour'),
  ('ea000000-0000-4000-8000-000000000004', 'e9000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000002', 'bath',       'De Bea',  '2030-01-04 10:00+00', now() - interval '2 hours', now() - interval '1 hour');

-- Registros de Kika y uno de Rex. En el primero, otra persona (Eva) fue la última en editar.
insert into public.daily_logs (id, pet_id, logged_by, last_edited_by, log_date, mood_level, notes, created_at, updated_at) values
  ('eb000000-0000-4000-8000-000000000001', 'e9000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000004', current_date,     3, 'De Ana, editado por Eva', now() - interval '2 hours', now() - interval '1 hour'),
  ('eb000000-0000-4000-8000-000000000002', 'e9000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000004', 'e8000000-0000-4000-8000-000000000001', current_date - 1, 4, 'De Eva, editado por Ana', now() - interval '2 hours', now() - interval '1 hour'),
  ('eb000000-0000-4000-8000-000000000003', 'e9000000-0000-4000-8000-000000000002', 'e8000000-0000-4000-8000-000000000007', null,                                   current_date,     5, 'De Tomás',                now() - interval '2 hours', now() - interval '1 hour'),
  ('eb000000-0000-4000-8000-000000000004', 'e9000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000002', 'e8000000-0000-4000-8000-000000000004', current_date - 2, 2, 'De Bea, editado por Eva', now() - interval '2 hours', now() - interval '1 hour'),
  ('eb000000-0000-4000-8000-000000000005', 'e9000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000004', null,                                   current_date - 3, 2, 'De Eva',                  now() - interval '2 hours', now() - interval '1 hour');

-- Otras referencias que pasan a NULL con la misma cuenta.
insert into public.analytics_events (user_id, event_name) values ('e8000000-0000-4000-8000-000000000001', 'ada_probe');
insert into public.ai_analysis_requests (id, pet_id, requested_by, photo_path) values
  ('ec000000-0000-4000-8000-000000000001', 'e9000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000001', 'e9000000-0000-4000-8000-000000000001/ana.jpg');
insert into public.pet_shared_reports (id, pet_id, generated_by, file_path, date_range_start, date_range_end) values
  ('ed000000-0000-4000-8000-000000000001', 'e9000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000001', 'e9000000-0000-4000-8000-000000000001/informe.pdf', current_date - 7, current_date);

-- =====================================================================
-- 1. La corrección no abre permisos
-- =====================================================================
select ok(not has_column_privilege('authenticated', 'public.reminders', 'created_by', 'UPDATE'), 'grants: authenticated no actualiza reminders.created_by');
select ok(not has_column_privilege('authenticated', 'public.daily_logs', 'logged_by', 'UPDATE'), 'grants: authenticated no actualiza daily_logs.logged_by');
select ok(not has_column_privilege('authenticated', 'public.daily_logs', 'last_edited_by', 'UPDATE'), 'grants: authenticated no actualiza daily_logs.last_edited_by');
select ok(not has_function_privilege('authenticated', 'public.protect_reminder_audit_fields()', 'EXECUTE'), 'grants: protect_reminder_audit_fields no es invocable por authenticated');
select ok(not has_function_privilege('authenticated', 'public.protect_daily_log_audit_fields()', 'EXECUTE'), 'grants: protect_daily_log_audit_fields no es invocable por authenticated');
select ok(not has_function_privilege('authenticated', 'public.set_last_edited_by()', 'EXECUTE'), 'grants: set_last_edited_by no es invocable por authenticated');
select is(
  (select array_agg(p.proname::text order by p.proname) from pg_proc p
   where p.proname in ('protect_reminder_audit_fields', 'protect_daily_log_audit_fields', 'set_last_edited_by')
     and p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proconfig = array['search_path=public']),
  array['protect_daily_log_audit_fields', 'protect_reminder_audit_fields', 'set_last_edited_by'],
  'funciones: siguen SECURITY DEFINER con search_path fijo');
select is(
  (select array_agg(policyname::text order by policyname) from pg_policies where schemaname = 'public' and tablename = 'profiles' and cmd = 'DELETE'),
  null::text[], 'rls: profiles sigue sin política de DELETE');

-- =====================================================================
-- 2. Primera capa: una persona no puede tocar la auditoría (GRANT)
-- =====================================================================
select test_helpers.act_as('e8000000-0000-4000-8000-000000000004');
select throws_ok($$ update public.reminders set created_by = null where id = 'ea000000-0000-4000-8000-000000000001' $$, '42501', null, 'editora: no puede poner created_by a NULL');
select throws_ok($$ update public.reminders set created_by = 'e8000000-0000-4000-8000-000000000004' where id = 'ea000000-0000-4000-8000-000000000001' $$, '42501', null, 'editora: no puede apropiarse de created_by');
select throws_ok($$ update public.daily_logs set logged_by = null where id = 'eb000000-0000-4000-8000-000000000001' $$, '42501', null, 'editora: no puede poner logged_by a NULL');
select throws_ok($$ update public.daily_logs set logged_by = 'e8000000-0000-4000-8000-000000000004' where id = 'eb000000-0000-4000-8000-000000000001' $$, '42501', null, 'editora: no puede apropiarse de logged_by');
select throws_ok($$ update public.daily_logs set last_edited_by = null where id = 'eb000000-0000-4000-8000-000000000001' $$, '42501', null, 'editora: no puede poner last_edited_by a NULL');

-- Tampoco por la otra vía: borrar su perfil no hace nada (sin política de DELETE),
-- así que nadie puede fabricar el estado «el perfil ya no existe».
select test_helpers.act_as('e8000000-0000-4000-8000-000000000001');
select is_empty($$ delete from public.profiles where id = 'e8000000-0000-4000-8000-000000000001' returning id $$, 'perfil: su dueña no puede borrarlo con su JWT');
select test_helpers.reset_role();
select is((select count(*)::int from public.profiles where id = 'e8000000-0000-4000-8000-000000000001'), 1, 'perfil: sigue existiendo');
select is((select created_by::text from public.reminders where id = 'ea000000-0000-4000-8000-000000000001'), 'e8000000-0000-4000-8000-000000000001', 'perfil: created_by no cambia');

-- =====================================================================
-- 3. Segunda capa: el trigger, sin el GRANT de por medio
-- =====================================================================
-- Sin JWT y con los grants abiertos solo en esta transacción: lo que quedaría si
-- una función interna, o un GRANT futuro, intentara el cambio. El perfil existe.
select throws_ok($$ update public.reminders set created_by = null where id = 'ea000000-0000-4000-8000-000000000001' $$, 'P0001', 'No se puede modificar quién creó el recordatorio', 'sin JWT: created_by a NULL rechazado con el perfil vivo');
select throws_ok($$ update public.daily_logs set logged_by = null where id = 'eb000000-0000-4000-8000-000000000001' $$, 'P0001', 'No se puede modificar quién creó originalmente el registro', 'sin JWT: logged_by a NULL rechazado con el perfil vivo');

grant update (created_by) on public.reminders to authenticated;
grant update (logged_by) on public.daily_logs to authenticated;

-- Con JWT: el trigger es SECURITY DEFINER, así que ve el perfil aunque RLS se lo oculte a quien actúa.
select test_helpers.act_as('e8000000-0000-4000-8000-000000000004');
select throws_ok($$ update public.reminders set created_by = null where id = 'ea000000-0000-4000-8000-000000000001' $$, 'P0001', 'No se puede modificar quién creó el recordatorio', 'trigger: created_by a NULL rechazado aunque el perfil no sea visible para quien actúa');
select throws_ok($$ update public.reminders set created_by = 'e8000000-0000-4000-8000-000000000004' where id = 'ea000000-0000-4000-8000-000000000001' $$, 'P0001', 'No se puede modificar quién creó el recordatorio', 'trigger: created_by a otra cuenta rechazado');
select throws_ok($$ update public.daily_logs set logged_by = null where id = 'eb000000-0000-4000-8000-000000000001' $$, 'P0001', 'No se puede modificar quién creó originalmente el registro', 'trigger: logged_by a NULL rechazado aunque el perfil no sea visible para quien actúa');
select throws_ok($$ update public.daily_logs set logged_by = 'e8000000-0000-4000-8000-000000000004' where id = 'eb000000-0000-4000-8000-000000000001' $$, 'P0001', 'No se puede modificar quién creó originalmente el registro', 'trigger: logged_by a otra cuenta rechazado');
select test_helpers.reset_role();

revoke update (created_by) on public.reminders from authenticated;
revoke update (logged_by) on public.daily_logs from authenticated;

-- Lo demás que protegen sigue igual.
select throws_ok($$ update public.reminders set created_at = now() where id = 'ea000000-0000-4000-8000-000000000001' $$, 'P0001', 'No se puede modificar created_at', 'trigger: created_at de un recordatorio sigue protegido');
select throws_ok($$ update public.reminders set pet_id = 'e9000000-0000-4000-8000-000000000002' where id = 'ea000000-0000-4000-8000-000000000001' $$, 'P0001', 'No se puede modificar pet_id de un recordatorio existente', 'trigger: pet_id de un recordatorio sigue protegido');
select throws_ok($$ update public.daily_logs set log_date = current_date - 3 where id = 'eb000000-0000-4000-8000-000000000001' $$, 'P0001', 'No se puede modificar log_date de un registro existente', 'trigger: log_date sigue protegido');
select throws_ok($$ update public.daily_logs set pet_id = 'e9000000-0000-4000-8000-000000000002' where id = 'eb000000-0000-4000-8000-000000000001' $$, 'P0001', 'No se puede modificar pet_id de un registro existente', 'trigger: pet_id de un registro sigue protegido');
select throws_ok($$ update public.daily_logs set created_at = now() where id = 'eb000000-0000-4000-8000-000000000001' $$, 'P0001', 'No se puede modificar created_at', 'trigger: created_at de un registro sigue protegido');

-- =====================================================================
-- 4. Una edición normal sigue atribuyéndose a quien edita
-- =====================================================================
update public.pet_streaks set updated_at = now() - interval '1 hour' where pet_id = 'e9000000-0000-4000-8000-000000000001';
select test_helpers.act_as('e8000000-0000-4000-8000-000000000001');
update public.daily_logs set notes = 'De Eva, editado por Ana otra vez' where id = 'eb000000-0000-4000-8000-000000000002';
select test_helpers.reset_role();
select is((select last_edited_by::text from public.daily_logs where id = 'eb000000-0000-4000-8000-000000000002'), 'e8000000-0000-4000-8000-000000000001', 'edición: last_edited_by es quien edita');
select ok((select updated_at = now() from public.pet_streaks where pet_id = 'e9000000-0000-4000-8000-000000000001'), 'edición: la racha se recalcula, como antes');
select test_helpers.act_as('e8000000-0000-4000-8000-000000000004');
update public.daily_logs set notes = 'De Bea, editado por Eva otra vez' where id = 'eb000000-0000-4000-8000-000000000004';
select test_helpers.reset_role();
select is((select last_edited_by::text from public.daily_logs where id = 'eb000000-0000-4000-8000-000000000004'), 'e8000000-0000-4000-8000-000000000004', 'edición: last_edited_by cambia a la nueva editora');
select is((select logged_by::text from public.daily_logs where id = 'eb000000-0000-4000-8000-000000000004'), 'e8000000-0000-4000-8000-000000000002', 'edición: logged_by no cambia');

-- =====================================================================
-- 5. Si el borrado falla, no cambia nada
-- =====================================================================
-- Bea sigue siendo propietaria de Luna (FK RESTRICT): Auth no puede borrarla. Sus
-- referencias se quedan como estaban: el SET NULL se deshace con el error.
select throws_ok($$ select test_helpers.delete_account_without_jwt('e8000000-0000-4000-8000-000000000002') $$, '23503', null, 'fallo: no se puede borrar a quien aún es propietaria de una mascota');
select test_helpers.reset_role();
select is((select created_by::text from public.reminders where id = 'ea000000-0000-4000-8000-000000000004'), 'e8000000-0000-4000-8000-000000000002', 'fallo: su recordatorio conserva el autor');
select is((select logged_by::text from public.daily_logs where id = 'eb000000-0000-4000-8000-000000000004'), 'e8000000-0000-4000-8000-000000000002', 'fallo: su registro conserva el autor');
select is((select count(*)::int from public.pet_co_owners where user_id = 'e8000000-0000-4000-8000-000000000002'), 1, 'fallo: sigue de co-tutora');
select is((select count(*)::int from public.profiles where id = 'e8000000-0000-4000-8000-000000000002'), 1, 'fallo: su perfil sigue');
select is((select count(*)::int from auth.users where id = 'e8000000-0000-4000-8000-000000000002'), 1, 'fallo: su usuario sigue');
select is((select owner_id::text from public.pets where id = 'e9000000-0000-4000-8000-000000000003'), 'e8000000-0000-4000-8000-000000000002', 'fallo: Luna sigue siendo suya');

-- =====================================================================
-- 6. Borrar la cuenta de una co-tutora con datos en una mascota que sobrevive
-- =====================================================================
update public.pet_streaks set updated_at = now() - interval '1 hour' where pet_id = 'e9000000-0000-4000-8000-000000000001';
create temporary table streak_before on commit drop as
  select current_streak, longest_streak, last_log_date from public.pet_streaks where pet_id = 'e9000000-0000-4000-8000-000000000001';
grant select on streak_before to public;

select lives_ok($$ select test_helpers.delete_account_without_jwt('e8000000-0000-4000-8000-000000000001') $$, 'borrado: la cuenta de Ana se borra sin JWT, como Auth');
select test_helpers.reset_role();

select is((select count(*)::int from auth.users where id = 'e8000000-0000-4000-8000-000000000001'), 0, 'borrado: usuario eliminado');
select is((select count(*)::int from public.profiles where id = 'e8000000-0000-4000-8000-000000000001'), 0, 'borrado: perfil eliminado');
select is((select count(*)::int from public.pet_co_owners where user_id = 'e8000000-0000-4000-8000-000000000001'), 0, 'borrado: deja de ser co-tutora');

-- Recordatorio: la fila y su contenido se quedan; solo se pierde el autor.
select results_eq(
  $$ select created_by, pet_id, type::text, title, due_at, status::text, is_active, created_at = now() - interval '2 hours' from public.reminders where id = 'ea000000-0000-4000-8000-000000000001' $$,
  $$ values (null::uuid, 'e9000000-0000-4000-8000-000000000001'::uuid, 'medication', 'De Ana', '2030-01-01 10:00+00'::timestamptz, 'pending', true, true) $$,
  'recordatorio: sobrevive con su contenido y created_by NULL');
select ok((select updated_at = now() from public.reminders where id = 'ea000000-0000-4000-8000-000000000001'), 'recordatorio: updated_at cambia (la fila cambió: las copias offline lo notan)');
select is((select created_by::text from public.reminders where id = 'ea000000-0000-4000-8000-000000000002'), 'e8000000-0000-4000-8000-000000000003', 'recordatorio de otra persona: autor intacto');
select ok((select updated_at < now() from public.reminders where id = 'ea000000-0000-4000-8000-000000000002'), 'recordatorio de otra persona: no se toca');

-- Registro: la fila, su contenido y quién lo editó se quedan.
select results_eq(
  $$ select logged_by, last_edited_by, log_date, mood_level::int, notes, created_at = now() - interval '2 hours' from public.daily_logs where id = 'eb000000-0000-4000-8000-000000000001' $$,
  $$ values (null::uuid, 'e8000000-0000-4000-8000-000000000004'::uuid, current_date, 3, 'De Ana, editado por Eva', true) $$,
  'registro de Ana: logged_by NULL; se conserva quién lo editó (Eva) y su contenido');
select results_eq(
  $$ select logged_by, last_edited_by, notes from public.daily_logs where id = 'eb000000-0000-4000-8000-000000000002' $$,
  $$ values ('e8000000-0000-4000-8000-000000000004'::uuid, null::uuid, 'De Eva, editado por Ana otra vez') $$,
  'registro de Eva editado por Ana: conserva a su autora; last_edited_by NULL');
select results_eq(
  $$ select logged_by, last_edited_by from public.daily_logs where id = 'eb000000-0000-4000-8000-000000000004' $$,
  $$ values ('e8000000-0000-4000-8000-000000000002'::uuid, 'e8000000-0000-4000-8000-000000000004'::uuid) $$,
  'registro sin relación con Ana: autor y editora intactos');
select ok((select updated_at < now() from public.daily_logs where id = 'eb000000-0000-4000-8000-000000000005'), 'registro sin relación con Ana: no se toca');

-- Otras referencias y derivados.
select is((select user_id from public.analytics_events where event_name = 'ada_probe'), null::uuid, 'analytics_events: user_id NULL');
select is((select invited_by from public.pet_co_owners where pet_id = 'e9000000-0000-4000-8000-000000000001' and user_id = 'e8000000-0000-4000-8000-000000000004'), null::uuid, 'pet_co_owners: la invitación de Eva se queda, invited_by NULL');
select is((select count(*)::int from public.pets where id = 'e9000000-0000-4000-8000-000000000001' and owner_id = 'e8000000-0000-4000-8000-000000000003'), 1, 'mascota: sigue de su propietaria');
select results_eq(
  $$ select current_streak, longest_streak, last_log_date from public.pet_streaks where pet_id = 'e9000000-0000-4000-8000-000000000001' $$,
  $$ select current_streak, longest_streak, last_log_date from streak_before $$,
  'racha: no cambia');
select ok((select updated_at < now() from public.pet_streaks where pet_id = 'e9000000-0000-4000-8000-000000000001'), 'racha: la acción de FK no la recalcula (una por fila sería cuadrático)');
select is((select requested_by from public.ai_analysis_requests where id = 'ec000000-0000-4000-8000-000000000001'), null::uuid, 'ai_analysis_requests: requested_by NULL, la consulta se queda');
select is((select generated_by from public.pet_shared_reports where id = 'ed000000-0000-4000-8000-000000000001'), null::uuid, 'pet_shared_reports: generated_by NULL, el informe se queda');

-- =====================================================================
-- 7. Las filas que se quedan sin autor siguen siendo usables, sin dueño nuevo
-- =====================================================================
select test_helpers.act_as('e8000000-0000-4000-8000-000000000004');
select lives_ok($$ update public.reminders set title = 'Editado por Eva' where id = 'ea000000-0000-4000-8000-000000000001' $$, 'sin autor: una editora edita el recordatorio');
select is((select title from public.reminders where id = 'ea000000-0000-4000-8000-000000000001'), 'Editado por Eva', 'sin autor: la edición se aplica');
select is((select created_by from public.reminders where id = 'ea000000-0000-4000-8000-000000000001'), null::uuid, 'sin autor: editar no le da autor');
select throws_ok($$ update public.reminders set created_by = 'e8000000-0000-4000-8000-000000000004' where id = 'ea000000-0000-4000-8000-000000000001' $$, '42501', null, 'sin autor: nadie puede apropiárselo');
select lives_ok($$ update public.daily_logs set notes = 'Editado por Eva' where id = 'eb000000-0000-4000-8000-000000000001' $$, 'sin autor: una editora edita el registro');
select results_eq(
  $$ select logged_by, last_edited_by from public.daily_logs where id = 'eb000000-0000-4000-8000-000000000001' $$,
  $$ values (null::uuid, 'e8000000-0000-4000-8000-000000000004'::uuid) $$,
  'sin autor: editar no le da autor y atribuye la edición');
select test_helpers.reset_role();
grant update (created_by) on public.reminders to authenticated;
select test_helpers.act_as('e8000000-0000-4000-8000-000000000004');
select throws_ok($$ update public.reminders set created_by = 'e8000000-0000-4000-8000-000000000004' where id = 'ea000000-0000-4000-8000-000000000001' $$, 'P0001', 'No se puede modificar quién creó el recordatorio', 'sin autor: el trigger tampoco deja asignar uno de NULL a una cuenta');
select test_helpers.reset_role();
revoke update (created_by) on public.reminders from authenticated;

select test_helpers.act_as('e8000000-0000-4000-8000-000000000005');
select is((select count(*)::int from public.reminders where id = 'ea000000-0000-4000-8000-000000000001'), 1, 'sin autor: una lectora lo sigue viendo');
select is_empty($$ update public.reminders set title = 'Lectora' where id = 'ea000000-0000-4000-8000-000000000001' returning id $$, 'sin autor: una lectora sigue sin poder editarlo');
select test_helpers.act_as('e8000000-0000-4000-8000-000000000006');
select is((select count(*)::int from public.reminders where id = 'ea000000-0000-4000-8000-000000000001'), 0, 'sin autor: quien no es miembro sigue sin verlo');
select is((select count(*)::int from public.daily_logs where id = 'eb000000-0000-4000-8000-000000000001'), 0, 'sin autor: quien no es miembro sigue sin ver el registro');
select test_helpers.reset_role();

-- =====================================================================
-- 8. Mascota transferida a otro tutor y borrado de quien la transfirió
-- =====================================================================
select test_helpers.act_as('e8000000-0000-4000-8000-000000000007');
select lives_ok($$ select public.transfer_pet_ownership('e9000000-0000-4000-8000-000000000002', 'e8000000-0000-4000-8000-000000000004') $$, 'transferencia: Rex pasa a Eva');
select test_helpers.reset_role();
select lives_ok($$ select test_helpers.delete_account_without_jwt('e8000000-0000-4000-8000-000000000007') $$, 'transferencia: la cuenta anterior se borra');
select test_helpers.reset_role();
select is((select owner_id::text from public.pets where id = 'e9000000-0000-4000-8000-000000000002'), 'e8000000-0000-4000-8000-000000000004', 'transferencia: Rex sigue de Eva');
select results_eq(
  $$ select created_by, title from public.reminders where id = 'ea000000-0000-4000-8000-000000000003' $$,
  $$ values (null::uuid, 'De Tomás') $$, 'transferencia: su recordatorio se queda, sin autor');
select results_eq(
  $$ select logged_by, notes from public.daily_logs where id = 'eb000000-0000-4000-8000-000000000003' $$,
  $$ values (null::uuid, 'De Tomás') $$, 'transferencia: su registro se queda, sin autor');
select is((select count(*)::int from public.pet_co_owners where pet_id = 'e9000000-0000-4000-8000-000000000002' and user_id = 'e8000000-0000-4000-8000-000000000007'), 0, 'transferencia: ya no figura como co-tutor');
select test_helpers.act_as('e8000000-0000-4000-8000-000000000004');
select is((select count(*)::int from public.reminders where id = 'ea000000-0000-4000-8000-000000000003'), 1, 'transferencia: la nueva propietaria ve el recordatorio');
select test_helpers.reset_role();

-- =====================================================================
-- 9. Dos cuentas en la misma fila, una detrás de otra
-- =====================================================================
delete from public.pets where id = 'e9000000-0000-4000-8000-000000000003'; -- Luna: Bea ya puede irse
select lives_ok($$ select test_helpers.delete_account_without_jwt('e8000000-0000-4000-8000-000000000002') $$, 'dos cuentas: se borra Bea (sin mascotas propias)');
select test_helpers.reset_role();
select results_eq(
  $$ select logged_by, last_edited_by from public.daily_logs where id = 'eb000000-0000-4000-8000-000000000004' $$,
  $$ values (null::uuid, 'e8000000-0000-4000-8000-000000000004'::uuid) $$,
  'dos cuentas: el autor pasa a NULL y la editora se conserva');
select lives_ok($$ delete from public.pets where owner_id = 'e8000000-0000-4000-8000-000000000004' $$, 'dos cuentas: Eva resuelve sus mascotas');
select lives_ok($$ select test_helpers.delete_account_without_jwt('e8000000-0000-4000-8000-000000000004') $$, 'dos cuentas: se borra Eva');
select test_helpers.reset_role();
select results_eq(
  $$ select logged_by, last_edited_by from public.daily_logs where id = 'eb000000-0000-4000-8000-000000000004' $$,
  $$ values (null::uuid, null::uuid) $$,
  'dos cuentas: el registro sobrevive sin autor ni editora');

-- =====================================================================
-- 10. service_role, sin cambios
-- =====================================================================
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select lives_ok($$ update public.reminders set created_by = 'e8000000-0000-4000-8000-000000000003' where id = 'ea000000-0000-4000-8000-000000000001' $$, 'service_role: puede corregir created_by, como antes');
select test_helpers.reset_role();

select * from finish();
rollback;
