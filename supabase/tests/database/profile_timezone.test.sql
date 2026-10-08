-- =====================================================================
-- KITOM · Pruebas de profiles.timezone (migración *_profile_timezone.sql)
-- =====================================================================
-- pgTAP. Solo contra la BD local: `npx supabase test db`, o
--   docker exec -i supabase_db_Kitom psql -U postgres -d postgres -f - < supabase/tests/database/profile_timezone.test.sql
-- Todo ocurre en una transacción que termina en ROLLBACK.
-- La inicialización de la app hace exactamente esta consulta (PostgREST):
--   update profiles set timezone = $tz where id = $user and timezone is null
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

grant execute on all functions in schema test_helpers to anon, authenticated;

-- A y B: usuarios recién registrados (handle_new_user crea el perfil)
insert into auth.users (id, email, aud, role) values
  ('f0000000-0000-4000-8000-000000000001', 'tz-a@example.test', 'authenticated', 'authenticated'),
  ('f0000000-0000-4000-8000-000000000002', 'tz-b@example.test', 'authenticated', 'authenticated');

-- =====================================================================
-- 1. Esquema, RLS y grants
-- =====================================================================
select is(
  (select row(is_nullable, column_default)::text from information_schema.columns
   where table_schema = 'public' and table_name = 'profiles' and column_name = 'timezone'),
  row('YES', null::text)::text, 'esquema: timezone admite NULL y no tiene default');
select is(
  (select array_agg(timezone is null) from public.profiles
   where id in ('f0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000002')),
  array[true, true], 'alta: un perfil nuevo nace con timezone NULL');
select is(
  (select array_agg(policyname::text order by policyname) from pg_policies where schemaname = 'public' and tablename = 'profiles'),
  array['profiles: insert own', 'profiles: select own', 'profiles: update own'],
  'rls: se mantienen las políticas de profiles');
select is(
  (select array_agg(column_name::text order by column_name) from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'profiles' and grantee = 'authenticated' and privilege_type = 'UPDATE'),
  array['avatar_path', 'disclaimer_accepted_at', 'disclaimer_version', 'external_avatar_url', 'full_name', 'locale',
        'marketing_opt_in', 'onboarding_completed_at', 'phone', 'timezone'],
  'grants: UPDATE de authenticated sin cambios (incluye timezone)');

-- =====================================================================
-- 2. Inicialización (A): solo si está vacía, idempotente
-- =====================================================================
select test_helpers.act_as('f0000000-0000-4000-8000-000000000001');
select results_eq($$ with u as (update public.profiles set timezone = 'Europe/Madrid'
                    where id = 'f0000000-0000-4000-8000-000000000001' and timezone is null returning 1)
                    select count(*)::int from u $$,
  array[1], 'inicialización: guarda Europe/Madrid en su propio perfil vacío');
select is((select timezone from public.profiles where id = 'f0000000-0000-4000-8000-000000000001'),
  'Europe/Madrid', 'inicialización: el perfil queda con Europe/Madrid');
select results_eq($$ with u as (update public.profiles set timezone = 'Europe/Madrid'
                    where id = 'f0000000-0000-4000-8000-000000000001' and timezone is null returning 1)
                    select count(*)::int from u $$,
  array[0], 'inicialización repetida con la misma zona: no-op seguro (0 filas)');
select results_eq($$ with u as (update public.profiles set timezone = 'America/New_York'
                    where id = 'f0000000-0000-4000-8000-000000000001' and timezone is null returning 1)
                    select count(*)::int from u $$,
  array[0], 'inicialización con otra zona del dispositivo: no sobrescribe (0 filas)');
select is((select timezone from public.profiles where id = 'f0000000-0000-4000-8000-000000000001'),
  'Europe/Madrid', 'inicialización: el valor existente se respeta');
select lives_ok($$ update public.profiles set timezone = 'Europe/Madrid'
                   where id = 'f0000000-0000-4000-8000-000000000001' $$,
  'guardar otra vez la misma zona con UPDATE directo: seguro');

-- =====================================================================
-- 3. Valores
-- =====================================================================
select lives_ok($$ update public.profiles set timezone = 'America/Argentina/Buenos_Aires'
                   where id = 'f0000000-0000-4000-8000-000000000001' $$,
  'válido: zona IANA de tres segmentos');
