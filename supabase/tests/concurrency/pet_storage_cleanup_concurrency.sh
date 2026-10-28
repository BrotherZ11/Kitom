#!/usr/bin/env bash
# =====================================================================
# KITOM · Concurrencia real de la cola de limpieza de Storage (fase 12B)
# =====================================================================
# Migración 20261027194908_pet_storage_cleanup.sql: lo que pgTAP no puede
# probar en una sola transacción.
#   1. Cuatro ejecuciones reservan a la vez (lotes de 2 sobre 8 trabajos):
#      cada trabajo, exactamente una vez; cada una solo ve los objetos de sus
#      mascotas, nunca los de otra ni los de una mascota existente.
#   2. Una reserva retenida (transacción abierta) no bloquea a otra
#      ejecución, que toma otro trabajo. Si la sesión cae antes de confirmar,
#      la reserva se deshace y el trabajo se vuelve a poder tomar.
#   3. Una ejecución que reserva y cae sin informar: hasta que caduca la
#      reserva nadie lo toma; después, otra lo toma con otro token y el
#      informe tardío de la primera se rechaza.
#   4. Dos informes del mismo trabajo a la vez (un reintento HTTP): el
#      segundo espera y se rechaza; el recuento no se duplica.
#   5. Una subida en curso durante el borrado de la mascota: la fila del
#      objeto puede aparecer después del borrado (la política se evaluó con la
#      mascota viva). Ni una pasada antes de que aparezca ni una después del
#      plazo dan el trabajo por terminado mientras haya objetos. Una subida
#      que empieza después del borrado la rechaza la política.
#
# Los objetos son solo filas de storage.objects (sin archivo), como las deja
# la API al subir. Solo local: `docker exec` sobre el contenedor de Supabase
# local, nunca una URL remota. Ids fijos que se borran al terminar (también
# si falla). Uso, desde la raíz del repo:
#   bash supabase/tests/concurrency/pet_storage_cleanup_concurrency.sh
# Requiere `npx supabase start`, las migraciones aplicadas, el bucket
# `pet-photos` (npx supabase seed buckets --local) y supabase/seed.sql.
# =====================================================================
set -u

CONTAINER="${SUPABASE_DB_CONTAINER:-supabase_db_Kitom}"

OWNER='c3000000-0000-4000-8000-000000000001'
PREFIX='f3000000-0000-4000-8000-0000000000'   # + 2 dígitos: mascotas de esta prueba
ALIVE="${PREFIX}99"                            # una mascota que sigue existiendo
GATE=20261027

WORK="$(mktemp -d)"
FAILED=0

run_psql() {
  docker exec -i -e PGAPPNAME="$1" "$CONTAINER" psql -U postgres -d postgres -X -q -t -A -v ON_ERROR_STOP=1
}

query() { run_psql kitom_sc_main <<<"$1" 2>&1 | tr -d '\r'; }

pass() { echo "ok   - $1"; }
fail() { echo "FAIL - $1"; FAILED=1; }
check() { if [ "$2" = "$3" ]; then pass "$1"; else fail "$1 (esperado: '$3', obtenido: '$2')"; fi; }
check_contains() { if grep -q "$3" "$2"; then pass "$1"; else fail "$1 (no aparece '$3' en la salida: $(tr '\n' ' ' < "$2"))"; fi; }

# $1 consulta que debe dar 't' · $2 intentos cada 0,2 s (50 por defecto)
wait_until() {
  for _ in $(seq 1 "${2:-50}"); do
    [ "$(query "$1")" = "t" ] && return 0
    sleep 0.2
  done
  return 1
}

holding() { echo "select exists (select 1 from pg_stat_activity where application_name = '$1' and state = 'active' and query like '%pg_sleep%')"; }
blocked() { echo "select exists (select 1 from pg_stat_activity where application_name = '$1' and wait_event_type = 'Lock')"; }
finished() { echo "select not exists (select 1 from pg_stat_activity where application_name = '$1')"; }

