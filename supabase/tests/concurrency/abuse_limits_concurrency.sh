#!/usr/bin/env bash
# =====================================================================
# KITOM · Concurrencia real de los límites de abuso (migración 20261030090318)
# =====================================================================
# pgTAP corre en una transacción y no ve carreras: aquí, N sesiones a la vez.
#   1. IA: N solicitudes simultáneas del mismo usuario (premium, sin cupo mensual que
#      interfiera). El advisory lock por usuario las serializa: exactamente 1 se crea y las
#      demás reciben `ai_rate_limited`; el registro tiene 1 fila.
#   2. Invitaciones: propietario con 19 intentos en las últimas 24 h y N invitaciones
#      simultáneas (emails sin cuenta). Exactamente 1 pasa (la 20.ª) y las demás reciben
#      `invite_rate_limited`; el registro queda en 20.
#   3. Otro usuario no espera al bloqueo del primero (el bloqueo es por usuario).
#
# Solo local: `docker exec` sobre el contenedor de Supabase local, nunca una URL remota. Ids fijos que
# se borran al terminar (también si falla). Uso, desde la raíz del repo:
#   bash supabase/tests/concurrency/abuse_limits_concurrency.sh
# Requiere `npx supabase start` y los catálogos de supabase/seed.sql.
# =====================================================================
set -u

CONTAINER="${SUPABASE_DB_CONTAINER:-supabase_db_Kitom}"
WRITERS="${WRITERS:-8}"

AI_USER='c7000000-0000-4000-8000-000000000001'
OWNER='c7000000-0000-4000-8000-000000000002'
OTHER='c7000000-0000-4000-8000-000000000003'
AI_PET='d7000000-0000-4000-8000-000000000001'
OWNER_PET='d7000000-0000-4000-8000-000000000002'
OTHER_PET='d7000000-0000-4000-8000-000000000003'
GATE=20261030 # advisory lock que hace de línea de salida

WORK="$(mktemp -d)"
FAILED=0

run_psql() {
  docker exec -i -e PGAPPNAME="$1" "$CONTAINER" psql -U postgres -d postgres -X -q -t -A -v ON_ERROR_STOP=1
}

query() { run_psql kitom_al_main <<<"$1" 2>&1 | tr -d '\r'; }

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
  query "select pg_terminate_backend(pid) from pg_stat_activity where application_name = 'kitom_al_gate'" > /dev/null
}
close_gate() {
  (echo "select pg_advisory_lock($GATE); select pg_sleep(60);" | run_psql kitom_al_gate > /dev/null 2>&1) &
  wait_until "select exists (select 1 from pg_stat_activity where application_name = 'kitom_al_gate' and state = 'active' and query like '%pg_sleep%')"
}

