#!/usr/bin/env bash
# =====================================================================
# KITOM · Concurrencia real de save_daily_log (migración *_daily_logs_concurrency.sql)
# =====================================================================
# Las pruebas pgTAP (supabase/tests/database/daily_logs.test.sql) corren en
# una sola transacción: comprueban la lógica de las precondiciones, pero no
# pueden demostrar qué pasa cuando dos sesiones escriben a la vez. Esta
# prueba abre sesiones de psql distintas contra la BD LOCAL y fuerza el
# solapamiento:
#   1. Dos ediciones con la misma versión leída: la segunda queda bloqueada
#      por la primera (se comprueba en pg_stat_activity) y, al confirmar la
#      primera, recibe daily_log_conflict / version_mismatch.
#   2. Igual, pero la primera hace ROLLBACK: la segunda se aplica (no hay
#      conflictos falsos).
#   3. Dos creaciones con p_expect_absent del mismo día: la segunda recibe
#      daily_log_conflict / row_exists; queda una sola fila.
#   4. N ediciones lanzadas a la vez con la misma versión: gana exactamente una.
#   5. N creaciones lanzadas a la vez con p_expect_absent: gana exactamente una.
#
# Solo local: usa `docker exec` sobre el contenedor de Supabase local, nunca
# una URL remota. Escribe datos de prueba con ids fijos y los borra al
# terminar (también si falla). Uso, desde la raíz del repo:
#   bash supabase/tests/concurrency/daily_logs_concurrency.sh
# Requiere `npx supabase start` y los catálogos de supabase/seed.sql.
# =====================================================================
set -u

CONTAINER="${SUPABASE_DB_CONTAINER:-supabase_db_Kitom}"
WRITERS="${WRITERS:-8}"

OWNER='c0000000-0000-4000-8000-000000000001'
EDITOR='c0000000-0000-4000-8000-000000000002'
PET='d0000000-0000-4000-8000-000000000001'
GATE=20261010 # advisory lock que hace de línea de salida en los casos 4 y 5

WORK="$(mktemp -d)"
FAILED=0

# psql dentro del contenedor local. $1 = application_name (para pg_stat_activity).
run_psql() {
  docker exec -i -e PGAPPNAME="$1" "$CONTAINER" psql -U postgres -d postgres -X -q -t -A -v ON_ERROR_STOP=1
}

query() { run_psql kitom_cc_main <<<"$1" 2>&1 | tr -d '\r'; }

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
  query "delete from public.pets where id = '$PET';
         delete from auth.users where id in ('$OWNER', '$EDITOR');" > /dev/null
  rm -rf "$WORK"
}
trap cleanup EXIT

# SQL de una sesión de usuario: guarda con una precondición y termina la
# transacción con commit o rollback tras una espera opcional.
# $1 usuario · $2 fecha (expresión SQL) · $3 nota · $4 precondición · $5 espera (s) · $6 commit|rollback
session_sql() {
  cat <<SQL
begin;
select set_config('request.jwt.claims', '{"sub":"$1","role":"authenticated"}', true);
set local role authenticated;
select 'saved:' || notes from public.save_daily_log(
  '$PET', $2, null, null, 3::smallint, null, null, null, null, false, null, '$3', '{}', $4);
select pg_sleep($5);
$6;
SQL
}

# Igual, pero espera en la línea de salida antes de empezar (casos 4 y 5).
gated_session_sql() {
  cat <<SQL
select pg_advisory_lock_shared($GATE);
select pg_advisory_unlock_shared($GATE);
$(session_sql "$@")
SQL
}

# Siembra el registro de ayer con una versión "leída hace una hora" y la devuelve.
seed_yesterday() {
  query "select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', false);
         delete from public.daily_logs where pet_id = '$PET';
         insert into public.daily_logs (pet_id, logged_by, log_date, mood_level, notes, created_at, updated_at)
         values ('$PET', '$OWNER', (now() at time zone 'UTC')::date - 1, 3, 'v0', now() - interval '1 hour', now() - interval '1 hour');" > /dev/null
  query "select updated_at from public.daily_logs where pet_id = '$PET'"
}