# Filas de prueba en storage.objects: sin archivo, se quitan con SQL (la API no las conoce).
remove_test_objects() {
  query "begin;
         set local storage.allow_delete_query = 'true';
         delete from storage.objects where bucket_id = 'pet-photos' and lower(name) like '${PREFIX}%';
         commit;" > /dev/null
}

cleanup() {
  query "select pg_terminate_backend(pid) from pg_stat_activity where application_name like 'kitom_sc_%' and pid <> pg_backend_pid()" > /dev/null
  remove_test_objects
  query "delete from public.pets where owner_id = '$OWNER';
         delete from private.pet_storage_cleanup_jobs where pet_id::text like '${PREFIX}%';
         delete from auth.users where id = '$OWNER';" > /dev/null
  rm -rf "$WORK"
}
trap cleanup EXIT

as_service() {
  cat <<SQL
begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
SQL
}

as_owner() {
  cat <<SQL
begin;
select set_config('request.jwt.claims', '{"sub":"$OWNER","role":"authenticated"}', true);
set local role authenticated;
SQL
}

# Reserva. $1 lote · $2 espera antes de confirmar (s). Una línea `claim:job:pet:token` por trabajo.
claim_sql() {
  cat <<SQL
$(as_service)
select 'claim:' || job_id || ':' || pet_id || ':' || lock_token from public.pet_storage_cleanup_claim($1, 300);
select pg_sleep($2);
commit;
SQL
}

# Objetos de un trabajo. $1 job · $2 token.
objects_sql() {
  cat <<SQL
$(as_service)
select 'object:' || object_name from public.pet_storage_cleanup_objects('$1', '$2', null, 1000);
commit;
SQL
}

# Informe. $1 job · $2 token · $3 borrados · $4 espera antes de confirmar (s).
report_sql() {
  cat <<SQL
$(as_service)
select 'report:' || public.pet_storage_cleanup_report('$1', '$2', $3, null);
select pg_sleep($4);
commit;
SQL
}

gated() {
  cat <<SQL
select pg_advisory_lock_shared($GATE);
select pg_advisory_unlock_shared($GATE);
$(cat)
SQL
}
close_gate() {
  (echo "select pg_advisory_lock($GATE); select pg_sleep(60);" | run_psql kitom_sc_gate > /dev/null 2>&1) &
  wait_until "$(holding kitom_sc_gate)"
}
open_gate() {
  query "select pg_terminate_backend(pid) from pg_stat_activity where application_name = 'kitom_sc_gate'" > /dev/null
}

# Crea las mascotas $PREFIX$1..$2 del propietario, cada una con un objeto, y las borra (encola). Sus
# trabajos quedan vencidos y por delante de cualquier otro de la BD local (next_attempt_at muy antiguo).
seed_deleted_pets() {
  query "insert into public.pets (id, owner_id, name, species_id)
           select ('${PREFIX}' || lpad(i::text, 2, '0'))::uuid, '$OWNER', 'sc' || i, s.id
           from generate_series($1, $2) i, public.species s where s.code = 'dog';
         insert into storage.objects (bucket_id, name)
           select 'pet-photos', '${PREFIX}' || lpad(i::text, 2, '0') || '/photo.jpg' from generate_series($1, $2) i;
         delete from public.pets where id::text like '${PREFIX}%' and id <> '$ALIVE';
         update private.pet_storage_cleanup_jobs
            set next_attempt_at = now() - interval '100 years' + (substr(pet_id::text, 35, 2)::int * interval '1 second')
          where pet_id in (select ('${PREFIX}' || lpad(i::text, 2, '0'))::uuid from generate_series($1, $2) i);" > /dev/null
}

job_of() { query "select id || ':' || coalesce(lock_token::text, '') from private.pet_storage_cleanup_jobs where pet_id = '$1'"; }

# ---------------------------------------------------------------------
# Preparación
# ---------------------------------------------------------------------
if ! docker exec "$CONTAINER" true 2> /dev/null; then
  echo "No se encuentra el contenedor local '$CONTAINER'. Arranca Supabase local (npx supabase start)."
  exit 2
fi
if [ "$(query "select count(*) from storage.buckets where id = 'pet-photos'")" != "1" ]; then
  echo "Falta el bucket local pet-photos: npx supabase seed buckets --local"
  exit 2
