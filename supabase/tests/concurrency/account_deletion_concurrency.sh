#!/usr/bin/env bash
# =====================================================================
# KITOM · Borrar una cuenta mientras otras sesiones escriben
# =====================================================================
# pgTAP (supabase/tests/database/account_deletion_audit.test.sql) corre en una sola
# transacción y no puede demostrar qué pasa con filas ya confirmadas ni con dos
# sesiones a la vez. Esta prueba abre sesiones de psql distintas contra la BD LOCAL.
# El borrado va como lo hace Auth: conectado como supabase_auth_admin y sin JWT.
#
#   1. Borrado en curso y una co-tutora edita un recordatorio de esa cuenta: espera
#      y su edición se aplica sobre la fila ya sin autor.
#   2. Edición en curso y borrado: el borrado espera y conserva la edición.
#   3. Borrado en curso que acaba en ROLLBACK (Auth falla): no queda nada cambiado.
#   4. La cuenta crea un recordatorio mientras se borra: espera y falla con 23503.
#      No queda ninguna fila que apunte a una cuenta inexistente.
#   5. La cuenta crea un recordatorio y se borra mientras tanto: el borrado espera
#      y el recordatorio se queda sin autor.
#   6. Registro diario con autor y última edición de la misma cuenta (fila confirmada,
#      las dos FK sobre la misma fila): sobrevive con las dos a NULL.
#   7. Edición del registro con precondición (versión leída antes del borrado): 0 filas.
#      El cambio de updated_at del borrado se ve como un cambio remoto, no se pisa.
#
# Solo local: usa `docker exec` sobre el contenedor de Supabase local, nunca una URL
# remota. Escribe datos de prueba con ids fijos y los borra al terminar (también si
# falla). Uso, desde la raíz del repo:
#   bash supabase/tests/concurrency/account_deletion_concurrency.sh
# Requiere `npx supabase start`, la migración aplicada y los catálogos de supabase/seed.sql.
# =====================================================================
set -u

CONTAINER="${SUPABASE_DB_CONTAINER:-supabase_db_Kitom}"

OWNER='c1000000-0000-4000-8000-000000000031'
EDITOR='c1000000-0000-4000-8000-000000000032'
LEAVER='c1000000-0000-4000-8000-000000000033'
PET='d1000000-0000-4000-8000-000000000031'
REMINDER='d2000000-0000-4000-8000-000000000031'
NEW_REMINDER='d2000000-0000-4000-8000-000000000032'
LOG='d3000000-0000-4000-8000-000000000031'

WORK="$(mktemp -d)"
FAILED=0

# psql dentro del contenedor local. $1 = application_name (para pg_stat_activity).
run_psql() {
  docker exec -i -e PGAPPNAME="$1" "$CONTAINER" psql -U postgres -d postgres -X -q -t -A -v ON_ERROR_STOP=1
}

# Sesión de Auth: el mismo rol con el que conecta GoTrue (session_user real; contraseña por defecto del stack local).
run_psql_auth() {
  docker exec -i -e PGAPPNAME="$1" -e PGPASSWORD=postgres "$CONTAINER" psql -h 127.0.0.1 -U supabase_auth_admin -d postgres -X -q -t -A -v ON_ERROR_STOP=1
}

query() { run_psql kitom_ad_main <<<"$1" 2>&1 | tr -d '\r'; }

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

holding() { echo "select exists (select 1 from pg_stat_activity where application_name = '$1' and state = 'active' and query like '%pg_sleep%')"; }
blocked() { echo "select exists (select 1 from pg_stat_activity where application_name = '$1' and wait_event_type = 'Lock')"; }

clean_all() {
  query "delete from public.pets where id = '$PET';
         delete from auth.users where id in ('$OWNER', '$EDITOR', '$LEAVER');" > /dev/null
}

cleanup() {
  clean_all
  rm -rf "$WORK"
}
trap cleanup EXIT

# Datos: mascota de OWNER; EDITOR y LEAVER son editoras. REMINDER es de LEAVER y
# LOG lo creó y lo editó LEAVER. Todo confirmado, con versión de hace una hora.
seed() {
  clean_all
  query "
    insert into auth.users (id, email, aud, role) values
      ('$OWNER',  'ad-owner@example.test',  'authenticated', 'authenticated'),
      ('$EDITOR', 'ad-editor@example.test', 'authenticated', 'authenticated'),
      ('$LEAVER', 'ad-leaver@example.test', 'authenticated', 'authenticated');
    insert into public.pets (id, owner_id, name, species_id)
      select '$PET', '$OWNER', 'Kika', s.id from public.species s where s.code = 'dog';
    insert into public.pet_co_owners (pet_id, user_id, invited_by, role, status, accepted_at) values
      ('$PET', '$EDITOR', '$OWNER', 'editor', 'accepted', now()),
      ('$PET', '$LEAVER', '$OWNER', 'editor', 'accepted', now());
    insert into public.reminders (id, pet_id, created_by, type, title, due_at, created_at, updated_at)
      values ('$REMINDER', '$PET', '$LEAVER', 'medication', 'v0', now() + interval '1 day', now() - interval '1 hour', now() - interval '1 hour');
    insert into public.daily_logs (id, pet_id, logged_by, last_edited_by, log_date, mood_level, notes, created_at, updated_at)
      values ('$LOG', '$PET', '$LEAVER', '$LEAVER', current_date, 3, 'v0', now() - interval '1 hour', now() - interval '1 hour');
    select count(*) from public.reminders where id = '$REMINDER';" | tail -1
}

