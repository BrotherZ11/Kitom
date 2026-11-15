-- =====================================================================
-- KITOM · Orientación con IA v2 (*_ai_guidance_v2.sql)
-- =====================================================================
-- pgTAP. Solo contra la BD local: `npx supabase test db`, o
--   docker exec -i supabase_db_Kitom psql -U postgres -d postgres -f - < supabase/tests/database/ai_guidance_v2.test.sql
-- Todo ocurre en una transacción que termina en ROLLBACK. Requiere los catálogos
-- (supabase/seed.sql: especies, señales y logros).
-- Cubre: firma nueva de request_ai_analysis (y llamada antigua), contexto del
-- tutor (recorte, en blanco = NULL, límites, inicio y evolución), que un
-- contexto inválido no gasta cupo, CHECK de las columnas del resultado,
-- privilegios por columna, orientación en las 9 especies y señales por especie.
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

-- 'ok' o el SQLSTATE de una sentencia.
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

-- Lo que pasaría esperando un minuto (now() no avanza en la transacción).
create function test_helpers.age_ai_usage() returns void
  language sql security definer as $$
  update private.ai_analysis_usage set created_at = created_at - interval '61 seconds';
$$;

create function test_helpers.usage_count(uid uuid) returns integer
  language sql security definer as $$
  select count(*)::int from private.ai_analysis_usage where user_id = uid;
$$;

grant execute on all functions in schema test_helpers to anon, authenticated;

-- Vera (premium: sin cupo mensual que interfiera), Eloy (editor de su mascota)
-- y Ana (ajena).
insert into auth.users (id, email, aud, role, raw_user_meta_data, email_confirmed_at) values
  ('a9000000-0000-4000-8000-000000000001', 'v2-owner@example.test',  'authenticated', 'authenticated', '{"full_name":"Vera"}', now()),
  ('a9000000-0000-4000-8000-000000000002', 'v2-editor@example.test', 'authenticated', 'authenticated', '{"full_name":"Eloy"}', now()),
  ('a9000000-0000-4000-8000-000000000003', 'v2-other@example.test',  'authenticated', 'authenticated', '{"full_name":"Ana"}', now());

update public.profiles set disclaimer_accepted_at = now(), disclaimer_version = '1.0'
where id in ('a9000000-0000-4000-8000-000000000001', 'a9000000-0000-4000-8000-000000000002');
update public.subscriptions set plan = 'premium' where user_id = 'a9000000-0000-4000-8000-000000000001';

-- Mascotas de Vera: perro y conejo.
insert into public.pets (id, owner_id, name, species_id)
select v.id::uuid, 'a9000000-0000-4000-8000-000000000001', v.name, s.id
from (values
  ('b9000000-0000-4000-8000-000000000001', 'Lúa', 'dog'),
  ('b9000000-0000-4000-8000-000000000002', 'Copo', 'rabbit')
) as v (id, name, code)
join public.species s on s.code = v.code;

insert into public.pet_co_owners (pet_id, user_id, invited_by, role, status, accepted_at) values
  ('b9000000-0000-4000-8000-000000000001', 'a9000000-0000-4000-8000-000000000002',
   'a9000000-0000-4000-8000-000000000001', 'editor', 'accepted', now());

-- ---------------------------------------------------------------------
-- 1. Esquema
-- ---------------------------------------------------------------------
select has_function('public', 'request_ai_analysis', array['uuid', 'text', 'uuid[]', 'text', 'text', 'text'],
  'request_ai_analysis tiene la firma de 6 parámetros');
select hasnt_function('public', 'request_ai_analysis', array['uuid', 'text', 'uuid[]'],
  'la firma de 3 parámetros ya no existe (sin sobrecarga)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'request_ai_analysis'), 1,
  'una sola request_ai_analysis');
select ok(not has_function_privilege('anon', 'public.request_ai_analysis(uuid, text, uuid[], text, text, text)', 'execute'),
  'anon no puede pedir una orientación');
select ok(has_function_privilege('authenticated', 'public.request_ai_analysis(uuid, text, uuid[], text, text, text)', 'execute'),
  'authenticated sí');

select ok(has_column_privilege('authenticated', 'public.ai_analysis_requests', c, 'select'),
  format('authenticated lee %s', c))
from unnest(array['user_context', 'symptom_onset', 'symptom_trend', 'summary', 'warning_signs', 'vet_questions', 'photo_observations']) as c;
select ok(not has_column_privilege('authenticated', 'public.ai_analysis_requests', c, 'update')
          and not has_column_privilege('authenticated', 'public.ai_analysis_requests', c, 'insert'),
  format('authenticated no escribe %s', c))
