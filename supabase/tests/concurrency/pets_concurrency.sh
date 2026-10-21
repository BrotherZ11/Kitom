#!/usr/bin/env bash
# =====================================================================
# KITOM · Concurrencia real de las escrituras de pets (Pets offline, fase 8)
# =====================================================================
# pgTAP (supabase/tests/database/pets_client_request_id.test.sql) corre en una
# sola transacción y no puede demostrar qué pasa cuando dos sesiones escriben
# a la vez. Esta prueba abre sesiones de psql distintas contra la BD LOCAL:
#
# Alta idempotente (migración *_pets_client_request_id.sql):
#   1. Dos altas con la misma clave: la segunda queda bloqueada por la
#      primera (pg_stat_activity) y, al confirmar la primera, recibe 23505
#      (pets_owner_client_request_id_key). Queda una sola mascota.
#   2. Igual, pero la primera hace ROLLBACK: la segunda crea la mascota (un
#      alta que no llegó a confirmarse no bloquea el reenvío).
#   3. N altas lanzadas a la vez con la misma clave: se crea exactamente una.
#
# Edición con precondición (sin cambios de esquema; es lo que hace el cliente:
# PostgREST `update … eq('id', …).eq('updated_at', base)`):
#   4. Dos ediciones con la misma versión leída: la segunda queda bloqueada y,
#      al confirmar la primera, actualiza 0 filas (vuelve a evaluar el WHERE
#      con la versión nueva). La mascota tiene lo que guardó la primera.
#   5. Igual, pero la primera hace ROLLBACK: la segunda se aplica.
#   6. N ediciones lanzadas a la vez con la misma versión: se aplica exactamente una.
#
# Solo local: usa `docker exec` sobre el contenedor de Supabase local, nunca
# una URL remota. Escribe datos de prueba con ids fijos y los borra al
# terminar (también si falla). Uso, desde la raíz del repo:
#   bash supabase/tests/concurrency/pets_concurrency.sh
# Requiere `npx supabase start`, la migración aplicada y los catálogos de supabase/seed.sql.
# =====================================================================
set -u

CONTAINER="${SUPABASE_DB_CONTAINER:-supabase_db_Kitom}"
WRITERS="${WRITERS:-8}"

OWNER='c1000000-0000-4000-8000-000000000001'
EDITOR='c1000000-0000-4000-8000-000000000002'
PET='d1000000-0000-4000-8000-000000000001'
KEY='e1000000-0000-4000-8000-000000000001'
GATE=20261020 # advisory lock que hace de línea de salida en los casos 3 y 6

WORK="$(mktemp -d)"
FAILED=0

# psql dentro del contenedor local. $1 = application_name (para pg_stat_activity).
run_psql() {
  docker exec -i -e PGAPPNAME="$1" "$CONTAINER" psql -U postgres -d postgres -X -q -t -A -v ON_ERROR_STOP=1
}

query() { run_psql kitom_pc_main <<<"$1" 2>&1 | tr -d '\r'; }

pass() { echo "ok   - $1"; }
fail() { echo "FAIL - $1"; FAILED=1; }
check() { if [ "$2" = "$3" ]; then pass "$1"; else fail "$1 (esperado: '$3', obtenido: '$2')"; fi; }
check_contains() { if grep -q "$3" "$2"; then pass "$1"; else fail "$1 (no aparece '$3' en la salida: $(tr '\n' ' ' < "$2"))"; fi; }

# Espera (máx. ~10 s) a que una consulta booleana devuelva t.
wait_until() {
  for _ in $(seq 1 50); do
    [ "$(query "$1")" = "t" ] && return 0
    sleep 0.2
  done
  return 1
}

cleanup() {
  open_gate
  query "delete from public.pets where owner_id = '$OWNER';
         delete from auth.users where id in ('$OWNER', '$EDITOR');" > /dev/null
  rm -rf "$WORK"
}
trap cleanup EXIT

# Cabecera de una sesión de usuario (como PostgREST: claims + rol authenticated).
as_user() {
  cat <<SQL
begin;
select set_config('request.jwt.claims', '{"sub":"$1","role":"authenticated"}', true);
set local role authenticated;
SQL
}

# Alta con clave como la de la app. $1 nombre · $2 espera (s) · $3 commit|rollback
create_sql() {
  cat <<SQL
$(as_user "$OWNER")
insert into public.pets (owner_id, name, species_id, client_request_id)
  select '$OWNER', '$1', s.id, '$KEY' from public.species s where s.code = 'dog'
  returning 'created:' || name;
select pg_sleep($2);
$3;
SQL
}

# Edición con precondición. $1 usuario · $2 nombre · $3 versión base · $4 espera (s) · $5 commit|rollback
update_sql() {
  cat <<SQL
$(as_user "$1")
update public.pets set name = '$2' where id = '$PET' and updated_at = '$3' returning 'updated:' || name;
select pg_sleep($4);
$5;
SQL
}

