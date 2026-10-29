-- =====================================================================
-- KITOM · Pruebas del cupo de IA y del endurecimiento (*_ai_quota_and_invitation_hardening.sql)
-- =====================================================================
-- pgTAP. Solo contra la BD local: `npx supabase test db`, o
--   docker exec -i supabase_db_Kitom psql -U postgres -d postgres -f - < supabase/tests/database/ai_quota.test.sql
-- Todo ocurre en una transacción que termina en ROLLBACK. Requiere los catálogos
-- (supabase/seed.sql: especies y logros).
-- Cubre: cupo mensual (también tras borrar la mascota), fallos que no gastan
-- cupo, aviso veterinario exigido por el servidor, `hint` estables de
-- request_ai_analysis, registro de uso invisible para los clientes,
-- privilegios de tabla sobrantes, search_path de trigger_set_timestamp y
-- límites del bucket pet-photos.
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

-- El `hint` del error que lanza una sentencia (o 'sin error').
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

-- Usuaria con el aviso aceptado, otra sin aceptarlo, otra premium.
insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('e0000000-0000-4000-8000-000000000001', 'quota-free@example.test', 'authenticated', 'authenticated', '{"full_name":"Fina"}'),
  ('e0000000-0000-4000-8000-000000000002', 'quota-nodisc@example.test', 'authenticated', 'authenticated', '{"full_name":"Nora"}'),
  ('e0000000-0000-4000-8000-000000000003', 'quota-premium@example.test', 'authenticated', 'authenticated', '{"full_name":"Pía"}');

update public.profiles set disclaimer_accepted_at = now(), disclaimer_version = '1.0'
where id in ('e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000003');
update public.subscriptions set plan = 'premium' where user_id = 'e0000000-0000-4000-8000-000000000003';

insert into public.pets (id, owner_id, name, species_id)
select v.id, v.owner_id, v.name, s.id
from (values
  ('e1000000-0000-4000-8000-000000000001'::uuid, 'e0000000-0000-4000-8000-000000000001'::uuid, 'Lua'),
  ('e1000000-0000-4000-8000-000000000002'::uuid, 'e0000000-0000-4000-8000-000000000002'::uuid, 'Bruno'),
  ('e1000000-0000-4000-8000-000000000003'::uuid, 'e0000000-0000-4000-8000-000000000003'::uuid, 'Mía')
) as v (id, owner_id, name)
cross join public.species s where s.code = 'dog';

insert into public.pets (id, owner_id, name, species_id, is_active)
select 'e1000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000001', 'Archivada', s.id, false
from public.species s where s.code = 'dog';

-- ---------------------------------------------------------------------
-- 1. Cupo mensual del plan gratuito
-- ---------------------------------------------------------------------
select test_helpers.act_as('e0000000-0000-4000-8000-000000000001');

select results_eq(
  $$ select can_request, would_use_full_history, monthly_used, monthly_limit from public.get_ai_analysis_entitlement() $$,
  $$ values (true, false, 0, 3) $$,
  'free sin consultas: puede pedir, 0 de 3'
);

select lives_ok($$ select public.request_ai_analysis('e1000000-0000-4000-8000-000000000001', null) $$, 'consulta 1');
select lives_ok($$ select public.request_ai_analysis('e1000000-0000-4000-8000-000000000001', null) $$, 'consulta 2');
select lives_ok($$ select public.request_ai_analysis('e1000000-0000-4000-8000-000000000001', null) $$, 'consulta 3');

select is(
  test_helpers.hint_of($$ select public.request_ai_analysis('e1000000-0000-4000-8000-000000000001', null) $$),
  'ai_quota_exceeded',
  'la cuarta se rechaza con hint ai_quota_exceeded'
);
select throws_like(
  $$ select public.request_ai_analysis('e1000000-0000-4000-8000-000000000001', null) $$,
  'Has alcanzado tu límite mensual%',
  'el mensaje de siempre se conserva (versiones anteriores de la app lo reconocen)'
);

-- Un análisis fallido no gasta cupo (lo marca la Edge Function con service_role).
select test_helpers.reset_role();
update public.ai_analysis_requests set status = 'failed'
where id = (select id from public.ai_analysis_requests
            where requested_by = 'e0000000-0000-4000-8000-000000000001' order by created_at, id limit 1);

select test_helpers.act_as('e0000000-0000-4000-8000-000000000001');
select results_eq(
  $$ select can_request, monthly_used from public.get_ai_analysis_entitlement() $$,
  $$ values (true, 2) $$,
  'tras un fallo: 2 de 3, puede volver a pedir'
);
select lives_ok($$ select public.request_ai_analysis('e1000000-0000-4000-8000-000000000001', null) $$, 'consulta tras el fallo');

-- ---------------------------------------------------------------------
-- 2. Borrar la mascota no devuelve cupo (SEC-01)
-- ---------------------------------------------------------------------
select lives_ok(
  $$ delete from public.pets where id = 'e1000000-0000-4000-8000-000000000001' $$,
  'la dueña borra la mascota (sus consultas caen en cascada)'
);