# Sesión de usuario (como PostgREST: claims + rol authenticated).
as_user() {
  cat <<SQL
begin;
select set_config('request.jwt.claims', '{"sub":"$1","role":"authenticated"}', true);
set local role authenticated;
SQL
}

# Borrado como el de Auth. $1 espera (s) antes de terminar · $2 commit|rollback
delete_account_sql() {
  cat <<SQL
begin;
delete from auth.users where id = '$LEAVER' returning 'account_deleted';
select pg_sleep($1);
$2;
SQL
}

# Edición sin precondición. $1 usuario · $2 título · $3 espera (s)
edit_sql() {
  cat <<SQL
$(as_user "$1")
update public.reminders set title = '$2' where id = '$REMINDER' returning 'edited:' || title;
select pg_sleep($3);
commit;
SQL
}

# Alta de la propia cuenta que se borra. $1 espera (s)
create_sql() {
  cat <<SQL
$(as_user "$LEAVER")
insert into public.reminders (pet_id, created_by, type, title, due_at)
  values ('$PET', '$LEAVER', 'bath', 'nuevo', now() + interval '1 day') returning 'created:' || title;
select pg_sleep($1);
commit;
SQL
}

creator_of() { query "select coalesce(created_by::text, 'NULL') from public.reminders where id = '$REMINDER'"; }
title_of() { query "select title from public.reminders where id = '$REMINDER'"; }
accounts() { query "select count(*) from auth.users where id = '$LEAVER'"; }

# ---------------------------------------------------------------------
# Preparación
# ---------------------------------------------------------------------
if ! docker exec "$CONTAINER" true 2> /dev/null; then
  echo "No se encuentra el contenedor local '$CONTAINER'. Arranca Supabase local (npx supabase start)."
  exit 2
fi
if [ "$(seed)" != "1" ]; then
  echo "No se pudieron crear los datos de prueba."
  exit 2
fi

# ---------------------------------------------------------------------
# 1. Borrado en curso: la edición espera y se aplica sobre la fila sin autor
# ---------------------------------------------------------------------
delete_account_sql 2 commit | run_psql_auth kitom_ad_a > "$WORK/1_a" 2>&1 &
wait_until "$(holding kitom_ad_a)" || fail "1: el borrado no llegó a retener la fila"
edit_sql "$EDITOR" "E1" 0 | run_psql kitom_ad_b > "$WORK/1_b" 2>&1 &
wait_until "$(blocked kitom_ad_b)" && pass "1: la edición espera al borrado" || fail "1: la edición no llegó a bloquearse"
wait
check_contains "1: el borrado termina" "$WORK/1_a" "account_deleted"
check_contains "1: la edición se aplica" "$WORK/1_b" "edited:E1"
check "1: el recordatorio tiene la edición" "$(title_of)" "E1"
check "1: y queda sin autor" "$(creator_of)" "NULL"
check "1: la cuenta ya no existe" "$(accounts)" "0"

# ---------------------------------------------------------------------
# 2. Edición en curso: el borrado espera y la conserva
# ---------------------------------------------------------------------
seed > /dev/null
edit_sql "$EDITOR" "E2" 2 | run_psql kitom_ad_a > "$WORK/2_a" 2>&1 &
wait_until "$(holding kitom_ad_a)" || fail "2: la edición no llegó a retener la fila"
delete_account_sql 0 commit | run_psql_auth kitom_ad_b > "$WORK/2_b" 2>&1 &
wait_until "$(blocked kitom_ad_b)" && pass "2: el borrado espera a la edición" || fail "2: el borrado no llegó a bloquearse"
wait
check_contains "2: el borrado termina" "$WORK/2_b" "account_deleted"
check "2: la edición se conserva" "$(title_of)" "E2"
check "2: y queda sin autor" "$(creator_of)" "NULL"