# Espera en la línea de salida antes de empezar (casos 3 y 6).
gated() {
  cat <<SQL
select pg_advisory_lock_shared($GATE);
select pg_advisory_unlock_shared($GATE);
$(cat)
SQL
}

close_gate() {
  (echo "select pg_advisory_lock($GATE); select pg_sleep(60);" | run_psql kitom_pc_gate > /dev/null 2>&1) &
  wait_until "$(holding kitom_pc_gate)"
}
open_gate() {
  query "select pg_terminate_backend(pid) from pg_stat_activity where application_name = 'kitom_pc_gate'" > /dev/null
}
holding() { echo "select exists (select 1 from pg_stat_activity where application_name = '$1' and state = 'active' and query like '%pg_sleep%')"; }
blocked() { echo "select exists (select 1 from pg_stat_activity where application_name = '$1' and wait_event_type = 'Lock')"; }

keyed() { query "select count(*) from public.pets where owner_id = '$OWNER' and client_request_id = '$KEY'"; }
name_of_pet() { query "select name from public.pets where id = '$PET'"; }

# Siembra la mascota del caso 4–6 con una versión "leída hace una hora" y la devuelve.
seed_pet() {
  query "delete from public.pets where id = '$PET';
         insert into public.pets (id, owner_id, name, species_id, created_at, updated_at)
           select '$PET', '$OWNER', 'v0', s.id, now() - interval '1 hour', now() - interval '1 hour'
           from public.species s where s.code = 'dog';
         insert into public.pet_co_owners (pet_id, user_id, invited_by, role, status, accepted_at)
           values ('$PET', '$EDITOR', '$OWNER', 'editor', 'accepted', now());" > /dev/null
  query "select updated_at from public.pets where id = '$PET'"
}

# ---------------------------------------------------------------------
# Preparación
# ---------------------------------------------------------------------
if ! docker exec "$CONTAINER" true 2> /dev/null; then
  echo "No se encuentra el contenedor local '$CONTAINER'. Arranca Supabase local (npx supabase start)."
  exit 2
fi
if [ "$(query "select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'pets' and column_name = 'client_request_id'")" != "1" ]; then
  echo "Falta pets.client_request_id: aplica la migración en local (npx supabase migration up)."
  exit 2
fi

cleanup_before="$(query "delete from public.pets where owner_id = '$OWNER'; delete from auth.users where id in ('$OWNER', '$EDITOR');")"
setup="$(query "
  insert into auth.users (id, email, aud, role) values
    ('$OWNER',  'pc-owner@example.test',  'authenticated', 'authenticated'),
    ('$EDITOR', 'pc-editor@example.test', 'authenticated', 'authenticated');
  select count(*) from auth.users where id in ('$OWNER', '$EDITOR');")"
if [ "$setup" != "2" ]; then
  echo "No se pudieron crear los datos de prueba: $cleanup_before $setup"
  exit 2
fi

# ---------------------------------------------------------------------
# 1. Dos altas con la misma clave: la segunda espera y recibe 23505
# ---------------------------------------------------------------------
create_sql "A1" 2 commit | run_psql kitom_pc_a > "$WORK/1_a" 2>&1 &
wait_until "$(holding kitom_pc_a)" || fail "1: la primera alta no llegó a retener la fila"
create_sql "B1" 0 commit | run_psql kitom_pc_b > "$WORK/1_b" 2>&1 &
wait_until "$(blocked kitom_pc_b)" && pass "1: la segunda alta espera a la primera (bloqueada en el índice único)" \
  || fail "1: la segunda alta no llegó a bloquearse"
wait
check_contains "1: la primera crea la mascota" "$WORK/1_a" "created:A1"
check_contains "1: la segunda recibe 23505 (pets_owner_client_request_id_key)" "$WORK/1_b" "pets_owner_client_request_id_key"
check "1: una sola mascota con esa clave" "$(keyed)" "1"

# ---------------------------------------------------------------------
# 2. La primera hace ROLLBACK: la segunda crea la mascota
# ---------------------------------------------------------------------
query "delete from public.pets where owner_id = '$OWNER'" > /dev/null
create_sql "A2" 2 rollback | run_psql kitom_pc_a > "$WORK/2_a" 2>&1 &
wait_until "$(holding kitom_pc_a)" || fail "2: la primera alta no llegó a retener la fila"
create_sql "B2" 0 commit | run_psql kitom_pc_b > "$WORK/2_b" 2>&1 &
wait_until "$(blocked kitom_pc_b)" || fail "2: la segunda alta no llegó a bloquearse"
wait
check_contains "2: tras el ROLLBACK de la primera, la segunda crea la mascota" "$WORK/2_b" "created:B2"
check "2: una sola mascota con esa clave" "$(keyed)" "1"

