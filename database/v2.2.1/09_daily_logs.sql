-- ============================================================
-- KITOM v2.2 · 09 · DAILY_LOGS
-- CAMBIO vs v2.1 (consistencia con el punto 33/35 — mínimo privilegio):
-- se añade GRANT por columna para reforzar, además del trigger ya
-- existente, que pet_id/logged_by/created_at son inmutables. Mismo
-- razonamiento que se aplicó a pets.owner_id: dos capas
-- independientes, no solo el trigger.
--
-- TIMEZONE (punto 10, sin cambios de fondo vs v2.1, reafirmado):
-- log_date representa el día LOCAL usando la zona horaria del
-- PROPIETARIO PRINCIPAL de la mascota (pets.owner_id -> profiles.
-- timezone) — nunca la del dispositivo que escribe. Con mascotas
-- compartidas entre tutores de distintos husos horarios, hay un único
-- calendario por mascota, no uno por persona. El cliente calcula y
-- envía el log_date correcto; el servidor solo VALIDA que no sea
-- futuro respecto al "hoy" del propietario — no lo corrige él mismo.
-- Offline-first: un registro de un día PASADO que llega tarde por
-- estar offline sigue siendo válido; el bloqueo es solo hacia el futuro.
-- ============================================================
create table public.daily_logs (
  id                        uuid primary key default gen_random_uuid(),
  pet_id                    uuid not null references public.pets(id) on delete cascade,
  logged_by                 uuid references public.profiles(id) on delete set null,
  last_edited_by            uuid references public.profiles(id) on delete set null,
  log_date                  date not null,
  energy_level              smallint check (energy_level between 1 and 5),
  appetite_level            smallint check (appetite_level between 1 and 5),
  mood_level                smallint check (mood_level between 1 and 5),
  activity_level            smallint check (activity_level between 1 and 5),
  sleep_quality             smallint check (sleep_quality between 1 and 5),
  vocalization_level        smallint check (vocalization_level between 1 and 5),
  social_interaction_level  smallint check (social_interaction_level between 1 and 5),
  unusual_behavior          boolean not null default false,
  unusual_behavior_notes    text,
  notes                     text,
  tags                      text[] default '{}',
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (pet_id, log_date)
);

create index idx_daily_logs_pet_date  on public.daily_logs(pet_id, log_date desc);
create index idx_daily_logs_logged_by on public.daily_logs(logged_by);

create trigger set_timestamp_daily_logs
before update on public.daily_logs
for each row execute procedure public.trigger_set_timestamp();

create or replace function public.set_last_edited_by()
returns trigger as $$
begin
  new.last_edited_by = auth.uid();
  return new;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function public.set_last_edited_by() from public, anon, authenticated;

create trigger trg_daily_logs_last_edited_by
before update on public.daily_logs
for each row execute procedure public.set_last_edited_by();

create or replace function public.validate_daily_log_date()
returns trigger as $$
declare
  owner_tz text;
  owner_local_today date;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  select p.timezone into owner_tz
  from public.pets pt
  join public.profiles p on p.id = pt.owner_id
  where pt.id = new.pet_id;

  owner_local_today := (now() at time zone coalesce(owner_tz, 'UTC'))::date;

  if new.log_date > owner_local_today then
    raise exception 'No se pueden crear registros con fecha futura (hoy es % en la zona horaria del propietario)', owner_local_today;
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function public.validate_daily_log_date() from public, anon, authenticated;

create trigger trg_validate_daily_log_date
before insert or update on public.daily_logs
for each row execute procedure public.validate_daily_log_date();

create or replace function public.protect_daily_log_audit_fields()
returns trigger as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  if new.pet_id is distinct from old.pet_id then
    raise exception 'No se puede modificar pet_id de un registro existente';
  end if;
  if new.logged_by is distinct from old.logged_by then
    raise exception 'No se puede modificar quién creó originalmente el registro';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'No se puede modificar created_at';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function public.protect_daily_log_audit_fields() from public, anon, authenticated;

create trigger trg_protect_daily_log_audit
before update on public.daily_logs
for each row execute procedure public.protect_daily_log_audit_fields();

alter table public.daily_logs enable row level security;

create policy "daily_logs: select members" on public.daily_logs for select using (public.is_pet_member(pet_id));
create policy "daily_logs: insert editors" on public.daily_logs for insert with check (
  public.can_edit_pet(pet_id) and logged_by = auth.uid()
);
create policy "daily_logs: update editors" on public.daily_logs for update using (public.can_edit_pet(pet_id));
create policy "daily_logs: delete editors" on public.daily_logs for delete using (public.can_edit_pet(pet_id));

revoke insert, update on public.daily_logs from authenticated;
grant insert (
  pet_id, logged_by, log_date, energy_level, appetite_level, mood_level,
  activity_level, sleep_quality, vocalization_level, social_interaction_level,
  unusual_behavior, unusual_behavior_notes, notes, tags
) on public.daily_logs to authenticated;
grant update (
  log_date, energy_level, appetite_level, mood_level, activity_level,
  sleep_quality, vocalization_level, social_interaction_level,
  unusual_behavior, unusual_behavior_notes, notes, tags
) on public.daily_logs to authenticated;
-- pet_id, logged_by, created_at: ausentes del grant de update
-- (doble protección junto con el trigger de arriba).