# ---------------------------------------------------------------------
# 3. El borrado falla (ROLLBACK): la fila sigue con su autor
# ---------------------------------------------------------------------
seed > /dev/null
delete_account_sql 2 rollback | run_psql_auth kitom_ad_a > "$WORK/3_a" 2>&1 &
wait_until "$(holding kitom_ad_a)" || fail "3: el borrado no llegó a retener la fila"
edit_sql "$EDITOR" "E3" 0 | run_psql kitom_ad_b > "$WORK/3_b" 2>&1 &
wait_until "$(blocked kitom_ad_b)" || fail "3: la edición no llegó a bloquearse"
wait
check "3: el recordatorio conserva a su autora" "$(creator_of)" "$LEAVER"
check "3: la edición se aplica" "$(title_of)" "E3"
check "3: la cuenta sigue" "$(accounts)" "1"
check "3: sigue de co-tutora" "$(query "select count(*) from public.pet_co_owners where user_id = '$LEAVER'")" "1"
check "3: el registro conserva autor y editora" "$(query "select (logged_by = '$LEAVER' and last_edited_by = '$LEAVER')::text from public.daily_logs where id = '$LOG'")" "true"

# ---------------------------------------------------------------------
# 4. Alta de la cuenta durante el borrado: espera y falla, sin huérfanos
# ---------------------------------------------------------------------
seed > /dev/null
delete_account_sql 2 commit | run_psql_auth kitom_ad_a > "$WORK/4_a" 2>&1 &
wait_until "$(holding kitom_ad_a)" || fail "4: el borrado no llegó a retener el perfil"
create_sql 0 | run_psql kitom_ad_b > "$WORK/4_b" 2>&1 &
wait
check_contains "4: el borrado termina" "$WORK/4_a" "account_deleted"
if grep -q "created:" "$WORK/4_b"; then fail "4: el alta no debió crearse: $(tr '\n' ' ' < "$WORK/4_b")"; else pass "4: el alta no se crea"; fi
check "4: no queda ninguna fila con esa cuenta" "$(query "select count(*) from public.reminders where created_by = '$LEAVER'")" "0"
check "4: y ninguna sin autor aparte de la original" "$(query "select count(*) from public.reminders where pet_id = '$PET' and title = 'nuevo'")" "0"

# ---------------------------------------------------------------------
# 5. Alta en curso: el borrado espera y el recordatorio se queda sin autor
# ---------------------------------------------------------------------
seed > /dev/null
create_sql 2 | run_psql kitom_ad_a > "$WORK/5_a" 2>&1 &
wait_until "$(holding kitom_ad_a)" || fail "5: el alta no llegó a retener el perfil"
delete_account_sql 0 commit | run_psql_auth kitom_ad_b > "$WORK/5_b" 2>&1 &
wait_until "$(blocked kitom_ad_b)" && pass "5: el borrado espera al alta" || fail "5: el borrado no llegó a bloquearse"
wait
check_contains "5: el alta se confirma" "$WORK/5_a" "created:nuevo"
check_contains "5: el borrado termina" "$WORK/5_b" "account_deleted"
check "5: el recordatorio nuevo se queda sin autor" "$(query "select count(*) from public.reminders where pet_id = '$PET' and title = 'nuevo' and created_by is null")" "1"

# ---------------------------------------------------------------------
# 6. Las dos FK de daily_logs sobre la misma fila confirmada
# ---------------------------------------------------------------------
seed > /dev/null
delete_account_sql 0 commit | run_psql_auth kitom_ad_a > "$WORK/6_a" 2>&1
check_contains "6: el borrado termina" "$WORK/6_a" "account_deleted"
check "6: el registro sobrevive con autor y editora a NULL" "$(query "select count(*) from public.daily_logs where id = '$LOG' and logged_by is null and last_edited_by is null and notes = 'v0'")" "1"

# ---------------------------------------------------------------------
# 7. Una edición con la versión anterior al borrado no pisa nada
# ---------------------------------------------------------------------
seed > /dev/null
BASE="$(query "select updated_at from public.reminders where id = '$REMINDER'")"
delete_account_sql 0 commit | run_psql_auth kitom_ad_a > "$WORK/7_a" 2>&1
cat <<SQL | run_psql kitom_ad_b > "$WORK/7_b" 2>&1
$(as_user "$EDITOR")
update public.reminders set title = 'E7' where id = '$REMINDER' and updated_at = '$BASE' returning 'edited:' || title;
commit;
SQL
check "7: la edición con la versión anterior actualiza 0 filas" "$(grep -c 'edited:' "$WORK/7_b")" "0"
check "7: el recordatorio no cambia" "$(title_of)" "v0"

if [ "$FAILED" -eq 0 ]; then
  echo "Borrado de cuentas en concurrencia: todas las comprobaciones pasan."
else
  echo "Borrado de cuentas en concurrencia: hay comprobaciones fallidas."
fi
exit "$FAILED"