YESTERDAY="(now() at time zone 'UTC')::date - 1"
TODAY="(now() at time zone 'UTC')::date"
final() { query "select $1 from public.daily_logs where pet_id = '$PET' and log_date = $2"; }
rows() { query "select count(*) from public.daily_logs where pet_id = '$PET' and log_date = $1"; }
# Línea de salida de los casos 4 y 5: una sesión retiene el advisory lock y
# los escritores esperan en él; al soltarlo arrancan todos a la vez.
close_gate() {
  (echo "select pg_advisory_lock($GATE); select pg_sleep(60);" | run_psql kitom_cc_gate > /dev/null 2>&1) &
  wait_until "$(holding kitom_cc_gate)"
}
open_gate() {
  query "select pg_terminate_backend(pid) from pg_stat_activity where application_name = 'kitom_cc_gate'" > /dev/null
}
holding() { echo "select exists (select 1 from pg_stat_activity where application_name = '$1' and state = 'active' and query like '%pg_sleep%')"; }
blocked() { echo "select exists (select 1 from pg_stat_activity where application_name = '$1' and wait_event_type = 'Lock')"; }

# ---------------------------------------------------------------------
# Preparación
# ---------------------------------------------------------------------
if ! docker exec "$CONTAINER" true 2> /dev/null; then
  echo "No se encuentra el contenedor local '$CONTAINER'. Arranca Supabase local (npx supabase start)."
  exit 2
fi

cleanup_before="$(query "delete from public.pets where id = '$PET'; delete from auth.users where id in ('$OWNER', '$EDITOR');")"
setup="$(query "
  insert into auth.users (id, email, aud, role) values
    ('$OWNER',  'cc-owner@example.test',  'authenticated', 'authenticated'),
    ('$EDITOR', 'cc-editor@example.test', 'authenticated', 'authenticated');
  insert into public.pets (id, owner_id, name, species_id)
    select '$PET', '$OWNER', 'Concurrencia', s.id from public.species s where s.code = 'dog';
  insert into public.pet_co_owners (pet_id, user_id, invited_by, role, status, accepted_at)
    values ('$PET', '$EDITOR', '$OWNER', 'editor', 'accepted', now());
  select count(*) from public.pets where id = '$PET';")"
if [ "$setup" != "1" ]; then
  echo "No se pudieron crear los datos de prueba: $cleanup_before $setup"
  exit 2
fi

# ---------------------------------------------------------------------
# 1. Dos ediciones con la misma versión: la segunda espera y recibe conflicto
# ---------------------------------------------------------------------
V0="$(seed_yesterday)"
session_sql "$OWNER" "$YESTERDAY" 'A' "p_expected_updated_at => '$V0'" 4 commit | run_psql kitom_cc_a > "$WORK/1a" 2>&1 &
wait_until "$(holding kitom_cc_a)" || fail "1: la sesión A no llegó a escribir"
session_sql "$EDITOR" "$YESTERDAY" 'B' "p_expected_updated_at => '$V0'" 0 commit | run_psql kitom_cc_b > "$WORK/1b" 2>&1 &
if wait_until "$(blocked kitom_cc_b)"; then
  pass "1: B queda bloqueada por la escritura sin confirmar de A (solapamiento real)"
else
  fail "1: B no llegó a esperar el bloqueo de A"
fi
wait
check_contains "1: A (primera en escribir) guarda" "$WORK/1a" 'saved:A'
check_contains "1: B recibe hint daily_log_conflict" "$WORK/1b" 'daily_log_conflict'
check_contains "1: B recibe detail version_mismatch" "$WORK/1b" 'version_mismatch'
check "1: el registro conserva lo que guardó A" "$(final "notes || '/' || last_edited_by" "$YESTERDAY")" "A/$OWNER"
check "1: sigue habiendo una sola fila" "$(rows "$YESTERDAY")" "1"

# ---------------------------------------------------------------------
# 2. La primera hace ROLLBACK: la segunda se aplica (sin conflicto falso)
# ---------------------------------------------------------------------
V0="$(seed_yesterday)"
session_sql "$OWNER" "$YESTERDAY" 'A' "p_expected_updated_at => '$V0'" 4 rollback | run_psql kitom_cc_a > "$WORK/2a" 2>&1 &
wait_until "$(holding kitom_cc_a)" || fail "2: la sesión A no llegó a escribir"
session_sql "$EDITOR" "$YESTERDAY" 'B' "p_expected_updated_at => '$V0'" 0 commit | run_psql kitom_cc_b > "$WORK/2b" 2>&1 &
wait_until "$(blocked kitom_cc_b)" || fail "2: B no llegó a esperar el bloqueo de A"
wait
check_contains "2: B guarda cuando A deshace su escritura" "$WORK/2b" 'saved:B'
check "2: el registro tiene lo que guardó B" "$(final "notes || '/' || last_edited_by" "$YESTERDAY")" "B/$EDITOR"