fi

cleanup_before="$(query "delete from public.pets where owner_id = '$OWNER';
  delete from private.pet_storage_cleanup_jobs where pet_id::text like '${PREFIX}%';
  delete from auth.users where id = '$OWNER';")"
remove_test_objects
setup="$(query "
  insert into auth.users (id, email, aud, role) values ('$OWNER', 'sc-owner@example.test', 'authenticated', 'authenticated');
  insert into public.pets (id, owner_id, name, species_id)
    select '$ALIVE', '$OWNER', 'viva', s.id from public.species s where s.code = 'dog';
  insert into storage.objects (bucket_id, name) values ('pet-photos', '$ALIVE/alive.jpg');
  select count(*) from public.pets where id = '$ALIVE';")"
if [ "$setup" != "1" ]; then
  echo "No se pudieron crear los datos de prueba: $cleanup_before $setup"
  exit 2
fi

# ---------------------------------------------------------------------
# 1. Cuatro ejecuciones a la vez: cada trabajo una vez, cada una solo sus objetos
# ---------------------------------------------------------------------
seed_deleted_pets 1 8
close_gate || fail "1: no se pudo cerrar la línea de salida"
for i in 1 2 3 4; do
  claim_sql 2 0 | gated | run_psql "kitom_sc_c$i" > "$WORK/1_$i" 2>&1 &
done
wait_until "select count(*) = 4 from pg_stat_activity where application_name like 'kitom_sc_c%' and wait_event_type = 'Lock'" \
  || fail "1: no todas las ejecuciones llegaron a la línea de salida"
open_gate
wait
cat "$WORK"/1_* | grep -o 'claim:[^ ]*' > "$WORK/1_claims"
check "1: se reservan los 8 trabajos" "$(wc -l < "$WORK/1_claims" | tr -d ' ')" "8"
check "1: ninguno dos veces" "$(cut -d: -f2 "$WORK/1_claims" | sort -u | wc -l | tr -d ' ')" "8"
check "1: todos son de esta prueba (nada ajeno de la BD local)" "$(cut -d: -f3 "$WORK/1_claims" | grep -vc "^$PREFIX")" "0"
check "1: cada ejecución, su lote de 2" "$(for i in 1 2 3 4; do grep -c 'claim:' "$WORK/1_$i"; done | sort -u | tr '\n' ' ')" "2 "
: > "$WORK/1_objects"
while IFS=: read -r _ job pet token; do
  objects_sql "$job" "$token" | run_psql kitom_sc_o | grep -o 'object:.*' | tr -d '\r' | sed "s|^|$pet |" >> "$WORK/1_objects"
done < "$WORK/1_claims"
check "1: los objetos de cada trabajo son solo los de su mascota" \
  "$(awk '{ split($2, a, ":"); split(a[2], b, "/"); if (tolower(b[1]) != $1) print }' "$WORK/1_objects" | wc -l | tr -d ' ')" "0"
check "1: entre todos, los 8 objetos de las mascotas borradas" "$(wc -l < "$WORK/1_objects" | tr -d ' ')" "8"
check "1: nunca el de la mascota que existe" "$(grep -c "$ALIVE" "$WORK/1_objects")" "0"

# ---------------------------------------------------------------------
# 2. Una reserva retenida no bloquea; si la sesión cae, se deshace
# ---------------------------------------------------------------------
seed_deleted_pets 11 12
claim_sql 1 30 | run_psql kitom_sc_a > "$WORK/2_a" 2>&1 &
wait_until "$(holding kitom_sc_a)" || fail "2: la primera reserva no llegó a retenerse"
claim_sql 1 0 | run_psql kitom_sc_b > "$WORK/2_b" 2>&1
check "2: la segunda ejecución no espera (termina con la primera aún abierta)" "$(query "$(holding kitom_sc_a)")" "t"
check_contains "2: y toma otro trabajo" "$WORK/2_b" "${PREFIX}12"
held_pet="${PREFIX}11"
query "select pg_terminate_backend(pid) from pg_stat_activity where application_name = 'kitom_sc_a'" > /dev/null
wait
check "2: la sesión que cae antes de confirmar no deja reserva" "$(job_of "$held_pet" | cut -d: -f2)" ""
claim_sql 1 0 | run_psql kitom_sc_b > "$WORK/2_c" 2>&1
check_contains "2: el trabajo se vuelve a poder tomar enseguida" "$WORK/2_c" "$held_pet"

