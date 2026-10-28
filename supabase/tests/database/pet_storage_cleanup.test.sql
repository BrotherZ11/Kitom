-- =====================================================================
-- KITOM · Pruebas de la cola de limpieza de Storage (migración *_pet_storage_cleanup.sql)
-- =====================================================================
-- pgTAP. Solo contra la BD local: `npx supabase test db`, o
--   docker exec -i supabase_db_Kitom psql -U postgres -d postgres -f - < supabase/tests/database/pet_storage_cleanup.test.sql
-- Todo ocurre en una transacción que termina en ROLLBACK, también las filas de
-- storage.objects (solo metadatos: aquí no hay archivos). Dentro de una
-- transacción now() no avanza: los plazos se prueban moviendo las fechas del
-- trabajo. La concurrencia real (dos ejecuciones, reservas caducadas, una
-- subida durante el borrado) está en
-- supabase/tests/concurrency/pet_storage_cleanup_concurrency.sh.
-- Requiere el catálogo de especies (supabase/seed.sql).
-- =====================================================================
begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

-- ---------------------------------------------------------------------
-- Auxiliares (se deshacen con el ROLLBACK)
-- ---------------------------------------------------------------------
create schema test_helpers;
grant usage on schema test_helpers to anon, authenticated, service_role;

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

-- Una mascota del usuario A con id fijo.
create function test_helpers.create_pet(pet uuid, pet_name text) returns void
  language plpgsql as $$
begin
  insert into public.pets (id, owner_id, name, species_id)
  select pet, 'e2000000-0000-4000-8000-000000000001', pet_name, s.id from public.species s where s.code = 'dog';
end $$;

-- Metadatos de un objeto (como los deja la API de Storage, sin archivo).
create function test_helpers.put_object(bucket text, object_name text) returns void
  language plpgsql as $$
begin
  insert into storage.objects (bucket_id, name) values (bucket, object_name);
end $$;

create function test_helpers.job(pet uuid) returns private.pet_storage_cleanup_jobs
  language sql as $$ select * from private.pet_storage_cleanup_jobs where pet_id = pet $$;

-- Deja un trabajo listo para reservarse ya (como si hubieran pasado los 15 min).
create function test_helpers.make_due(pet uuid) returns void
  language sql as $$
  update private.pet_storage_cleanup_jobs set next_attempt_at = now() - interval '1 second' where pet_id = pet
$$;

grant execute on all functions in schema test_helpers to anon, authenticated, service_role;

-- Resultado de la última reserva de cada prueba (lo leen las siguientes).
create table test_helpers.claims (pet_id uuid, job_id uuid, lock_token uuid, attempts integer);
grant all on test_helpers.claims to service_role;

insert into auth.users (id, email, aud, role) values
  ('e2000000-0000-4000-8000-000000000001', 'cleanup-a@example.test', 'authenticated', 'authenticated'),
  ('e2000000-0000-4000-8000-000000000002', 'cleanup-b@example.test', 'authenticated', 'authenticated');

-- Trabajos que ya hubiera en la BD local (otras pruebas borran mascotas): fuera de juego en esta transacción.
update private.pet_storage_cleanup_jobs
   set next_attempt_at = 'infinity', completed_at = case when status = 'done' then now() else completed_at end;