cleanup() {
  open_gate
  query "delete from public.pets where owner_id in ('$AI_USER', '$OWNER', '$OTHER');
         delete from auth.users where id in ('$AI_USER', '$OWNER', '$OTHER');" > /dev/null
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

# Cada sesión espera en la línea de salida y después hace su llamada; el error se
# imprime como «hint:<hint>» para poder contarlo.
gated_call() {
  cat <<SQL
select pg_advisory_lock_shared($GATE);
select pg_advisory_unlock_shared($GATE);
$(as_user "$1")
do \$\$
begin
  $2;
  raise notice 'result:ok';
exception when others then
  declare h text;
  begin
    get stacked diagnostics h = pg_exception_hint;
    raise notice 'result:hint:%', h;
  end;
end \$\$;
commit;
SQL
}

count_in() { cat "$WORK"/"$1"_* 2>/dev/null | grep -c "$2"; }

# ---------------------------------------------------------------------
# Preparación
# ---------------------------------------------------------------------
if ! docker exec "$CONTAINER" true 2> /dev/null; then
  echo "No se encuentra el contenedor local '$CONTAINER'. Arranca Supabase local (npx supabase start)."
  exit 2
fi

query "delete from public.pets where owner_id in ('$AI_USER', '$OWNER', '$OTHER');
       delete from auth.users where id in ('$AI_USER', '$OWNER', '$OTHER');" > /dev/null
setup="$(query "
  insert into auth.users (id, email, aud, role, email_confirmed_at) values
    ('$AI_USER', 'al-ai@example.test',    'authenticated', 'authenticated', now()),
    ('$OWNER',   'al-owner@example.test', 'authenticated', 'authenticated', now()),
    ('$OTHER',   'al-other@example.test', 'authenticated', 'authenticated', now());
  update public.profiles set disclaimer_accepted_at = now(), disclaimer_version = '1.0'
    where id in ('$AI_USER', '$OTHER');
  update public.subscriptions set plan = 'premium' where user_id in ('$AI_USER', '$OTHER');
  insert into public.pets (id, owner_id, name, species_id)
    select v.id, v.owner_id, 'al', s.id
    from (values ('$AI_PET'::uuid, '$AI_USER'::uuid), ('$OWNER_PET'::uuid, '$OWNER'::uuid), ('$OTHER_PET'::uuid, '$OTHER'::uuid)) as v (id, owner_id)
    cross join public.species s where s.code = 'dog';
  select count(*) from public.pets where owner_id in ('$AI_USER', '$OWNER', '$OTHER');")"
if [ "$setup" != "3" ]; then
  echo "No se pudieron crear los datos de prueba: $setup"
  exit 2
fi

# ---------------------------------------------------------------------
# 1. N solicitudes de IA simultáneas del mismo usuario
# ---------------------------------------------------------------------
close_gate || fail "1: no se pudo cerrar la línea de salida"
for i in $(seq 1 "$WRITERS"); do
  gated_call "$AI_USER" "perform public.request_ai_analysis('$AI_PET', null)" | run_psql "kitom_al_a$i" > "$WORK/1_$i" 2>&1 &
done
wait_until "select count(*) = $WRITERS from pg_stat_activity where application_name like 'kitom_al_a%' and wait_event_type = 'Lock'" \
  || fail "1: no todas las solicitudes llegaron a la línea de salida"
open_gate
wait
check "1: de $WRITERS solicitudes simultáneas se crea exactamente 1" "$(count_in 1 'result:ok')" "1"
check "1: las demás reciben ai_rate_limited" "$(count_in 1 'result:hint:ai_rate_limited')" "$((WRITERS - 1))"
check "1: el registro de uso tiene 1 fila" \
  "$(query "select count(*) from private.ai_analysis_usage where user_id = '$AI_USER'")" "1"
check "1: y hay 1 solicitud" \
  "$(query "select count(*) from public.ai_analysis_requests where requested_by = '$AI_USER'")" "1"

# ---------------------------------------------------------------------
# 2. N invitaciones simultáneas con 19 intentos previos
# ---------------------------------------------------------------------
query "insert into private.pet_invitation_attempts (inviter_id, created_at)
       select '$OWNER', now() - interval '1 hour' from generate_series(1, 19);" > /dev/null
close_gate || fail "2: no se pudo cerrar la línea de salida"
for i in $(seq 1 "$WRITERS"); do
  gated_call "$OWNER" "perform public.invite_pet_member_by_email('$OWNER_PET', 'al-nadie-$i@example.test')" \
    | run_psql "kitom_al_i$i" > "$WORK/2_$i" 2>&1 &
done
wait_until "select count(*) = $WRITERS from pg_stat_activity where application_name like 'kitom_al_i%' and wait_event_type = 'Lock'" \
  || fail "2: no todas las invitaciones llegaron a la línea de salida"
open_gate
wait
check "2: de $WRITERS invitaciones simultáneas pasa exactamente 1 (la 20.ª)" "$(count_in 2 'result:ok')" "1"
check "2: las demás reciben invite_rate_limited" "$(count_in 2 'result:hint:invite_rate_limited')" "$((WRITERS - 1))"
check "2: el registro queda en 20 intentos" \
  "$(query "select count(*) from private.pet_invitation_attempts where inviter_id = '$OWNER'")" "20"

# ---------------------------------------------------------------------
# 3. El bloqueo es por usuario: otro usuario no espera
# ---------------------------------------------------------------------
cat <<SQL | run_psql kitom_al_hold > "$WORK/3_hold" 2>&1 &
$(as_user "$AI_USER")
select pg_advisory_xact_lock(hashtext('ai_quota:' || '$AI_USER')::bigint);
select pg_sleep(3);
commit;
SQL
wait_until "select exists (select 1 from pg_stat_activity where application_name = 'kitom_al_hold' and query like '%pg_sleep%')" \
  || fail "3: no se llegó a retener el bloqueo del primer usuario"
start=$(date +%s)
# La línea de salida ya está abierta: la llamada pasa directa.
gated_call "$OTHER" "perform public.request_ai_analysis('$OTHER_PET', null)" | run_psql kitom_al_other > "$WORK/3_other" 2>&1
elapsed=$(( $(date +%s) - start ))
wait
check "3: otro usuario pide mientras el primero retiene su bloqueo" "$(grep -c 'result:ok' "$WORK/3_other")" "1"
if [ "$elapsed" -lt 3 ]; then pass "3: sin esperar al bloqueo ajeno (${elapsed} s)"; else fail "3: esperó ${elapsed} s al bloqueo de otro usuario"; fi

if [ "$FAILED" -eq 0 ]; then
  echo "Concurrencia de los límites de abuso: todas las comprobaciones pasan."
else
  echo "Concurrencia de los límites de abuso: hay comprobaciones fallidas."
fi
exit "$FAILED"