# ---------------------------------------------------------------------
# 3. Reserva confirmada y ejecución caída: caduca, otra la toma, el token viejo no vale
# ---------------------------------------------------------------------
# 22 es un señuelo: la segunda reserva tiene algo de esta prueba que tomar (nunca un trabajo ajeno).
seed_deleted_pets 21 22
claim_sql 1 0 | run_psql kitom_sc_a > "$WORK/3_a" 2>&1
IFS=: read -r _ JOB3 _ OLD3 < <(grep -o 'claim:[^ ]*' "$WORK/3_a")
check_contains "3: la primera ejecución toma el trabajo" "$WORK/3_a" "${PREFIX}21"
claim_sql 1 0 | run_psql kitom_sc_b > "$WORK/3_b" 2>&1
check "3: mientras la reserva vale, nadie más la toma" "$(grep -c "$JOB3" "$WORK/3_b") $(grep -c "${PREFIX}22" "$WORK/3_b")" "0 1"
query "update private.pet_storage_cleanup_jobs set locked_until = now() - interval '1 second' where id = '$JOB3'" > /dev/null
claim_sql 1 0 | run_psql kitom_sc_b > "$WORK/3_c" 2>&1
IFS=: read -r _ JOB3B _ NEW3 < <(grep -o 'claim:[^ ]*' "$WORK/3_c")
check "3: caducada, otra ejecución la toma con otro token" "$JOB3B $( [ "$NEW3" != "$OLD3" ] && echo distinto)" "$JOB3 distinto"
report_sql "$JOB3" "$OLD3" 1 0 | run_psql kitom_sc_a > "$WORK/3_d" 2>&1
check_contains "3: el informe tardío de la primera se rechaza" "$WORK/3_d" "pet_storage_cleanup_lock_lost"
report_sql "$JOB3" "$NEW3" 0 0 | run_psql kitom_sc_b > "$WORK/3_e" 2>&1
check_contains "3: el de la reserva vigente se acepta" "$WORK/3_e" "report:pending"

# ---------------------------------------------------------------------
# 4. Dos informes del mismo trabajo a la vez: uno vale, el otro espera y se rechaza
# ---------------------------------------------------------------------
seed_deleted_pets 31 31
claim_sql 1 0 | run_psql kitom_sc_a > "$WORK/4_a" 2>&1
IFS=: read -r _ JOB4 _ TOKEN4 < <(grep -o 'claim:[^ ]*' "$WORK/4_a")
report_sql "$JOB4" "$TOKEN4" 1 5 | run_psql kitom_sc_a > "$WORK/4_b" 2>&1 &
wait_until "$(holding kitom_sc_a)" || fail "4: el primer informe no llegó a retenerse"
report_sql "$JOB4" "$TOKEN4" 1 0 | run_psql kitom_sc_b > "$WORK/4_c" 2>&1 &
wait_until "$(blocked kitom_sc_b)" && pass "4: el segundo informe espera al primero" || fail "4: el segundo informe no llegó a bloquearse"
wait
check_contains "4: el primero se aplica" "$WORK/4_b" "report:pending"
check_contains "4: el segundo se rechaza (la reserva ya se liberó)" "$WORK/4_c" "pet_storage_cleanup_lock_lost"
check "4: lo borrado se cuenta una vez" "$(query "select objects_removed from private.pet_storage_cleanup_jobs where id = '$JOB4'")" "1"

# ---------------------------------------------------------------------
# 5. Subida en curso durante el borrado: ninguna finalización falsa
# ---------------------------------------------------------------------
P5="${PREFIX}41"
query "insert into public.pets (id, owner_id, name, species_id)
         select '$P5', '$OWNER', 'subida', s.id from public.species s where s.code = 'dog';" > /dev/null