select test_helpers.reset_role();
select is(
  (select count(*)::int from public.ai_analysis_requests where requested_by = 'e0000000-0000-4000-8000-000000000001'),
  0,
  'las consultas de la mascota borrada ya no existen'
);

insert into public.pets (id, owner_id, name, species_id)
select 'e1000000-0000-4000-8000-000000000005', 'e0000000-0000-4000-8000-000000000001', 'Lua otra vez', s.id
from public.species s where s.code = 'dog';

select test_helpers.act_as('e0000000-0000-4000-8000-000000000001');
select results_eq(
  $$ select can_request, monthly_used from public.get_ai_analysis_entitlement() $$,
  $$ values (false, 3) $$,
  'tras borrar y recrear la mascota sigue 3 de 3'
);
select is(
  test_helpers.hint_of($$ select public.request_ai_analysis('e1000000-0000-4000-8000-000000000005', null) $$),
  'ai_quota_exceeded',
  'y la mascota nueva no puede pedir otra consulta'
);

-- ---------------------------------------------------------------------
-- 3. Otros errores con hint estable
-- ---------------------------------------------------------------------
select is(
  test_helpers.hint_of($$ select public.request_ai_analysis('e1000000-0000-4000-8000-000000000003', null) $$),
  'ai_not_allowed',
  'mascota ajena: ai_not_allowed'
);
select is(
  test_helpers.hint_of($$ select public.request_ai_analysis('e1000000-0000-4000-8000-000000000004', null) $$),
  'ai_pet_unavailable',
  'mascota archivada: ai_pet_unavailable'
);
select is(
  test_helpers.hint_of($$ select public.request_ai_analysis('e1000000-0000-4000-8000-000000000005',
                          'e1000000-0000-4000-8000-000000000003/foto.jpg') $$),
  'ai_invalid_photo',
  'foto de otra mascota: ai_invalid_photo'
);

-- ---------------------------------------------------------------------
-- 4. Aviso veterinario exigido por el servidor (SEC-10)
-- ---------------------------------------------------------------------
select test_helpers.act_as('e0000000-0000-4000-8000-000000000002');
select is(
  test_helpers.hint_of($$ select public.request_ai_analysis('e1000000-0000-4000-8000-000000000002', null) $$),
  'ai_disclaimer_required',
  'sin aceptar el aviso veterinario no se puede pedir una consulta'
);

select test_helpers.reset_role();
select is(
  (select count(*)::int from public.ai_analysis_requests where pet_id = 'e1000000-0000-4000-8000-000000000002'),
  0,
  'y no se crea ninguna fila'
);

-- ---------------------------------------------------------------------
-- 5. Premium sin límite
-- ---------------------------------------------------------------------
select test_helpers.act_as('e0000000-0000-4000-8000-000000000003');
select results_eq(
  $$ select can_request, would_use_full_history, monthly_limit from public.get_ai_analysis_entitlement() $$,
  $$ values (true, true, null::int) $$,
  'premium: sin límite e historial completo'
);
select lives_ok($$ select public.request_ai_analysis('e1000000-0000-4000-8000-000000000003', null) $$, 'premium pide');

-- ---------------------------------------------------------------------
-- 6. El registro de uso no es accesible para los clientes
-- ---------------------------------------------------------------------
select throws_ok(
  $$ select count(*) from private.ai_analysis_usage $$,
  '42501', null,
  'authenticated no puede leer el registro de uso'
);

select test_helpers.reset_role();
select is(
  (select count(*)::int from private.ai_analysis_usage where user_id = 'e0000000-0000-4000-8000-000000000001'),
  4,
  'el registro conserva las 4 consultas de la dueña (incluida la fallida)'
);
select is(
  (select count(*)::int from private.ai_analysis_usage where user_id = 'e0000000-0000-4000-8000-000000000001' and counts),
  3,
  'de ellas cuentan 3'
);

-- ---------------------------------------------------------------------
-- 7. Privilegios, search_path y bucket
-- ---------------------------------------------------------------------
select is(
  (select count(*)::int
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   cross join (values ('anon'), ('authenticated')) as r (role_name)
   cross join (values ('TRUNCATE'), ('TRIGGER'), ('REFERENCES')) as p (privilege)
   where n.nspname = 'public' and c.relkind = 'r'
     and has_table_privilege(r.role_name, c.oid, p.privilege)),
  0,
  'anon y authenticated no tienen TRUNCATE, TRIGGER ni REFERENCES en ninguna tabla de public'
);

select ok(
  (select proconfig @> array['search_path=""'] from pg_proc
   where oid = 'public.trigger_set_timestamp()'::regprocedure),
  'trigger_set_timestamp tiene search_path fijo'
);

select case
  when exists (select 1 from storage.buckets where id = 'pet-photos') then
    results_eq(
      $$ select file_size_limit, allowed_mime_types from storage.buckets where id = 'pet-photos' $$,
      $$ values (5242880::bigint, array['image/jpeg']::text[]) $$,
      'pet-photos: 5 MB y solo image/jpeg'
    )
  else skip('sin bucket pet-photos en este entorno', 1)
end;

select * from finish();

rollback;
