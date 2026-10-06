-- ============================================================
-- KITOM v2.2.1 · 05 · PROFILES
-- CAMBIO vs v2.2 (punto 7): profiles.timezone ahora se valida contra
-- pg_timezone_names en un TRIGGER (nunca en un CHECK: Postgres no
-- permite que un CHECK consulte otra tabla/vista, así que no había
-- alternativa declarativa — esto no es una preferencia de estilo, es
-- una restricción real del motor). Rechaza cualquier valor que no sea
-- un nombre IANA válido ('Europe/Madrid', 'America/New_York'...);
-- nunca abreviaturas ambiguas como 'CET'. Si llega NULL, se sustituye
-- por 'UTC' en vez de fallar (mantiene el default aunque alguien
-- inserte explícitamente NULL).
-- ============================================================
create table public.profiles (
  id                       uuid primary key references auth.users(id) on delete cascade,
  full_name                text,
  avatar_path              text,
  external_avatar_url      text,
  phone                    text unique,
  locale                   text not null default 'es',
  timezone                 text not null default 'UTC',
  disclaimer_accepted_at   timestamptz,
  disclaimer_version       text,
  onboarding_completed_at  timestamptz,
  marketing_opt_in         boolean not null default false,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create trigger set_timestamp_profiles
before update on public.profiles
for each row execute procedure public.trigger_set_timestamp();

create or replace function public.validate_profile_timezone()
returns trigger as $$
begin
  if new.timezone is null then
    new.timezone := 'UTC';
    return new;
  end if;

  if not exists (select 1 from pg_timezone_names where name = new.timezone) then
    raise exception 'Zona horaria no válida: % (debe ser un nombre IANA, p. ej. Europe/Madrid)', new.timezone;
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function public.validate_profile_timezone() from public, anon, authenticated;

create trigger trg_validate_profile_timezone
before insert or update on public.profiles
for each row execute procedure public.validate_profile_timezone();

alter table public.profiles enable row level security;

create policy "profiles: select own" on public.profiles for select using (id = auth.uid());
create policy "profiles: update own" on public.profiles for update using (id = auth.uid());
create policy "profiles: insert own" on public.profiles for insert with check (id = auth.uid());

revoke update on public.profiles from authenticated;
grant update (
  full_name, avatar_path, external_avatar_url, phone, locale, timezone,
  disclaimer_accepted_at, disclaimer_version, onboarding_completed_at, marketing_opt_in
) on public.profiles to authenticated;
-- id, created_at, updated_at: nunca concedidos.