# ---------------------------------------------------------------------
# 3. N altas a la vez con la misma clave: se crea exactamente una
# ---------------------------------------------------------------------
query "delete from public.pets where owner_id = '$OWNER'" > /dev/null
close_gate || fail "3: no se pudo cerrar la línea de salida"
for i in $(seq 1 "$WRITERS"); do
  create_sql "W$i" 0 commit | gated | run_psql "kitom_pc_w$i" > "$WORK/3_$i" 2>&1 &
done
wait_until "select count(*) = $WRITERS from pg_stat_activity where application_name like 'kitom_pc_w%' and wait_event_type = 'Lock'" \
  || fail "3: no todos los escritores llegaron a la línea de salida"
open_gate
wait
check "3: de $WRITERS altas simultáneas se crea exactamente 1" "$(grep -l 'created:W' "$WORK"/3_* | wc -l | tr -d ' ')" "1"
check "3: las otras $((WRITERS - 1)) reciben 23505" "$(grep -l 'pets_owner_client_request_id_key' "$WORK"/3_* | wc -l | tr -d ' ')" "$((WRITERS - 1))"
check "3: una sola mascota con esa clave" "$(keyed)" "1"

# ---------------------------------------------------------------------
# 4. Dos ediciones con la misma versión: la segunda no pisa a la primera
# ---------------------------------------------------------------------
BASE="$(seed_pet)"
update_sql "$OWNER" "A4" "$BASE" 2 commit | run_psql kitom_pc_a > "$WORK/4_a" 2>&1 &
wait_until "$(holding kitom_pc_a)" || fail "4: la primera edición no llegó a retener la fila"
update_sql "$EDITOR" "B4" "$BASE" 0 commit | run_psql kitom_pc_b > "$WORK/4_b" 2>&1 &
wait_until "$(blocked kitom_pc_b)" && pass "4: la segunda edición espera a la primera" || fail "4: la segunda edición no llegó a bloquearse"
wait
check_contains "4: la primera se aplica" "$WORK/4_a" "updated:A4"
check "4: la segunda actualiza 0 filas (la versión base ya no es la actual)" "$(grep -c 'updated:' "$WORK/4_b")" "0"
check "4: la mascota tiene lo que guardó la primera" "$(name_of_pet)" "A4"

# ---------------------------------------------------------------------
# 5. La primera hace ROLLBACK: la segunda se aplica (sin conflictos falsos)
# ---------------------------------------------------------------------
BASE="$(seed_pet)"
update_sql "$OWNER" "A5" "$BASE" 2 rollback | run_psql kitom_pc_a > "$WORK/5_a" 2>&1 &
wait_until "$(holding kitom_pc_a)" || fail "5: la primera edición no llegó a retener la fila"
update_sql "$EDITOR" "B5" "$BASE" 0 commit | run_psql kitom_pc_b > "$WORK/5_b" 2>&1 &
wait_until "$(blocked kitom_pc_b)" || fail "5: la segunda edición no llegó a bloquearse"
wait
check_contains "5: tras el ROLLBACK de la primera, la segunda se aplica" "$WORK/5_b" "updated:B5"
check "5: la mascota tiene lo que guardó la segunda" "$(name_of_pet)" "B5"

# ---------------------------------------------------------------------
# 6. N ediciones a la vez con la misma versión: se aplica exactamente una
# ---------------------------------------------------------------------
BASE="$(seed_pet)"
close_gate || fail "6: no se pudo cerrar la línea de salida"
for i in $(seq 1 "$WRITERS"); do
  user="$OWNER"; [ $((i % 2)) -eq 0 ] && user="$EDITOR"
  update_sql "$user" "W$i" "$BASE" 0 commit | gated | run_psql "kitom_pc_w$i" > "$WORK/6_$i" 2>&1 &
done
wait_until "select count(*) = $WRITERS from pg_stat_activity where application_name like 'kitom_pc_w%' and wait_event_type = 'Lock'" \
  || fail "6: no todos los escritores llegaron a la línea de salida"
open_gate
wait
check "6: de $WRITERS ediciones simultáneas se aplica exactamente 1" "$(grep -l 'updated:W' "$WORK"/6_* | wc -l | tr -d ' ')" "1"
winner="$(cat "$WORK"/6_* | grep -o 'updated:W[0-9]*' | cut -d: -f2)"
check "6: la mascota tiene lo que guardó la ganadora" "$(name_of_pet)" "$winner"

if [ "$FAILED" -eq 0 ]; then
  echo "Concurrencia de pets: todas las comprobaciones pasan."
else
  echo "Concurrencia de pets: hay comprobaciones fallidas."
fi
exit "$FAILED"
