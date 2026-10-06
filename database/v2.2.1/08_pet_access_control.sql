-- ============================================================
-- KITOM v2.2.1 · 08 · CONTROL DE ACCESO A MASCOTAS
-- CAMBIO vs v2.2 (punto 8): is_pet_member() y can_edit_pet() solo
-- revocaban EXECUTE de 'anon', no de 'public'. En Postgres, el
-- privilegio EXECUTE se concede a PUBLIC automáticamente al crear una
-- función salvo que se revoque explícitamente — y revocarlo de un rol
-- concreto (anon) NO anula lo que ese rol sigue recibiendo por
-- herencia de PUBLIC. Es decir: en v2.2 estas dos funciones seguían
-- siendo ejecutables por 'anon' en la práctica, pese a la intención
-- del REVOKE. Corregido añadiendo 'public' explícitamente en el
-- REVOKE, aquí y en is_org_member() (27_organizations_prep.sql).
-- El resto del archivo no cambia: mismas RPCs, mismas validaciones,
-- mismo transfer_pet_ownership() con bloqueo FOR UPDATE.
-- ============================================================

create or replace function public.is_pet_member(target_pet_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.pets p
    where p.id = target_pet_id and p.owner_id = auth.uid()
  ) or exists (
    select 1 from public.pet_co_owners co
    where co.pet_id = target_pet_id and co.user_id = auth.uid() and co.status = 'accepted'
  );
$$;

create or replace function public.can_edit_pet(target_pet_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.pets p
    where p.id = target_pet_id and p.owner_id = auth.uid()
  ) or exists (
    select 1 from public.pet_co_owners co
    where co.pet_id = target_pet_id and co.user_id = auth.uid()
      and co.role = 'editor' and co.status = 'accepted'
  );
$$;

revoke execute on function public.is_pet_member(uuid) from public, anon;
revoke execute on function public.can_edit_pet(uuid) from public, anon;
grant execute on function public.is_pet_member(uuid) to authenticated;
grant execute on function public.can_edit_pet(uuid) to authenticated;

create policy "pets: select members" on public.pets for select using (public.is_pet_member(id));
create policy "pets: update editors" on public.pets for update using (public.can_edit_pet(id));

create policy "co_owners: select members or self" on public.pet_co_owners for select using (
  public.is_pet_member(pet_id) or user_id = auth.uid()
);

create or replace function public.owner_has_pets()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (select 1 from public.pets where owner_id = auth.uid());
$$;

revoke execute on function public.owner_has_pets() from public, anon;
grant execute on function public.owner_has_pets() to authenticated;

