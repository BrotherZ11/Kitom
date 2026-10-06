-- ============================================================
-- KITOM v2.2 · 16 · PET_STREAKS
-- CAMBIO vs v2.1 (punto 26): recompute_pet_streak() ahora también
-- otorga los logros basados en racha (first_log, streak_7, streak_30)
-- llamando a award_pet_achievement() (15) justo después de calcular
-- la racha nueva — es el único sitio donde current_streak recién
-- calculado está disponible, así que es el lugar natural para
-- comprobar los umbrales.
--
-- Reconfirmado sin cambios de fondo (punto 11):
--   - daily_logs sigue siendo la fuente de verdad; pet_streaks sigue
--     siendo caché/materialización reconstruible.
--   - longest_streak NUNCA disminuye aunque se borren logs: el
--     ON CONFLICT DO UPDATE usa greatest(valor_actual_guardado,
--     valor_recién_calculado) — ya era así en v2.1, se mantiene igual
--     a propósito porque es exactamente el comportamiento pedido.
--   - El advisory lock transaccional sigue serializando recálculos
--     concurrentes de la misma mascota.
--   - El "hoy" para decidir si la racha activa sigue viva se calcula
--     con la timezone del propietario principal, igual que en daily_logs.
-- ============================================================
create table public.pet_streaks (
  pet_id          uuid primary key references public.pets(id) on delete cascade,
  current_streak  int not null default 0,
  longest_streak  int not null default 0,
  last_log_date   date,
  updated_at      timestamptz not null default now()
);

alter table public.pet_streaks enable row level security;

create policy "pet_streaks: select members" on public.pet_streaks for select using (public.is_pet_member(pet_id));
-- Sin policy de insert/update/delete para 'authenticated': solo se
-- escribe desde recompute_pet_streak().

create or replace function public.recompute_pet_streak(target_pet_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  calc record;
  owner_tz text;
  owner_local_today date;
begin
  perform pg_advisory_xact_lock(hashtext(target_pet_id::text)::bigint);

  select p.timezone into owner_tz
  from public.pets pt
  join public.profiles p on p.id = pt.owner_id
  where pt.id = target_pet_id;

  owner_local_today := (now() at time zone coalesce(owner_tz, 'UTC'))::date;

  with dates as (
    select distinct log_date
    from public.daily_logs
    where pet_id = target_pet_id
  ),
  numbered as (
    select log_date, row_number() over (order by log_date desc) as rn
    from dates
  ),
  grouped as (
    select log_date, log_date + rn as grp
    from numbered
  ),
  all_runs as (
    select grp, count(*) as len, max(log_date) as run_end
    from grouped
    group by grp
  ),
  current_run as (
    select len from all_runs order by run_end desc limit 1
  )
  select
    coalesce((select len from current_run), 0) as current_len,
    coalesce((select max(len) from all_runs), 0) as longest_len,
    (select max(log_date) from dates) as last_date
  into calc;

  insert into public.pet_streaks (pet_id, current_streak, longest_streak, last_log_date, updated_at)
  values (
    target_pet_id,
    case when calc.last_date >= owner_local_today - 1 then calc.current_len else 0 end,
    calc.longest_len,
    calc.last_date,
    now()
  )
  on conflict (pet_id) do update
  set current_streak = excluded.current_streak,
      -- longest_streak nunca decrece: se conserva el máximo histórico
      -- aunque el recálculo actual dé un valor más bajo (p. ej. tras
      -- borrar logs antiguos).
      longest_streak  = greatest(public.pet_streaks.longest_streak, excluded.longest_streak),
      last_log_date   = excluded.last_log_date,
      updated_at      = now();

  if calc.current_len >= 1 then
    perform public.award_pet_achievement(target_pet_id, 'first_log');
  end if;
  if calc.current_len >= 7 then
    perform public.award_pet_achievement(target_pet_id, 'streak_7');
  end if;
  if calc.current_len >= 30 then
    perform public.award_pet_achievement(target_pet_id, 'streak_30');
  end if;
end;
$$;

revoke execute on function public.recompute_pet_streak(uuid) from public, anon, authenticated;

create or replace function public.trg_recompute_pet_streak_fn()
returns trigger as $$
begin
  if tg_op = 'DELETE' then
    perform public.recompute_pet_streak(old.pet_id);
    return old;
  else
    perform public.recompute_pet_streak(new.pet_id);
    return new;
  end if;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function public.trg_recompute_pet_streak_fn() from public, anon, authenticated;

create trigger trg_daily_logs_streak
after insert or update or delete on public.daily_logs
for each row execute procedure public.trg_recompute_pet_streak_fn();
