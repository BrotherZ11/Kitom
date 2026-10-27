#!/usr/bin/env bash
# =====================================================================
# KITOM · Concurrencia real de la eliminación de pets y de photo_path (fase 10)
# =====================================================================
# Sin cambios de esquema: es lo que hace el cliente con PostgREST.
#   Eliminación: `delete … eq('id', …).eq('updated_at', base)` (pet-writes-remote.ts).
#   Foto: `update set photo_path = nuevo … eq('photo_path', esperado)` o `is null` (pet-photos-remote.ts).
#
#   1. Una edición retiene la fila y un borrado con la misma versión leída espera: al confirmar la
#      edición, el borrado vuelve a evaluar el WHERE y borra 0 filas. La mascota conserva la edición.
#   2. Igual, pero la edición hace ROLLBACK: el borrado se aplica (sin conflictos falsos).
#   3. Un borrado retiene la fila y una edición con la misma versión espera: al confirmarse el borrado,
#      la edición actualiza 0 filas. La mascota no existe.
#   4. RLS: un co-tutor editor con la versión correcta borra 0 filas (`pets: delete owner`); el
#      propietario, 1.
#   5. N cambios de photo_path a la vez esperando «sin foto»: se aplica exactamente uno.
#   6. Dos sesiones del propietario borran a la vez con la misma versión (dos dispositivos, o un
#      reintento tras perder la respuesta): una borra y la otra espera y borra 0 filas, sin error.
#
# Solo local: `docker exec` sobre el contenedor de Supabase local, nunca una URL remota. Ids fijos que
# se borran al terminar (también si falla). Uso, desde la raíz del repo:
#   bash supabase/tests/concurrency/pets_delete_concurrency.sh
# Requiere `npx supabase start` y los catálogos de supabase/seed.sql.
# =====================================================================
set -u

CONTAINER="${SUPABASE_DB_CONTAINER:-supabase_db_Kitom}"
WRITERS="${WRITERS:-8}"

OWNER='c1000000-0000-4000-8000-000000000011'
EDITOR='c1000000-0000-4000-8000-000000000012'
PET='d1000000-0000-4000-8000-000000000011'
GATE=20261026 # advisory lock que hace de línea de salida en el caso 5

WORK="$(mktemp -d)"
FAILED=0

run_psql() {
  docker exec -i -e PGAPPNAME="$1" "$CONTAINER" psql -U postgres -d postgres -X -q -t -A -v ON_ERROR_STOP=1
}

query() { run_psql kitom_pd_main <<<"$1" 2>&1 | tr -d '\r'; }

pass() { echo "ok   - $1"; }
fail() { echo "FAIL - $1"; FAILED=1; }
check() { if [ "$2" = "$3" ]; then pass "$1"; else fail "$1 (esperado: '$3', obtenido: '$2')"; fi; }
check_contains() { if grep -q "$3" "$2"; then pass "$1"; else fail "$1 (no aparece '$3' en la salida: $(tr '\n' ' ' < "$2"))"; fi; }

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

as_user() {
  cat <<SQL
begin;
select set_config('request.jwt.claims', '{"sub":"$1","role":"authenticated"}', true);
set local role authenticated;
SQL
}

