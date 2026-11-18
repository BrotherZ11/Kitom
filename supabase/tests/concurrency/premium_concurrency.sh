#!/usr/bin/env bash
# =====================================================================
# KITOM · Concurrencia real del límite de mascotas del plan gratuito (migración 20261116160000)
# =====================================================================
# pgTAP corre en una transacción y no ve carreras: aquí, N sesiones a la vez.
#   1. Cuenta gratuita con 1 mascota y N altas simultáneas (claves distintas). El advisory lock
#      por usuario las serializa: exactamente 1 se crea (llega a 2) y las demás reciben
#      `pet_limit_reached`.
#   2. N reenvíos simultáneos de la misma alta (misma client_request_id) con el límite ya
#      cubierto por esa misma alta: ninguno recibe `pet_limit_reached`; todos dan 23505 (el motor
#      de la app los reconoce como «ya creada») y no se duplica nada.
#   3. Una cuenta Premium crea N a la vez: todas pasan.
#
# Solo local: `docker exec` sobre el contenedor de Supabase local, nunca una URL remota. Ids fijos que
# se borran al terminar (también si falla). Uso, desde la raíz del repo:
#   bash supabase/tests/concurrency/premium_concurrency.sh
# Requiere `npx supabase start` y los catálogos de supabase/seed.sql.
# =====================================================================
set -u

CONTAINER="${SUPABASE_DB_CONTAINER:-supabase_db_Kitom}"
WRITERS="${WRITERS:-8}"

FREE_USER='ce000000-0000-4000-8000-000000000001'
PREMIUM_USER='ce000000-0000-4000-8000-000000000002'
SAME_KEY='cf000000-0000-4000-8000-000000000001'
GATE=20261116 # advisory lock que hace de línea de salida

WORK="$(mktemp -d)"
FAILED=0

run_psql() {
  docker exec -i -e PGAPPNAME="$1" "$CONTAINER" psql -U postgres -d postgres -X -q -t -A -v ON_ERROR_STOP=1
}

query() { run_psql kitom_pp_main <<<"$1" 2>&1 | tr -d '\r'; }

pass() { echo "ok   - $1"; }
fail() { echo "FAIL - $1"; FAILED=1; }
check() { if [ "$2" = "$3" ]; then pass "$1"; else fail "$1 (esperado: '$3', obtenido: '$2')"; fi; }

wait_until() {
  for _ in $(seq 1 50); do
    [ "$(query "$1")" = "t" ] && return 0
    sleep 0.2
  done
  return 1
}

open_gate() {
  query "select pg_terminate_backend(pid) from pg_stat_activity where application_name = 'kitom_pp_gate'" > /dev/null
}
close_gate() {
  (echo "select pg_advisory_lock($GATE); select pg_sleep(60);" | run_psql kitom_pp_gate > /dev/null 2>&1) &
  wait_until "select exists (select 1 from pg_stat_activity where application_name = 'kitom_pp_gate' and state = 'active' and query like '%pg_sleep%')"
}

cleanup() {
  open_gate
  query "delete from public.pets where owner_id in ('$FREE_USER', '$PREMIUM_USER');
         delete from auth.users where id in ('$FREE_USER', '$PREMIUM_USER');" > /dev/null
  rm -rf "$WORK"
}
trap cleanup EXIT

# Cada sesión espera en la línea de salida y después crea una mascota como el usuario; el
# resultado se imprime como «result:ok», «result:hint:<hint>» o «result:state:<sqlstate>».
gated_insert() {
  local key="$2"
  cat <<SQL
select pg_advisory_lock_shared($GATE);
select pg_advisory_unlock_shared($GATE);
begin;
select set_config('request.jwt.claims', '{"sub":"$1","role":"authenticated"}', true);
set local role authenticated;
do \$\$
begin
  insert into public.pets (owner_id, name, species_id, client_request_id)
  select '$1', 'pp', id, '$key' from public.species where code = 'dog';
  raise notice 'result:ok';
exception when others then
  declare h text; st text;
  begin
    get stacked diagnostics h = pg_exception_hint, st = returned_sqlstate;
    if coalesce(h, '') <> '' then raise notice 'result:hint:%', h; else raise notice 'result:state:%', st; end if;
  end;
end \$\$;
commit;
SQL
}

count_in() { cat "$WORK"/"$1"_* 2>/dev/null | grep -c "$2"; }
pets_of() { query "select count(*) from public.pets where owner_id = '$1'"; }

# ---------------------------------------------------------------------
# Preparación
# ---------------------------------------------------------------------
if ! docker exec "$CONTAINER" true 2> /dev/null; then
  echo "No se encuentra el contenedor local '$CONTAINER'. Arranca Supabase local (npx supabase start)."
  exit 2