# ---------------------------------------------------------------------
# 3. Dos creaciones con p_expect_absent: la segunda recibe conflicto
# ---------------------------------------------------------------------
query "delete from public.daily_logs where pet_id = '$PET'" > /dev/null
session_sql "$OWNER" "$TODAY" 'A' "p_expect_absent => true" 4 commit | run_psql kitom_cc_a > "$WORK/3a" 2>&1 &
wait_until "$(holding kitom_cc_a)" || fail "3: la sesión A no llegó a escribir"
session_sql "$EDITOR" "$TODAY" 'B' "p_expect_absent => true" 0 commit | run_psql kitom_cc_b > "$WORK/3b" 2>&1 &
if wait_until "$(blocked kitom_cc_b)"; then
  pass "3: B queda bloqueada por la creación sin confirmar de A (solapamiento real)"
else
  fail "3: B no llegó a esperar el bloqueo de A"
fi
wait
check_contains "3: A crea el registro" "$WORK/3a" 'saved:A'
check_contains "3: B recibe hint daily_log_conflict" "$WORK/3b" 'daily_log_conflict'
check_contains "3: B recibe detail row_exists" "$WORK/3b" 'row_exists'
check "3: el registro es el de A" "$(final "notes || '/' || logged_by" "$TODAY")" "A/$OWNER"
check "3: una sola fila para ese día" "$(rows "$TODAY")" "1"

# ---------------------------------------------------------------------
# 4. N ediciones a la vez con la misma versión: gana exactamente una
# ---------------------------------------------------------------------
V0="$(seed_yesterday)"
close_gate || fail "4: no se pudo cerrar la línea de salida"
for i in $(seq 1 "$WRITERS"); do
  user="$OWNER"; [ $((i % 2)) -eq 0 ] && user="$EDITOR"
  gated_session_sql "$user" "$YESTERDAY" "W$i" "p_expected_updated_at => '$V0'" 0 commit | run_psql "kitom_cc_w$i" > "$WORK/4_$i" 2>&1 &
done
wait_until "select count(*) = $WRITERS from pg_stat_activity where application_name like 'kitom_cc_w%' and wait_event_type = 'Lock'" \
  || fail "4: no todos los escritores llegaron a la línea de salida"
open_gate
wait
check "4: de $WRITERS ediciones simultáneas se aplica exactamente 1" "$(grep -l 'saved:W' "$WORK"/4_* | wc -l | tr -d ' ')" "1"
check "4: las otras $((WRITERS - 1)) reciben daily_log_conflict" "$(grep -l 'daily_log_conflict' "$WORK"/4_* | wc -l | tr -d ' ')" "$((WRITERS - 1))"
winner="$(cat "$WORK"/4_* | grep -o 'saved:W[0-9]*' | cut -d: -f2)"
check "4: el registro contiene lo que guardó la ganadora" "$(final notes "$YESTERDAY")" "$winner"

# ---------------------------------------------------------------------
# 5. N creaciones a la vez con p_expect_absent: gana exactamente una
# ---------------------------------------------------------------------
query "delete from public.daily_logs where pet_id = '$PET'" > /dev/null
close_gate || fail "5: no se pudo cerrar la línea de salida"
for i in $(seq 1 "$WRITERS"); do
  user="$OWNER"; [ $((i % 2)) -eq 0 ] && user="$EDITOR"
  gated_session_sql "$user" "$TODAY" "W$i" "p_expect_absent => true" 0 commit | run_psql "kitom_cc_w$i" > "$WORK/5_$i" 2>&1 &
done
wait_until "select count(*) = $WRITERS from pg_stat_activity where application_name like 'kitom_cc_w%' and wait_event_type = 'Lock'" \
  || fail "5: no todos los escritores llegaron a la línea de salida"
open_gate
wait
check "5: de $WRITERS creaciones simultáneas se aplica exactamente 1" "$(grep -l 'saved:W' "$WORK"/5_* | wc -l | tr -d ' ')" "1"
check "5: las otras $((WRITERS - 1)) reciben daily_log_conflict" "$(grep -l 'daily_log_conflict' "$WORK"/5_* | wc -l | tr -d ' ')" "$((WRITERS - 1))"
check "5: una sola fila para ese día" "$(rows "$TODAY")" "1"
winner="$(cat "$WORK"/5_* | grep -o 'saved:W[0-9]*' | cut -d: -f2)"
check "5: el registro es el de la ganadora" "$(final notes "$TODAY")" "$winner"

if [ "$FAILED" -eq 0 ]; then
  echo "Concurrencia de save_daily_log: todas las comprobaciones pasan."
else
  echo "Concurrencia de save_daily_log: hay comprobaciones fallidas."
fi
exit "$FAILED"
