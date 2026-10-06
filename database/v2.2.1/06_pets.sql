-- ============================================================
-- KITOM v2.2 · 06 · PETS
-- CAMBIO DE FONDO vs v2.1 (punto 2, CRÍTICO):
--
-- En v2.1, owner_id estaba protegido SOLO por un trigger que
-- comprobaba "¿quién soy yo respecto al owner actual?". Eso significa
-- que el propio propietario SÍ podía cambiar owner_id con un UPDATE
-- normal, saltándose por completo la lógica de transfer_pet_ownership
-- (validar que el nuevo owner es co-tutor aceptado, mantener
-- coherencia con pet_co_owners, etc.). El documento de esta revisión
-- es explícito: "NO soluciones esto únicamente con un trigger. El
-- UPDATE normal NO debe permitir cambiar owner_id."
--
-- v2.2 usa DOS mecanismos independientes, ninguno de los cuales es
-- "solo un trigger":
--
--   1) GRANT por columna (la barrera principal): `authenticated` NUNCA
--      tiene privilegio de UPDATE sobre owner_id. Cualquier UPDATE que
--      incluya owner_id en el SET es rechazado por Postgres a nivel de
--      permisos, antes incluso de evaluar RLS o triggers. Esto aplica
--      igual da igual quién sea — el propio owner incluido.
--
--   2) Trigger con bandera de sesión explícita (defensa adicional):
--      incluso código que se ejecute con privilegios elevados (por
--      ejemplo, dentro de otra función SECURITY DEFINER que hiciera un
--      UPDATE de pets por error) no puede tocar owner_id salvo que
--      transfer_pet_ownership() haya marcado explícitamente
--      kitom.ownership_transfer_in_progress = true para ESA transacción.
--      No se basa en "quién es auth.uid()" — es una autorización
--      explícita de un único punto de entrada, no ambiental.
--
-- is_active sigue protegido con la lógica de v2.1 (solo el propietario
-- actual puede archivar/reactivar; no fue señalado como problema en
-- esta revisión, así que no se toca esa parte).
-- ============================================================
create table public.pets (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null references public.profiles(id) on delete restrict,
  name                text not null,
  species_id          uuid not null references public.species(id),
  breed               text,
  birth_date          date,
  sex                 pet_sex default 'unknown',
  weight_kg           numeric(9,3) check (weight_kg > 0),
  sterilized          boolean,
  known_conditions    text[] default '{}',
  allergies           text[] default '{}',
  temperament_notes   text,
  photo_path          text,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index idx_pets_owner   on public.pets(owner_id);
create index idx_pets_species on public.pets(species_id);

create trigger set_timestamp_pets
before update on public.pets
for each row execute procedure public.trigger_set_timestamp();

alter table public.pets enable row level security;

create policy "pets: insert own" on public.pets for insert with check (owner_id = auth.uid());
create policy "pets: delete owner" on public.pets for delete using (owner_id = auth.uid());
-- select/update en 08_pet_access_control.sql

revoke insert, update on public.pets from authenticated;
grant insert (owner_id, name, species_id, breed, birth_date, sex, weight_kg,
  sterilized, known_conditions, allergies, temperament_notes, photo_path, is_active)
  on public.pets to authenticated;
grant update (
  name, species_id, breed, birth_date, sex, weight_kg, sterilized,
  known_conditions, allergies, temperament_notes, photo_path, is_active
) on public.pets to authenticated;
-- owner_id: AUSENTE del grant de update a propósito (ver cabecera).

create or replace function public.validate_pet_birth_date()
returns trigger as $$
begin
  if new.birth_date is not null and new.birth_date > current_date then
    raise exception 'La fecha de nacimiento no puede ser futura';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function public.validate_pet_birth_date() from public, anon, authenticated;

create trigger trg_validate_pet_birth_date
before insert or update on public.pets
for each row execute procedure public.validate_pet_birth_date();

create or replace function public.protect_pet_structural_fields()
returns trigger as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  -- owner_id: bloqueado salvo que transfer_pet_ownership() haya
  -- autorizado explícitamente esta transacción concreta. El GRANT ya
  -- impide que 'authenticated' llegue aquí con owner_id modificado,
  -- pero esta comprobación cubre cualquier otro camino interno.
  if new.owner_id is distinct from old.owner_id then
    if coalesce(current_setting('kitom.ownership_transfer_in_progress', true), 'false') <> 'true' then
      raise exception 'owner_id solo puede modificarse mediante transfer_pet_ownership()';
    end if;
  end if;

  -- is_active: solo el propietario actual (sin cambios vs v2.1).
  if auth.uid() is distinct from old.owner_id then
    if new.is_active is distinct from old.is_active then
      raise exception 'Solo el propietario principal puede archivar/reactivar la mascota';
    end if;
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function public.protect_pet_structural_fields() from public, anon, authenticated;

create trigger trg_protect_pet_structural_fields
before update on public.pets
for each row execute procedure public.protect_pet_structural_fields();