fi

query "delete from public.pets where owner_id in ('$FREE_USER', '$PREMIUM_USER');
       delete from auth.users where id in ('$FREE_USER', '$PREMIUM_USER');" > /dev/null
setup="$(query "
  insert into auth.users (id, email, aud, role, email_confirmed_at) values
    ('$FREE_USER',    'pp-c-free@example.test',    'authenticated', 'authenticated', now()),
    ('$PREMIUM_USER', 'pp-c-premium@example.test', 'authenticated', 'authenticated', now());
  update public.subscriptions set plan = 'premium', status = 'active', current_period_end = now() + interval '30 days'
    where user_id = '$PREMIUM_USER';
  insert into public.pets (owner_id, name, species_id)
    select '$FREE_USER', 'primera', id from public.species where code = 'dog';
  select count(*) from public.pets where owner_id = '$FREE_USER';")"
if [ "$setup" != "1" ]; then
  echo "No se pudieron crear los datos de prueba: $setup"
  exit 2
fi

uuid_for() { printf 'cf000000-0000-4000-8%03d-%012d' "$1" "$2"; }

# ---------------------------------------------------------------------
# 1. Cuenta gratuita con 1 mascota: N altas simultáneas
# ---------------------------------------------------------------------
close_gate || fail "1: no se pudo cerrar la línea de salida"
for i in $(seq 1 "$WRITERS"); do
  gated_insert "$FREE_USER" "$(uuid_for 1 "$i")" | run_psql "kitom_pp_a$i" > "$WORK/1_$i" 2>&1 &
done
wait_until "select count(*) = $WRITERS from pg_stat_activity where application_name like 'kitom_pp_a%' and wait_event_type = 'Lock'" \
  || fail "1: no todas las altas llegaron a la línea de salida"
open_gate
wait
check "1: de $WRITERS altas simultáneas se crea exactamente 1" "$(count_in 1 'result:ok')" "1"
check "1: las demás reciben pet_limit_reached" "$(count_in 1 'result:hint:pet_limit_reached')" "$((WRITERS - 1))"
check "1: la cuenta gratuita queda con 2 mascotas" "$(pets_of "$FREE_USER")" "2"

# ---------------------------------------------------------------------
# 2. Reenvíos simultáneos de un alta que ya existe
# ---------------------------------------------------------------------
query "update public.pets set client_request_id = '$SAME_KEY'
       where owner_id = '$FREE_USER' and client_request_id is not null;" > /dev/null
close_gate || fail "2: no se pudo cerrar la línea de salida"
for i in $(seq 1 "$WRITERS"); do
  gated_insert "$FREE_USER" "$SAME_KEY" | run_psql "kitom_pp_r$i" > "$WORK/2_$i" 2>&1 &
done
wait_until "select count(*) = $WRITERS from pg_stat_activity where application_name like 'kitom_pp_r%' and wait_event_type = 'Lock'" \
  || fail "2: no todos los reenvíos llegaron a la línea de salida"
open_gate
wait
check "2: ningún reenvío recibe pet_limit_reached" "$(count_in 2 'result:hint:pet_limit_reached')" "0"
check "2: todos reciben 23505 (ya creada)" "$(count_in 2 'result:state:23505')" "$WRITERS"
check "2: sigue con 2 mascotas" "$(pets_of "$FREE_USER")" "2"

# ---------------------------------------------------------------------
# 3. Premium: N altas simultáneas pasan todas
# ---------------------------------------------------------------------
close_gate || fail "3: no se pudo cerrar la línea de salida"
for i in $(seq 1 "$WRITERS"); do
  gated_insert "$PREMIUM_USER" "$(uuid_for 3 "$i")" | run_psql "kitom_pp_p$i" > "$WORK/3_$i" 2>&1 &
done
wait_until "select count(*) = $WRITERS from pg_stat_activity where application_name like 'kitom_pp_p%' and wait_event_type = 'Lock'" \
  || fail "3: no todas las altas llegaron a la línea de salida"
open_gate
wait
check "3: Premium crea las $WRITERS" "$(count_in 3 'result:ok')" "$WRITERS"
check "3: y tiene $WRITERS mascotas" "$(pets_of "$PREMIUM_USER")" "$WRITERS"

if [ "$FAILED" -eq 0 ]; then
  echo "Concurrencia del límite de mascotas: todas las comprobaciones pasan."
else
  echo "Concurrencia del límite de mascotas: hay comprobaciones fallidas."
fi
exit "$FAILED"