insert into storage.buckets (id, name, public) values ('pet-photos', 'pet-photos', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('reminder-attachments', 'reminder-attachments', false) on conflict (id) do nothing;

-- =====================================================================
-- 1. Permisos: la cola y las RPC no son de anon ni de authenticated
-- =====================================================================
select ok(not has_schema_privilege('anon', 'private', 'USAGE'), 'permisos: anon no usa el esquema private');
select ok(not has_schema_privilege('authenticated', 'private', 'USAGE'), 'permisos: authenticated no usa el esquema private');
select ok(not has_schema_privilege('service_role', 'private', 'USAGE'), 'permisos: service_role tampoco (solo por las RPC)');
select ok(
  not has_table_privilege('anon', 'private.pet_storage_cleanup_jobs', 'SELECT, INSERT, UPDATE, DELETE')
  and not has_table_privilege('authenticated', 'private.pet_storage_cleanup_jobs', 'SELECT, INSERT, UPDATE, DELETE')
  and not has_table_privilege('service_role', 'private.pet_storage_cleanup_jobs', 'SELECT, INSERT, UPDATE, DELETE'),
  'permisos: nadie salvo el propietario lee ni escribe la cola');
select ok(
  (select relrowsecurity from pg_class where oid = 'private.pet_storage_cleanup_jobs'::regclass),
  'permisos: la cola tiene RLS (sin políticas)');

select is(
  (select row(count(*), count(*) filter (where
            p.prosecdef and p.proconfig = array['search_path=""']
            and not has_function_privilege('anon', p.oid, 'EXECUTE')
            and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
            and has_function_privilege('service_role', p.oid, 'EXECUTE')))::text
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'pet\_storage\_cleanup\_%'),
  row(6, 6)::text,
  'permisos: hay exactamente 6 RPC y todas son SECURITY DEFINER, search_path vacío y solo para service_role');
select ok(
  not has_function_privilege('anon', 'private.pet_storage_cleanup_assert_ready()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.pet_storage_cleanup_assert_ready()', 'EXECUTE')
  and not has_function_privilege('service_role', 'private.pet_storage_cleanup_assert_ready()', 'EXECUTE'),
  'permisos: nadie ejecuta la comprobación de garantías directamente');
select ok(
  not has_function_privilege('anon', 'private.enqueue_pet_storage_cleanup()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.enqueue_pet_storage_cleanup()', 'EXECUTE')
  and not has_function_privilege('service_role', 'private.enqueue_pet_storage_cleanup()', 'EXECUTE'),
  'permisos: nadie ejecuta la función del trigger directamente');

select test_helpers.act_as('e2000000-0000-4000-8000-000000000001');
select throws_ok($$select * from public.pet_storage_cleanup_claim(1, 60)$$, '42501', null,
  'permisos: un usuario no puede reservar trabajos');
select throws_ok($$select public.pet_storage_cleanup_purge()$$, '42501', null,
  'permisos: un usuario no puede purgar la cola');
select throws_ok($$select * from private.pet_storage_cleanup_jobs$$, '42501', null,
  'permisos: un usuario no puede leer la cola');
select test_helpers.act_as_anon();
select throws_ok($$select * from public.pet_storage_cleanup_preview(10)$$, '42501', null,
  'permisos: anon no puede ver el informe');
select test_helpers.reset_role();

-- =====================================================================
-- 2. Encolar: al borrar, en la misma transacción, sin duplicados
-- =====================================================================
select test_helpers.create_pet('e2000000-0000-4000-8000-0000000000b1', 'Borrada');
select test_helpers.create_pet('e2000000-0000-4000-8000-0000000000b2', 'Revertida');
select test_helpers.create_pet('e2000000-0000-4000-8000-0000000000b3', 'Sin fotos');
select test_helpers.create_pet('e2000000-0000-4000-8000-0000000000b4', 'Existe');

select test_helpers.act_as('e2000000-0000-4000-8000-000000000001');
update public.pets set name = 'Existe 2' where id = 'e2000000-0000-4000-8000-0000000000b4';
delete from public.pets where id = 'e2000000-0000-4000-8000-0000000000b1';
savepoint before_revert;
delete from public.pets where id = 'e2000000-0000-4000-8000-0000000000b2';
rollback to savepoint before_revert;
delete from public.pets where id = 'e2000000-0000-4000-8000-0000000000b3';
select test_helpers.reset_role();

select is(
  (select row(status, attempts, deleted_at = now(), next_attempt_at = now() + interval '15 minutes',
              lock_token is null, objects_removed, last_error)::text
   from test_helpers.job('e2000000-0000-4000-8000-0000000000b1')),
  row('pending', 0, true, true, true, 0, null::text)::text,
  'encolar: el borrado del propietario (con RLS) deja un trabajo pendiente para dentro de 15 min');
select is((select count(*)::integer from private.pet_storage_cleanup_jobs where pet_id = 'e2000000-0000-4000-8000-0000000000b2'), 0,
  'encolar: un borrado revertido no deja trabajo');
select is((select count(*)::integer from private.pet_storage_cleanup_jobs where pet_id = 'e2000000-0000-4000-8000-0000000000b4'), 0,
  'encolar: un UPDATE no encola');

-- El mismo id otra vez (solo posible a mano) y vuelto a borrar: un solo trabajo, reabierto.
update private.pet_storage_cleanup_jobs
   set status = 'done', verified_at = now(), completed_at = now(), attempts = 3
 where pet_id = 'e2000000-0000-4000-8000-0000000000b3';
select test_helpers.create_pet('e2000000-0000-4000-8000-0000000000b3', 'Sin fotos otra vez');
delete from public.pets where id = 'e2000000-0000-4000-8000-0000000000b3';
select is(
  (select row(count(*), min(status), min(attempts), bool_and(completed_at is null and verified_at is null))::text
   from private.pet_storage_cleanup_jobs where pet_id = 'e2000000-0000-4000-8000-0000000000b3'),
  row(1, 'pending', 0, true)::text,
  'encolar: sin duplicados; un trabajo terminado se reabre si la mascota vuelve a borrarse');

-- =====================================================================
-- 3. Candidatos: como las políticas (mayúsculas, anidadas), solo pet-photos
-- =====================================================================
select test_helpers.put_object('pet-photos', 'e2000000-0000-4000-8000-0000000000b1/a.jpg');
select test_helpers.put_object('pet-photos', 'E2000000-0000-4000-8000-0000000000B1/b.jpg');
select test_helpers.put_object('pet-photos', 'e2000000-0000-4000-8000-0000000000b1/nested/deep/c.jpg');
select test_helpers.put_object('pet-photos', 'E2000000-0000-4000-8000-0000000000b1/d.jpg');
-- Fuera de alcance: otra mascota, otro bucket y rutas que las políticas no asocian a la mascota.
select test_helpers.put_object('pet-photos', 'e2000000-0000-4000-8000-0000000000b4/x.jpg');
select test_helpers.put_object('reminder-attachments', 'e2000000-0000-4000-8000-0000000000b1/r.jpg');
select test_helpers.put_object('pet-photos', 'e2000000-0000-4000-8000-0000000000b1.jpg');
select test_helpers.put_object('pet-photos', 'x/e2000000-0000-4000-8000-0000000000b1/y.jpg');
select test_helpers.put_object('pet-photos', 'e2000000-0000-4000-8000-0000000000b1x/z.jpg');

select test_helpers.make_due('e2000000-0000-4000-8000-0000000000b1');
select test_helpers.act_as_service();
insert into test_helpers.claims
select c.pet_id, c.job_id, c.lock_token, c.attempts from public.pet_storage_cleanup_claim(10, 300) c;
select test_helpers.reset_role();

select is(
  (select array_agg(pet_id::text order by pet_id) from test_helpers.claims),
  array['e2000000-0000-4000-8000-0000000000b1'],
  'reservar: solo el trabajo vencido (los demás esperan sus 15 min)');
select is((select attempts from test_helpers.claims), 1, 'reservar: cuenta el intento');

select test_helpers.act_as_service();
select is(
  (select array_agg(o.object_name || ':' || o.referenced order by o.object_name collate "C")
   from test_helpers.claims c, public.pet_storage_cleanup_objects(c.job_id, c.lock_token, null, 100) o),
  array['E2000000-0000-4000-8000-0000000000B1/b.jpg:false',
        'E2000000-0000-4000-8000-0000000000b1/d.jpg:false',
        'e2000000-0000-4000-8000-0000000000b1/a.jpg:false',
        'e2000000-0000-4000-8000-0000000000b1/nested/deep/c.jpg:false'],
  'candidatos: uuid en mayúsculas o mixto y rutas anidadas; nada de otra mascota, otro bucket ni rutas mal formadas');
select is(
  (select array_agg(o.object_name order by o.object_name collate "C")
   from test_helpers.claims c,
        public.pet_storage_cleanup_objects(c.job_id, c.lock_token, 'E2000000-0000-4000-8000-0000000000b1/d.jpg', 1) o),
  array['e2000000-0000-4000-8000-0000000000b1/a.jpg'],
  'candidatos: paginación por nombre (después de, límite)');
select throws_ok(
  $$select * from public.pet_storage_cleanup_objects(
      (select job_id from test_helpers.claims), gen_random_uuid(), null, 100)$$,
  'P0001', 'pet_storage_cleanup_lock_lost', 'candidatos: sin el token de la reserva, nada');
select throws_ok(
  $$select * from public.pet_storage_cleanup_objects((select job_id from test_helpers.claims), (select lock_token from test_helpers.claims), null, 0)$$,
  '22023', null, 'candidatos: límite fuera de rango');
select test_helpers.reset_role();

-- Una referencia que los validadores ya impiden (prueba de la defensa en la propia RPC): una consulta de
-- IA de otra mascota que nombra un objeto de b1, con su trigger de validación desactivado solo aquí.
alter table public.ai_analysis_requests disable trigger trg_validate_ai_request_photo_path;
insert into public.ai_analysis_requests (pet_id, photo_path)
values ('e2000000-0000-4000-8000-0000000000b4', 'e2000000-0000-4000-8000-0000000000b1/D.JPG');
alter table public.ai_analysis_requests enable trigger trg_validate_ai_request_photo_path;
select test_helpers.act_as_service();
select is(
  (select array_agg(o.object_name order by o.object_name collate "C")
   from test_helpers.claims c, public.pet_storage_cleanup_objects(c.job_id, c.lock_token, null, 100) o
   where o.referenced),
  array['E2000000-0000-4000-8000-0000000000b1/d.jpg'],
  'candidatos: un objeto que otra fila referencia (sin distinguir mayúsculas) se marca, no se omite');
select test_helpers.reset_role();

-- =====================================================================
-- 4. Reservas: sin solapes, caducidad y tokens
-- =====================================================================
select test_helpers.act_as_service();
select is((select count(*)::integer from public.pet_storage_cleanup_claim(10, 300)), 0,
  'reservas: un trabajo reservado no se vuelve a reservar');
select test_helpers.reset_role();

update private.pet_storage_cleanup_jobs set locked_until = now() - interval '1 second'
 where pet_id = 'e2000000-0000-4000-8000-0000000000b1';
create table test_helpers.old_claim as select * from test_helpers.claims;
grant select on test_helpers.old_claim to service_role;
delete from test_helpers.claims;
select test_helpers.act_as_service();
insert into test_helpers.claims
select c.pet_id, c.job_id, c.lock_token, c.attempts from public.pet_storage_cleanup_claim(10, 300) c;
select ok(
  (select c.job_id = o.job_id and c.lock_token <> o.lock_token and c.attempts = 2
   from test_helpers.claims c, test_helpers.old_claim o),
  'reservas: una reserva caducada se vuelve a tomar con otro token');
select throws_ok(
  $$select public.pet_storage_cleanup_report((select job_id from test_helpers.old_claim), (select lock_token from test_helpers.old_claim), 1, null)$$,
  'P0001', 'pet_storage_cleanup_lock_lost', 'reservas: el token anterior ya no completa ni informa');

-- =====================================================================
-- 5. Informar: la verificación es del servidor
-- =====================================================================
select is(
  (select public.pet_storage_cleanup_report(job_id, lock_token, 0, null) from test_helpers.claims),
  'pending', 'informar: sin error pero con objetos aún: sigue pendiente');
select test_helpers.reset_role();
select is(
  (select row(status, last_error, next_attempt_at = now() + interval '1 minute', lock_token is null, attempts)::text
   from test_helpers.job('e2000000-0000-4000-8000-0000000000b1')),
  row('pending', 'objects_remaining', true, true, 2)::text,
  'informar: «objects_remaining», reintento en 1 min, reserva liberada, el intento cuenta');

-- Sin objetos (b3): vacío dentro del plazo → se comprueba a las 25 h; después → terminado.
select test_helpers.make_due('e2000000-0000-4000-8000-0000000000b3');
delete from test_helpers.claims;
select test_helpers.act_as_service();
insert into test_helpers.claims
select c.pet_id, c.job_id, c.lock_token, c.attempts from public.pet_storage_cleanup_claim(10, 300) c
where c.pet_id = 'e2000000-0000-4000-8000-0000000000b3';
select is((select public.pet_storage_cleanup_report(job_id, lock_token, 0, null) from test_helpers.claims), 'pending',
  'plazo: vacío antes de 25 h no termina');
select test_helpers.reset_role();
select is(
  (select row(status, next_attempt_at = deleted_at + interval '25 hours', attempts, last_error)::text
   from test_helpers.job('e2000000-0000-4000-8000-0000000000b3')),
  row('pending', true, 0, null::text)::text,
  'plazo: la próxima comprobación es a las 25 h del borrado (no es un fallo)');

update private.pet_storage_cleanup_jobs
   set deleted_at = now() - interval '25 hours', next_attempt_at = now() - interval '1 second'
 where pet_id = 'e2000000-0000-4000-8000-0000000000b3';
delete from test_helpers.claims;
select test_helpers.act_as_service();
insert into test_helpers.claims
select c.pet_id, c.job_id, c.lock_token, c.attempts from public.pet_storage_cleanup_claim(10, 300) c
where c.pet_id = 'e2000000-0000-4000-8000-0000000000b3';
select is((select public.pet_storage_cleanup_report(job_id, lock_token, 2, null) from test_helpers.claims), 'done',
  'plazo: vacío a las 25 h → terminado');
select throws_ok(
  $$select public.pet_storage_cleanup_report((select job_id from test_helpers.claims), (select lock_token from test_helpers.claims), 0, null)$$,
  'P0001', 'pet_storage_cleanup_lock_lost', 'terminado: no se puede volver a informar');
select test_helpers.reset_role();
select is(
  (select row(status, verified_at = now(), completed_at = now(), objects_removed, lock_token is null)::text
   from test_helpers.job('e2000000-0000-4000-8000-0000000000b3')),
  row('done', true, true, 2, true)::text,
  'terminado: verificado, con los objetos borrados acumulados y sin reserva');

-- Errores: espera exponencial, el progreso reinicia los intentos y 10 seguidos → failed.
update private.pet_storage_cleanup_jobs set next_attempt_at = now() - interval '1 second', attempts = 2
 where pet_id = 'e2000000-0000-4000-8000-0000000000b1';
delete from test_helpers.claims;
select test_helpers.act_as_service();
insert into test_helpers.claims
select c.pet_id, c.job_id, c.lock_token, c.attempts from public.pet_storage_cleanup_claim(10, 300) c
where c.pet_id = 'e2000000-0000-4000-8000-0000000000b1';
select is((select public.pet_storage_cleanup_report(job_id, lock_token, 0, 'storage_remove_failed') from test_helpers.claims),
  'pending', 'errores: un fallo de Storage deja el trabajo pendiente');
select test_helpers.reset_role();
select is(
  (select row(last_error, attempts, next_attempt_at = now() + interval '20 minutes')::text
   from test_helpers.job('e2000000-0000-4000-8000-0000000000b1')),
  row('storage_remove_failed', 3, true)::text,
  'errores: código guardado y espera exponencial (3.er intento: 20 min)');

update private.pet_storage_cleanup_jobs set next_attempt_at = now() - interval '1 second', attempts = 8
 where pet_id = 'e2000000-0000-4000-8000-0000000000b1';
delete from test_helpers.claims;
select test_helpers.act_as_service();
insert into test_helpers.claims
select c.pet_id, c.job_id, c.lock_token, c.attempts from public.pet_storage_cleanup_claim(10, 300) c
where c.pet_id = 'e2000000-0000-4000-8000-0000000000b1';
select is((select public.pet_storage_cleanup_report(job_id, lock_token, 3, 'storage_remove_failed') from test_helpers.claims),
  'pending', 'errores: con progreso no cuenta para el límite');
select test_helpers.reset_role();
select is((select attempts from test_helpers.job('e2000000-0000-4000-8000-0000000000b1')), 0,
  'errores: borrar algo reinicia los intentos');

update private.pet_storage_cleanup_jobs set next_attempt_at = now() - interval '1 second', attempts = 9
 where pet_id = 'e2000000-0000-4000-8000-0000000000b1';
delete from test_helpers.claims;
select test_helpers.act_as_service();
insert into test_helpers.claims
select c.pet_id, c.job_id, c.lock_token, c.attempts from public.pet_storage_cleanup_claim(10, 300) c
where c.pet_id = 'e2000000-0000-4000-8000-0000000000b1';
select is((select public.pet_storage_cleanup_report(job_id, lock_token, 0, 'object_referenced') from test_helpers.claims),
  'failed', 'errores: el 10.º intento seguido sin progreso es terminal');
select test_helpers.reset_role();
select is(
  (select row(status, last_error, lock_token is null)::text from test_helpers.job('e2000000-0000-4000-8000-0000000000b1')),
  row('failed', 'object_referenced', true)::text, 'errores: failed con su código y sin reserva');

-- Una ejecución que cae siempre (nunca informa) no se reserva sin fin.
select test_helpers.create_pet('e2000000-0000-4000-8000-0000000000b5', 'Cae siempre');
delete from public.pets where id = 'e2000000-0000-4000-8000-0000000000b5';
update private.pet_storage_cleanup_jobs
   set next_attempt_at = now() - interval '1 second', attempts = 10,
       lock_token = gen_random_uuid(), locked_until = now() - interval '1 second'
 where pet_id = 'e2000000-0000-4000-8000-0000000000b5';
select test_helpers.act_as_service();
select is((select count(*)::integer from public.pet_storage_cleanup_claim(10, 300) c where c.pet_id = 'e2000000-0000-4000-8000-0000000000b5'), 0,
  'caídas: agotados los intentos, no se vuelve a reservar');
select test_helpers.reset_role();
select is((select row(status, last_error)::text from test_helpers.job('e2000000-0000-4000-8000-0000000000b5')),
  row('failed', 'max_attempts')::text, 'caídas: pasa a failed (max_attempts)');

-- Un trabajo de una mascota que existe (inconsistencia manual): nada se lista y queda failed.
insert into private.pet_storage_cleanup_jobs (pet_id, next_attempt_at)
values ('e2000000-0000-4000-8000-0000000000b4', now() - interval '1 second');
delete from test_helpers.claims;
select test_helpers.act_as_service();
insert into test_helpers.claims
select c.pet_id, c.job_id, c.lock_token, c.attempts from public.pet_storage_cleanup_claim(10, 300) c
where c.pet_id = 'e2000000-0000-4000-8000-0000000000b4';
select throws_ok(
  $$select * from public.pet_storage_cleanup_objects((select job_id from test_helpers.claims), (select lock_token from test_helpers.claims), null, 100)$$,
  'P0001', 'pet_storage_cleanup_pet_exists', 'mascota existente: no se listan sus objetos');
select is((select public.pet_storage_cleanup_report(job_id, lock_token, 0, 'pet_exists') from test_helpers.claims), 'failed',
  'mascota existente: el trabajo queda failed');

-- Parámetros inválidos.
select throws_ok($$select * from public.pet_storage_cleanup_claim(0, 300)$$, '22023', null, 'parámetros: lote 0');
select throws_ok($$select * from public.pet_storage_cleanup_claim(11, 300)$$, '22023', null, 'parámetros: lote > 10');
select throws_ok($$select * from public.pet_storage_cleanup_claim(1, 30)$$, '22023', null, 'parámetros: reserva < 60 s');
select throws_ok(
  $$select public.pet_storage_cleanup_report(gen_random_uuid(), gen_random_uuid(), 0, 'see https://example.test?token=x')$$,
  '22023', null, 'parámetros: el error solo puede ser un código conocido (nada de texto libre)');
select throws_ok($$select public.pet_storage_cleanup_report(gen_random_uuid(), gen_random_uuid(), -1, null)$$,
  '22023', null, 'parámetros: objetos borrados negativos');
select test_helpers.reset_role();

-- =====================================================================
-- 6. Informe, auditoría y retención
-- =====================================================================
select test_helpers.act_as_service();
select is(
  (select row(p.pet_exists, p.objects, p.referenced)::text
   from public.pet_storage_cleanup_preview(100) p
   join test_helpers.claims c on c.job_id = p.job_id),
  null, 'informe: un trabajo failed no aparece');
select test_helpers.reset_role();
update private.pet_storage_cleanup_jobs set status = 'pending', last_error = null, attempts = 0
 where pet_id = 'e2000000-0000-4000-8000-0000000000b1';
create table test_helpers.b1_job as select id from test_helpers.job('e2000000-0000-4000-8000-0000000000b1');
grant select on test_helpers.b1_job to service_role;
select test_helpers.act_as_service();
select is(
  (select row(p.pet_exists, p.objects, p.referenced)::text
   from public.pet_storage_cleanup_preview(100) p
   where p.job_id = (select id from test_helpers.b1_job)),
  row(false, 4, 1)::text, 'informe: objetos candidatos y referenciados de cada trabajo pendiente, sin reservar');
select is(
  (select row(a.objects, a.job_status)::text from public.pet_storage_cleanup_audit(1000) a
   where a.folder_pet_id = 'e2000000-0000-4000-8000-0000000000b1'),
  row(4, 'pending')::text, 'auditoría: la carpeta de una mascota borrada, con todas sus variantes, y su trabajo');
select is(
  (select count(*)::integer from public.pet_storage_cleanup_audit(1000) a
   where a.folder_pet_id = 'e2000000-0000-4000-8000-0000000000b4'),
  0, 'auditoría: nunca la carpeta de una mascota existente');
select test_helpers.reset_role();

update private.pet_storage_cleanup_jobs set completed_at = now() - interval '91 days'
 where pet_id = 'e2000000-0000-4000-8000-0000000000b3';
select test_helpers.act_as_service();
select is(public.pet_storage_cleanup_purge(), 1, 'retención: borra los terminados de más de 90 días');
select test_helpers.reset_role();
select is(
  (select array_agg(status order by status) from private.pet_storage_cleanup_jobs
   where pet_id in ('e2000000-0000-4000-8000-0000000000b1', 'e2000000-0000-4000-8000-0000000000b3',
                    'e2000000-0000-4000-8000-0000000000b4', 'e2000000-0000-4000-8000-0000000000b5')),
  array['failed', 'failed', 'pending'], 'retención: los pendientes y los failed se conservan');

-- =====================================================================
-- 7. Sin garantías no se trabaja (revisión de seguridad)
-- =====================================================================
select lives_ok($$select private.pet_storage_cleanup_assert_ready()$$,
  'garantías: el propietario de las RPC ve storage.objects entero y el CHECK de photo_path existe');

-- Un rol que no se salta RLS (authenticated, con acceso concedido solo dentro de esta transacción).
grant usage on schema private to authenticated;
grant execute on function private.pet_storage_cleanup_assert_ready() to authenticated;
select test_helpers.act_as('e2000000-0000-4000-8000-000000000001');
select throws_ok($$select private.pet_storage_cleanup_assert_ready()$$, 'P0001', 'pet_storage_cleanup_storage_not_visible',
  'garantías: quien no ve storage.objects entero no puede trabajar (vería 0 objetos y terminaría en falso)');
select test_helpers.reset_role();

-- Sin el CHECK de photo_path, nada se reserva ni se lista ni se da por terminado. (Al final y sin
-- savepoint: volver a uno desharía también los resultados que pgTAP ya anotó; el ROLLBACK lo deshace.)
alter table public.pets drop constraint pets_photo_path_own_pet;
select test_helpers.act_as_service();
select throws_ok($$select * from public.pet_storage_cleanup_claim(1, 60)$$, 'P0001', 'pet_storage_cleanup_photo_path_unchecked',
  'garantías: sin el CHECK de photo_path no se reserva');
select throws_ok($$select * from public.pet_storage_cleanup_preview(10)$$, 'P0001', 'pet_storage_cleanup_photo_path_unchecked',
  'garantías: ni se informa');
select throws_ok(
  $$select public.pet_storage_cleanup_report(gen_random_uuid(), gen_random_uuid(), 0, null)$$,
  'P0001', 'pet_storage_cleanup_photo_path_unchecked', 'garantías: ni se termina un trabajo');
select test_helpers.reset_role();

select * from finish();
rollback;