# La subida: la política (can_edit_pet) se evalúa con la mascota viva y la transacción sigue abierta.
cat <<SQL | run_psql kitom_sc_u > "$WORK/5_u" 2>&1 &
$(as_owner)
insert into storage.objects (bucket_id, name) values ('pet-photos', '$P5/late.jpg') returning 'uploaded:' || name;
select pg_sleep(20);
commit;
SQL
wait_until "$(holding kitom_sc_u)" || fail "5: la subida no llegó a quedar en curso"
cat <<SQL | run_psql kitom_sc_d > "$WORK/5_d" 2>&1
$(as_owner)
delete from public.pets where id = '$P5' returning 'deleted:' || id;
commit;
SQL
check_contains "5: el borrado de la mascota no espera a la subida" "$WORK/5_d" "deleted:"
# Pasada mientras la subida no ha confirmado: no ve el objeto.
query "update private.pet_storage_cleanup_jobs set next_attempt_at = now() - interval '100 years' where pet_id = '$P5'" > /dev/null
claim_sql 1 0 | run_psql kitom_sc_a > "$WORK/5_a" 2>&1
IFS=: read -r _ JOB5 _ TOKEN5 < <(grep -o 'claim:[^ ]*' "$WORK/5_a")
check "5: la pasada temprana es la de esta mascota" "$(grep -c "$P5" "$WORK/5_a")" "1"
check "5: la pasada temprana no ve objetos" "$(objects_sql "$JOB5" "$TOKEN5" | run_psql kitom_sc_a | grep -c 'object:')" "0"
report_sql "$JOB5" "$TOKEN5" 0 0 | run_psql kitom_sc_a > "$WORK/5_r1" 2>&1
check_contains "5: vacío dentro del plazo: no termina" "$WORK/5_r1" "report:pending"
wait_until "$(finished kitom_sc_u)" 200 || fail "5: la subida no terminó"
check_contains "5: la subida confirma después del borrado" "$WORK/5_u" "uploaded:"
check "5: el objeto existe sin mascota" "$(query "select count(*) from storage.objects where bucket_id = 'pet-photos' and name = '$P5/late.jpg'")" "1"
# Pasada de verificación pasado el plazo: lo encuentra y no da el trabajo por terminado.
query "update private.pet_storage_cleanup_jobs set deleted_at = now() - interval '26 hours', next_attempt_at = now() - interval '100 years' where pet_id = '$P5'" > /dev/null
claim_sql 1 0 | run_psql kitom_sc_a > "$WORK/5_b" 2>&1
IFS=: read -r _ JOB5B _ TOKEN5B < <(grep -o 'claim:[^ ]*' "$WORK/5_b")
check "5: la verificación ve el objeto tardío" "$(objects_sql "$JOB5B" "$TOKEN5B" | run_psql kitom_sc_a | grep -o 'object:.*' | tr -d '\r')" "object:$P5/late.jpg"
report_sql "$JOB5B" "$TOKEN5B" 0 0 | run_psql kitom_sc_a > "$WORK/5_r2" 2>&1
check_contains "5: con el objeto aún ahí, sigue pendiente" "$WORK/5_r2" "report:pending"
check "5: y lo dice" "$(query "select status || ':' || last_error from private.pet_storage_cleanup_jobs where pet_id = '$P5'")" "pending:objects_remaining"
# Una subida que empieza después del borrado: la política ya no la deja.
cat <<SQL | run_psql kitom_sc_u > "$WORK/5_v" 2>&1
$(as_owner)
insert into storage.objects (bucket_id, name) values ('pet-photos', '$P5/after.jpg') returning 'uploaded:' || name;
commit;
SQL
check "5: una subida posterior al borrado la rechaza la política" "$(grep -c 'uploaded:' "$WORK/5_v") $(grep -c 'row-level security' "$WORK/5_v")" "0 1"

if [ "$FAILED" -eq 0 ]; then
  echo "Concurrencia de la limpieza de Storage: todas las comprobaciones pasan."
else
  echo "Concurrencia de la limpieza de Storage: hay comprobaciones fallidas."
fi
exit "$FAILED"