select lives_ok($$ update public.profiles set timezone = 'America/Port-au-Prince'
                   where id = 'f0000000-0000-4000-8000-000000000001' $$,
  'válido: zona IANA con guion');
select lives_ok($$ update public.profiles set timezone = 'UTC'
                   where id = 'f0000000-0000-4000-8000-000000000001' $$,
  'válido: UTC');
select lives_ok($$ update public.profiles set timezone = null
                   where id = 'f0000000-0000-4000-8000-000000000001' $$,
  'válido: NULL (sin configurar)');
select is((select timezone from public.profiles where id = 'f0000000-0000-4000-8000-000000000001'),
  null, 'NULL se guarda como NULL (el trigger ya no lo convierte en UTC)');
select throws_like($$ update public.profiles set timezone = '+01:00' where id = 'f0000000-0000-4000-8000-000000000001' $$,
  '%Zona horaria no válida%', 'inválido: offset +01:00');
select throws_like($$ update public.profiles set timezone = 'CET' where id = 'f0000000-0000-4000-8000-000000000001' $$,
  '%Zona horaria no válida%', 'inválido: abreviatura CET (aunque esté en pg_timezone_names)');
select throws_like($$ update public.profiles set timezone = 'GMT+0' where id = 'f0000000-0000-4000-8000-000000000001' $$,
  '%Zona horaria no válida%', 'inválido: alias GMT+0');
select throws_like($$ update public.profiles set timezone = 'posix/Europe/Madrid' where id = 'f0000000-0000-4000-8000-000000000001' $$,
  '%Zona horaria no válida%', 'inválido: copia posix/');
select throws_like($$ update public.profiles set timezone = 'Mars/Olympus_Mons' where id = 'f0000000-0000-4000-8000-000000000001' $$,
  '%Zona horaria no válida%', 'inválido: formato correcto pero zona inexistente');
select throws_like($$ update public.profiles set timezone = '' where id = 'f0000000-0000-4000-8000-000000000001' $$,
  '%Zona horaria no válida%', 'inválido: cadena vacía');
select throws_like($$ update public.profiles set timezone = 'europe/madrid' where id = 'f0000000-0000-4000-8000-000000000001' $$,
  '%Zona horaria no válida%', 'inválido: mayúsculas incorrectas');

-- =====================================================================
-- 4. Otro usuario y anon
-- =====================================================================
select results_eq($$ with u as (update public.profiles set timezone = 'Asia/Tokyo'
                    where id = 'f0000000-0000-4000-8000-000000000002' returning 1) select count(*)::int from u $$,
  array[0], 'A no puede modificar el timezone de B (RLS filtra la fila)');
select results_eq($$ with u as (update public.profiles set timezone = 'Asia/Tokyo'
                    where id = 'f0000000-0000-4000-8000-000000000002' and timezone is null returning 1)
                    select count(*)::int from u $$,
  array[0], 'A no puede inicializar el timezone de B');
select is((select count(*)::int from public.profiles where id = 'f0000000-0000-4000-8000-000000000002'),
  0, 'A no ve el perfil de B');
reset role;

select test_helpers.act_as_anon();
select results_eq($$ with u as (update public.profiles set timezone = 'Asia/Tokyo' returning 1) select count(*)::int from u $$,
  array[0], 'anon no puede modificar ningún timezone');
reset role;

select is((select timezone from public.profiles where id = 'f0000000-0000-4000-8000-000000000002'),
  null, 'el perfil de B sigue sin timezone');

-- =====================================================================
-- 5. Valores antiguos: solo se valida cuando cambia la zona
-- =====================================================================
-- Simula un valor heredado que hoy se rechazaría (escrito sin trigger).
alter table public.profiles disable trigger trg_validate_profile_timezone;
update public.profiles set timezone = 'CET' where id = 'f0000000-0000-4000-8000-000000000002';
alter table public.profiles enable trigger trg_validate_profile_timezone;
select test_helpers.act_as('f0000000-0000-4000-8000-000000000002');
select lives_ok($$ update public.profiles set full_name = 'B' where id = 'f0000000-0000-4000-8000-000000000002' $$,
  'un valor antiguo no impide editar otras columnas del perfil');
select lives_ok($$ update public.profiles set timezone = 'Europe/Paris' where id = 'f0000000-0000-4000-8000-000000000002' $$,
  'un valor antiguo se puede corregir con una zona válida');
reset role;

select * from finish();
rollback;