from unnest(array['user_context', 'symptom_onset', 'symptom_trend', 'summary', 'warning_signs', 'vet_questions', 'photo_observations']) as c;

-- ---------------------------------------------------------------------
-- 2. Contexto del tutor
-- ---------------------------------------------------------------------
select test_helpers.act_as('a9000000-0000-4000-8000-000000000001');

-- Llamada de una versión anterior de la app (3 argumentos): sigue funcionando.
select lives_ok(
  $$ select public.request_ai_analysis(target_pet_id => 'b9000000-0000-4000-8000-000000000001', p_photo_path => null,
       symptom_ids => '{}') $$,
  'la llamada con los 3 argumentos de antes funciona');
select is(
  (select row(user_context, symptom_onset, symptom_trend)::text from public.ai_analysis_requests
   where requested_by = 'a9000000-0000-4000-8000-000000000001' order by created_at desc, id limit 1),
  '(,,)', 'sin contexto: las tres columnas a NULL');
select test_helpers.age_ai_usage();

select lives_ok(
  $$ select public.request_ai_analysis('b9000000-0000-4000-8000-000000000001', null, '{}',
       '   Desde ayer cojea de la pata trasera derecha tras correr en el parque.  ', 'today', 'worse') $$,
  'contexto, inicio y evolución se aceptan');
select is(
  (select row(user_context, symptom_onset, symptom_trend)::text from public.ai_analysis_requests
   where requested_by = 'a9000000-0000-4000-8000-000000000001' and user_context is not null limit 1),
  '("Desde ayer cojea de la pata trasera derecha tras correr en el parque.",today,worse)',
  'el contexto se guarda sin espacios al principio ni al final');
select test_helpers.age_ai_usage();

select lives_ok(
  $$ select public.request_ai_analysis('b9000000-0000-4000-8000-000000000001', null, '{}', E'  \n  ', null, null) $$,
  'un contexto en blanco se acepta');
select is(
  (select user_context from public.ai_analysis_requests
   where requested_by = 'a9000000-0000-4000-8000-000000000001' order by created_at desc, id limit 1),
  null, 'contexto en blanco = NULL');
select test_helpers.age_ai_usage();

select lives_ok(
  format($$ select public.request_ai_analysis('b9000000-0000-4000-8000-000000000001', null, '{}', %L) $$, repeat('a', 1000)),
  '1000 caracteres se aceptan');
select test_helpers.age_ai_usage();

select is(test_helpers.usage_count('a9000000-0000-4000-8000-000000000001'), 4, 'cuatro solicitudes registradas');
select is(
  test_helpers.hint_of(format($$ select public.request_ai_analysis('b9000000-0000-4000-8000-000000000001', null, '{}', %L) $$, repeat('a', 1001))),
  'ai_context_too_long', '1001 caracteres: ai_context_too_long');
select is(
  test_helpers.hint_of($$ select public.request_ai_analysis('b9000000-0000-4000-8000-000000000001', null, '{}', null, 'yesterday') $$),
  'ai_invalid_context', 'inicio desconocido: ai_invalid_context');
select is(
  test_helpers.hint_of($$ select public.request_ai_analysis('b9000000-0000-4000-8000-000000000001', null, '{}', null, null, 'awful') $$),
  'ai_invalid_context', 'evolución desconocida: ai_invalid_context');
select is(test_helpers.usage_count('a9000000-0000-4000-8000-000000000001'), 4,
  'un contexto inválido no gasta cupo ni cuenta para la frecuencia');

select lives_ok(
  $$ select public.request_ai_analysis('b9000000-0000-4000-8000-000000000001', null, '{}', 'x', 'over_week', 'better') $$,
  'tras los rechazos se puede pedir sin esperar');
select test_helpers.age_ai_usage();

-- Las comprobaciones anteriores siguen antes del contexto.
select is(
  test_helpers.hint_of(format($$ select public.request_ai_analysis('b9000000-0000-4000-8000-000000000001', 'otra/foto.jpg', '{}', %L) $$, repeat('a', 1001))),
  'ai_invalid_photo', 'la foto se comprueba antes que el contexto');
reset role;

-- Un co-tutor editor ve el contexto (como la foto y las señales); una ajena, nada.
select test_helpers.act_as('a9000000-0000-4000-8000-000000000002');
select ok(
  (select count(*) from public.ai_analysis_requests
   where pet_id = 'b9000000-0000-4000-8000-000000000001' and user_context is not null) >= 2,
  'el co-tutor ve el contexto de las consultas de la mascota');
reset role;
select test_helpers.act_as('a9000000-0000-4000-8000-000000000003');
select is((select count(*)::int from public.ai_analysis_requests where pet_id = 'b9000000-0000-4000-8000-000000000001'), 0,
  'una ajena no ve las consultas');