create or replace function public.invite_pet_member(
  target_pet_id uuid,
  invitee_user_id uuid,
  initial_role co_owner_role default 'viewer'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pet_row public.pets%rowtype;
  existing public.pet_co_owners%rowtype;
  invitee_exists boolean;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  select * into pet_row from public.pets where id = target_pet_id;
  if not found then
    raise exception 'Mascota no encontrada';
  end if;
  if pet_row.owner_id <> auth.uid() then
    raise exception 'Solo el propietario principal puede invitar co-tutores';
  end if;
  if not pet_row.is_active then
    raise exception 'No se puede invitar sobre una mascota archivada';
  end if;
  if invitee_user_id = auth.uid() then
    raise exception 'No puedes invitarte a ti mismo';
  end if;

  select exists(select 1 from public.profiles where id = invitee_user_id) into invitee_exists;
  if not invitee_exists then
    raise exception 'El usuario invitado no existe';
  end if;

  select * into existing from public.pet_co_owners
  where pet_id = target_pet_id and user_id = invitee_user_id;

  if found then
    if existing.status in ('pending','accepted') then
      raise exception 'Ya existe una invitación activa para este usuario (estado: %)', existing.status;
    end if;
    update public.pet_co_owners
    set status = 'pending',
        role = initial_role,
        invited_by = auth.uid(),
        invited_at = now(),
        accepted_at = null
    where pet_id = target_pet_id and user_id = invitee_user_id;
  else
    insert into public.pet_co_owners (pet_id, user_id, role, status, invited_by)
    values (target_pet_id, invitee_user_id, initial_role, 'pending', auth.uid());
  end if;
end;
$$;

create or replace function public.accept_pet_invitation(invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.pet_co_owners%rowtype;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  select * into inv from public.pet_co_owners where id = invitation_id;
  if not found then
    raise exception 'Invitación no encontrada';
  end if;
  if inv.user_id <> auth.uid() then
    raise exception 'No tienes permiso para aceptar esta invitación';
  end if;
  if inv.status <> 'pending' then
    raise exception 'Esta invitación ya no está pendiente (estado actual: %)', inv.status;
  end if;

  update public.pet_co_owners
  set status = 'accepted', accepted_at = now()
  where id = invitation_id;
end;
$$;

create or replace function public.decline_pet_invitation(invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.pet_co_owners%rowtype;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  select * into inv from public.pet_co_owners where id = invitation_id;
  if not found then
    raise exception 'Invitación no encontrada';
  end if;
  if inv.user_id <> auth.uid() then
    raise exception 'No tienes permiso para rechazar esta invitación';
  end if;
  if inv.status <> 'pending' then
    raise exception 'Esta invitación ya no está pendiente (estado actual: %)', inv.status;
  end if;

  update public.pet_co_owners set status = 'declined' where id = invitation_id;
end;
$$;

create or replace function public.revoke_pet_invitation(invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.pet_co_owners%rowtype;
  is_owner boolean;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  select * into inv from public.pet_co_owners where id = invitation_id;
  if not found then
    raise exception 'Invitación no encontrada';
  end if;

  select exists (select 1 from public.pets where id = inv.pet_id and owner_id = auth.uid()) into is_owner;
  if not is_owner then
    raise exception 'Solo el propietario principal puede revocar el acceso';
  end if;
  if inv.status not in ('pending','accepted') then
    raise exception 'No se puede revocar una invitación en estado %', inv.status;
  end if;

  update public.pet_co_owners set status = 'revoked' where id = invitation_id;
end;
$$;

create or replace function public.change_pet_member_role(invitation_id uuid, new_role co_owner_role)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.pet_co_owners%rowtype;
  is_owner boolean;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  select * into inv from public.pet_co_owners where id = invitation_id;
  if not found then
    raise exception 'Invitación no encontrada';
  end if;

  select exists (select 1 from public.pets where id = inv.pet_id and owner_id = auth.uid()) into is_owner;
  if not is_owner then
    raise exception 'Solo el propietario principal puede cambiar el rol de un miembro';
  end if;
  if inv.status <> 'accepted' then
    raise exception 'Solo se puede cambiar el rol de un miembro activo (estado: accepted)';
  end if;

  update public.pet_co_owners set role = new_role where id = invitation_id;
end;
$$;

create or replace function public.transfer_pet_ownership(target_pet_id uuid, new_owner_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pet_row public.pets%rowtype;
  new_owner_is_member boolean;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  select * into pet_row from public.pets where id = target_pet_id for update;
  if not found then
    raise exception 'Mascota no encontrada';
  end if;

  if pet_row.owner_id <> auth.uid() then
    raise exception 'Solo el propietario principal puede transferir la mascota';
  end if;

  if new_owner_id is null then
    raise exception 'Debes indicar el nuevo propietario';
  end if;

  if new_owner_id = auth.uid() then
    raise exception 'La mascota ya pertenece a este usuario';
  end if;

  if not exists (select 1 from public.profiles where id = new_owner_id) then
    raise exception 'El nuevo propietario no existe';
  end if;

  select exists (
    select 1 from public.pet_co_owners
    where pet_id = target_pet_id and user_id = new_owner_id and status = 'accepted'
  ) into new_owner_is_member;

  if not new_owner_is_member then
    raise exception 'El nuevo propietario debe ser un co-tutor con invitación aceptada';
  end if;

  perform set_config('kitom.ownership_transfer_in_progress', 'true', true);

  update public.pets set owner_id = new_owner_id where id = target_pet_id;

  delete from public.pet_co_owners where pet_id = target_pet_id and user_id = new_owner_id;

  insert into public.pet_co_owners (pet_id, user_id, role, status, invited_by, accepted_at)
  values (target_pet_id, pet_row.owner_id, 'editor', 'accepted', new_owner_id, now())
  on conflict (pet_id, user_id) do update set role = 'editor', status = 'accepted', accepted_at = now();
end;
$$;

revoke execute on function public.invite_pet_member(uuid, uuid, co_owner_role) from public, anon;
revoke execute on function public.accept_pet_invitation(uuid) from public, anon;
revoke execute on function public.decline_pet_invitation(uuid) from public, anon;
revoke execute on function public.revoke_pet_invitation(uuid) from public, anon;
revoke execute on function public.change_pet_member_role(uuid, co_owner_role) from public, anon;
revoke execute on function public.transfer_pet_ownership(uuid, uuid) from public, anon;

grant execute on function public.invite_pet_member(uuid, uuid, co_owner_role) to authenticated;
grant execute on function public.accept_pet_invitation(uuid) to authenticated;
grant execute on function public.decline_pet_invitation(uuid) to authenticated;
grant execute on function public.revoke_pet_invitation(uuid) to authenticated;
grant execute on function public.change_pet_member_role(uuid, co_owner_role) to authenticated;
grant execute on function public.transfer_pet_ownership(uuid, uuid) to authenticated;