# Borrado con precondición. $1 usuario · $2 versión base · $3 espera (s) · $4 commit|rollback
delete_sql() {
  cat <<SQL
$(as_user "$1")
delete from public.pets where id = '$PET' and updated_at = '$2' returning 'deleted:' || id;
select pg_sleep($3);
$4;
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

# Cambio de foto con precondición «sin foto». $1 path
photo_sql() {
  cat <<SQL
$(as_user "$OWNER")
update public.pets set photo_path = '$1' where id = '$PET' and photo_path is null returning 'photo:' || photo_path;
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
  (echo "select pg_advisory_lock($GATE); select pg_sleep(60);" | run_psql kitom_pd_gate > /dev/null 2>&1) &
  wait_until "$(holding kitom_pd_gate)"
}
open_gate() {
  query "select pg_terminate_backend(pid) from pg_stat_activity where application_name = 'kitom_pd_gate'" > /dev/null
}
holding() { echo "select exists (select 1 from pg_stat_activity where application_name = '$1' and state = 'active' and query like '%pg_sleep%')"; }
blocked() { echo "select exists (select 1 from pg_stat_activity where application_name = '$1' and wait_event_type = 'Lock')"; }

pet_exists() { query "select count(*) from public.pets where id = '$PET'"; }
name_of_pet() { query "select name from public.pets where id = '$PET'"; }

# Siembra la mascota (con un co-tutor editor) y devuelve su versión.
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

cleanup_before="$(query "delete from public.pets where owner_id = '$OWNER'; delete from auth.users where id in ('$OWNER', '$EDITOR');")"
setup="$(query "
  insert into auth.users (id, email, aud, role) values
    ('$OWNER',  'pd-owner@example.test',  'authenticated', 'authenticated'),
    ('$EDITOR', 'pd-editor@example.test', 'authenticated', 'authenticated');
  select count(*) from auth.users where id in ('$OWNER', '$EDITOR');")"
if [ "$setup" != "2" ]; then
  echo "No se pudieron crear los datos de prueba: $cleanup_before $setup"
  exit 2
fi

# ---------------------------------------------------------------------
# 1. Edición en curso: el borrado con la versión leída espera y borra 0 filas
# ---------------------------------------------------------------------
BASE="$(seed_pet)"
update_sql "$EDITOR" "E1" "$BASE" 2 commit | run_psql kitom_pd_a > "$WORK/1_a" 2>&1 &
wait_until "$(holding kitom_pd_a)" || fail "1: la edición no llegó a retener la fila"
delete_sql "$OWNER" "$BASE" 0 commit | run_psql kitom_pd_b > "$WORK/1_b" 2>&1 &
wait_until "$(blocked kitom_pd_b)" && pass "1: el borrado espera a la edición" || fail "1: el borrado no llegó a bloquearse"
wait
check_contains "1: la edición se aplica" "$WORK/1_a" "updated:E1"
check "1: el borrado borra 0 filas (la versión ya no es la leída)" "$(grep -c 'deleted:' "$WORK/1_b")" "0"
check "1: la mascota sigue, con la edición" "$(name_of_pet)" "E1"

# ---------------------------------------------------------------------
# 2. La edición hace ROLLBACK: el borrado se aplica
# ---------------------------------------------------------------------
BASE="$(seed_pet)"
update_sql "$EDITOR" "E2" "$BASE" 2 rollback | run_psql kitom_pd_a > "$WORK/2_a" 2>&1 &
wait_until "$(holding kitom_pd_a)" || fail "2: la edición no llegó a retener la fila"
delete_sql "$OWNER" "$BASE" 0 commit | run_psql kitom_pd_b > "$WORK/2_b" 2>&1 &
wait_until "$(blocked kitom_pd_b)" || fail "2: el borrado no llegó a bloquearse"
wait
check_contains "2: tras el ROLLBACK, el borrado se aplica" "$WORK/2_b" "deleted:"
check "2: la mascota ya no existe" "$(pet_exists)" "0"

# ---------------------------------------------------------------------
# 3. Borrado en curso: la edición con la misma versión espera y actualiza 0 filas
# ---------------------------------------------------------------------
BASE="$(seed_pet)"
delete_sql "$OWNER" "$BASE" 2 commit | run_psql kitom_pd_a > "$WORK/3_a" 2>&1 &
wait_until "$(holding kitom_pd_a)" || fail "3: el borrado no llegó a retener la fila"
update_sql "$EDITOR" "E3" "$BASE" 0 commit | run_psql kitom_pd_b > "$WORK/3_b" 2>&1 &
wait_until "$(blocked kitom_pd_b)" && pass "3: la edición espera al borrado" || fail "3: la edición no llegó a bloquearse"
wait
check_contains "3: el borrado se aplica" "$WORK/3_a" "deleted:"
check "3: la edición actualiza 0 filas" "$(grep -c 'updated:' "$WORK/3_b")" "0"
check "3: la mascota no existe" "$(pet_exists)" "0"

# ---------------------------------------------------------------------
# 4. RLS: el co-tutor editor no borra; el propietario sí
# ---------------------------------------------------------------------
BASE="$(seed_pet)"
delete_sql "$EDITOR" "$BASE" 0 commit | run_psql kitom_pd_a > "$WORK/4_a" 2>&1
check "4: el co-tutor editor borra 0 filas" "$(grep -c 'deleted:' "$WORK/4_a")" "0"
check "4: la mascota sigue" "$(pet_exists)" "1"
delete_sql "$OWNER" "$BASE" 0 commit | run_psql kitom_pd_a > "$WORK/4_b" 2>&1
check_contains "4: el propietario la borra" "$WORK/4_b" "deleted:"

# ---------------------------------------------------------------------
# 5. N cambios de foto a la vez esperando «sin foto»: se aplica exactamente uno
# ---------------------------------------------------------------------
seed_pet > /dev/null
close_gate || fail "5: no se pudo cerrar la línea de salida"
for i in $(seq 1 "$WRITERS"); do
  photo_sql "$PET/p$i.jpg" | gated | run_psql "kitom_pd_w$i" > "$WORK/5_$i" 2>&1 &
done
wait_until "select count(*) = $WRITERS from pg_stat_activity where application_name like 'kitom_pd_w%' and wait_event_type = 'Lock'" \
  || fail "5: no todos los escritores llegaron a la línea de salida"
open_gate
wait
check "5: de $WRITERS cambios de foto simultáneos se aplica exactamente 1" "$(grep -l 'photo:' "$WORK"/5_* | wc -l | tr -d ' ')" "1"
winner="$(cat "$WORK"/5_* | grep -o 'photo:[^ ]*' | cut -d: -f2)"
check "5: photo_path es el del ganador" "$(query "select photo_path from public.pets where id = '$PET'")" "$winner"

# ---------------------------------------------------------------------
# 6. Dos borrados simultáneos del propietario con la misma versión
# ---------------------------------------------------------------------
BASE="$(seed_pet)"
delete_sql "$OWNER" "$BASE" 2 commit | run_psql kitom_pd_a > "$WORK/6_a" 2>&1 &
wait_until "$(holding kitom_pd_a)" || fail "6: el primer borrado no llegó a retener la fila"
delete_sql "$OWNER" "$BASE" 0 commit | run_psql kitom_pd_b > "$WORK/6_b" 2>&1 &
wait_until "$(blocked kitom_pd_b)" && pass "6: el segundo borrado espera al primero" || fail "6: el segundo borrado no llegó a bloquearse"
wait
check_contains "6: el primero borra" "$WORK/6_a" "deleted:"
check "6: el segundo borra 0 filas" "$(grep -c 'deleted:' "$WORK/6_b")" "0"
check "6: el segundo no da error" "$(grep -ci 'error' "$WORK/6_b")" "0"
check "6: la mascota no existe" "$(pet_exists)" "0"

if [ "$FAILED" -eq 0 ]; then
  echo "Concurrencia de la eliminación de pets: todas las comprobaciones pasan."
else
  echo "Concurrencia de la eliminación de pets: hay comprobaciones fallidas."
fi
exit "$FAILED"