reset role;

-- ---------------------------------------------------------------------
-- 3. Columnas del resultado (las escribe la Edge Function)
-- ---------------------------------------------------------------------
select is(test_helpers.state_of($$ update public.ai_analysis_requests set summary = repeat('a', 601)
  where pet_id = 'b9000000-0000-4000-8000-000000000001' $$), '23514', 'resumen de más de 600: CHECK');
select is(test_helpers.state_of($$ update public.ai_analysis_requests set warning_signs = array_fill('a'::text, array[7])
  where pet_id = 'b9000000-0000-4000-8000-000000000001' $$), '23514', '7 señales de alerta: CHECK');
select is(test_helpers.state_of($$ update public.ai_analysis_requests set vet_questions = array[repeat('a', 241)]
  where pet_id = 'b9000000-0000-4000-8000-000000000001' $$), '23514', 'pregunta de más de 240: CHECK');
select is(test_helpers.state_of($$ update public.ai_analysis_requests set photo_observations = repeat('a', 601)
  where pet_id = 'b9000000-0000-4000-8000-000000000001' $$), '23514', 'observación de la foto de más de 600: CHECK');
select is(test_helpers.state_of($$ update public.ai_analysis_requests set symptom_onset = 'ayer'
  where pet_id = 'b9000000-0000-4000-8000-000000000001' $$), '23514', 'inicio fuera de la lista: CHECK');
select is(test_helpers.state_of($$ update public.ai_analysis_requests set user_context = ''
  where pet_id = 'b9000000-0000-4000-8000-000000000001' $$), '23514', 'contexto vacío guardado a mano: CHECK');
select is(test_helpers.state_of($$ update public.ai_analysis_requests
  set summary = 'Resumen.', warning_signs = array['Si deja de comer.'], vet_questions = array['¿Desde cuándo cojea?'], photo_observations = 'Se ve la pata.'
  where pet_id = 'b9000000-0000-4000-8000-000000000001' $$), 'ok', 'un resultado válido se guarda');

-- ---------------------------------------------------------------------
-- 4. Especies y señales (catálogo de supabase/seed.sql)
-- ---------------------------------------------------------------------
select is((select count(*)::int from public.species where ai_guidance_enabled), 9, 'orientación en las 9 especies');
select ok(
  not exists (
    select 1 from public.species s
    where s.ai_guidance_enabled
      and (select count(*) from public.symptom_species ss where ss.species_id = s.id) < 30),
  'cada especie con orientación tiene al menos 30 señales');
select is(
  (select count(*)::int from public.symptom_species ss
   join public.symptoms_catalog sc on sc.id = ss.symptom_id
   join public.species s on s.id = ss.species_id
   where sc.code = 'vomiting' and s.code in ('rabbit', 'guinea_pig', 'hamster', 'horse')), 0,
  'sin «vómitos» en las especies que no pueden vomitar');
select is(
  (select count(*)::int from public.symptom_species ss
   join public.symptoms_catalog sc on sc.id = ss.symptom_id
   join public.species s on s.id = ss.species_id
   where sc.code in ('watery_eyes', 'limping', 'lethargy', 'wound', 'appetite_loss', 'excessive_vocal')
     and s.code in ('dog', 'cat')), 12,
  'las 6 señales del PRD siguen en perro y gato');
select ok(
  not exists (
    select 1 from public.symptoms_catalog sc
    where (select count(*) from public.catalog_translations t
           where t.entity_type = 'symptom' and t.entity_id = sc.id and t.field = 'label' and t.locale in ('es', 'en')) <> 2),
  'cada señal tiene nombre en español e inglés');
select ok(
  not exists (
    select 1 from public.symptoms_catalog
    where category is null
       or category not in ('general', 'digestive', 'oral', 'urinary', 'respiratory', 'skin', 'ocular', 'motor', 'neuro', 'behavior')),
  'cada señal tiene una categoría conocida por la app');

-- Una señal de otra especie sigue rechazándose.
select test_helpers.act_as('a9000000-0000-4000-8000-000000000001');
select is(
  test_helpers.hint_of($$ select public.request_ai_analysis('b9000000-0000-4000-8000-000000000002', null,
    array[(select id from public.symptoms_catalog where code = 'vomiting')]) $$),
  'ai_invalid_symptoms', 'conejo con «vómitos»: ai_invalid_symptoms');
select lives_ok(
  $$ select public.request_ai_analysis('b9000000-0000-4000-8000-000000000002', null,
    array[(select id from public.symptoms_catalog where code = 'no_droppings')], 'No ha comido heno desde anoche.', 'today', 'worse') $$,
  'conejo con «no hace heces» y contexto: se acepta');
reset role;

select * from finish();
rollback;
