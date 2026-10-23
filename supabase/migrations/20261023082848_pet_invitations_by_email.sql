-- =====================================================================
-- KITOM · Co-tutores: invitar por email y ver invitaciones y miembros
-- =====================================================================
-- invite_pet_member(target_pet_id, invitee_user_id, …) pide el id del
-- invitado, y RLS no deja buscar a otros usuarios (profiles: select own).
-- Además, quien recibe una invitación no ve la mascota (pets: select
-- is_pet_member, que exige la invitación aceptada) ni el nombre de quien le
-- invita, y los miembros no ven los nombres de los demás (profiles).
--
-- Cambios (solo funciones nuevas; tablas, RLS, triggers y las RPC
-- existentes sin cambios):
--  1. invite_pet_member_by_email: el propietario invita por email. Primero
--     comprueba la propiedad (nadie más puede usarla para sondear emails) y
--     después responde igual exista o no la cuenta, sea el propio email o
--     haya ya una invitación activa: no revela qué emails están registrados.
--     Delega en invite_pet_member (mismas reglas).
--  2. get_my_pet_invitations: las invitaciones pendientes del usuario, con
--     el nombre de la mascota y de quien invita.
--  3. get_pet_members: los co-tutores (pendientes y aceptados) de una
--     mascota con su nombre; solo para sus miembros.
-- Todas SECURITY DEFINER con search_path fijo; sin EXECUTE para anon.
-- Límite conocido: no hay límite de frecuencia de invitaciones por usuario.
-- =====================================================================

-- 1. Invitar por email
create or replace function public.invite_pet_member_by_email(
  target_pet_id uuid,
  invitee_email text,
  initial_role  public.co_owner_role default 'viewer'::public.co_owner_role
)
  returns void
  language plpgsql
  security definer
  set search_path to 'public'
  as $function$
declare
  normalized text := lower(trim(coalesce(invitee_email, '')));
  invitee uuid;
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using hint = 'not_authenticated';
  end if;

  -- La propiedad, antes de mirar el email: quien no es el propietario no
  -- puede usar esta función para saber si un email tiene cuenta.
  if not exists (
    select 1 from public.pets
    where id = target_pet_id and owner_id = auth.uid() and is_active
  ) then
    raise exception 'Solo el propietario principal puede invitar co-tutores' using hint = 'not_pet_owner';
  end if;

  if normalized = '' or length(normalized) > 320 or position('@' in normalized) < 2 then
    raise exception 'Email no válido' using hint = 'invalid_email';
  end if;

  select id into invitee from auth.users where lower(email) = normalized;

  -- Sin cuenta o el propio usuario: misma respuesta que una invitación enviada.
  if invitee is null or invitee = auth.uid() then
    return;
  end if;

  begin
    perform public.invite_pet_member(target_pet_id, invitee, initial_role);
  exception when raise_exception then
    -- Ya hay una invitación pendiente o aceptada: misma respuesta.
    return;
  end;
end;
$function$;

comment on function public.invite_pet_member_by_email(uuid, text, public.co_owner_role) is
  'El propietario invita a un co-tutor por email. Responde igual exista o no la cuenta (no revela emails registrados).';

-- 2. Mis invitaciones pendientes
create or replace function public.get_my_pet_invitations()
  returns table (
    invitation_id   uuid,
    pet_id          uuid,
    pet_name        text,
    role            public.co_owner_role,
    invited_by_name text,
    invited_at      timestamptz
  )
  language sql
  stable
  security definer
  set search_path to 'public'
  as $function$
  select co.id, p.id, p.name, co.role, pr.full_name, co.invited_at
  from public.pet_co_owners co
  join public.pets p on p.id = co.pet_id
  left join public.profiles pr on pr.id = co.invited_by
  where co.user_id = auth.uid()
    and co.status = 'pending'
    and p.is_active
  order by co.invited_at desc;
$function$;

comment on function public.get_my_pet_invitations() is
  'Invitaciones pendientes del usuario, con el nombre de la mascota y de quien invita.';

-- 3. Miembros de una mascota
create or replace function public.get_pet_members(target_pet_id uuid)
  returns table (
    invitation_id uuid,
    user_id       uuid,
    full_name     text,
    role          public.co_owner_role,
    status        public.co_owner_status,
    invited_at    timestamptz,
    accepted_at   timestamptz
  )
  language plpgsql
  stable
  security definer
  set search_path to 'public'
  as $function$
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using hint = 'not_authenticated';
  end if;
  if not public.is_pet_member(target_pet_id) then
    raise exception 'No tienes acceso a esta mascota' using hint = 'not_pet_member';
  end if;

  return query
    select co.id, co.user_id, pr.full_name, co.role, co.status, co.invited_at, co.accepted_at
    from public.pet_co_owners co
    left join public.profiles pr on pr.id = co.user_id
    where co.pet_id = target_pet_id
      and co.status in ('pending', 'accepted')
    order by co.invited_at;
end;
$function$;

comment on function public.get_pet_members(uuid) is
  'Co-tutores pendientes y aceptados de una mascota, con su nombre. Solo para miembros de la mascota.';

-- Permisos: solo usuarios autenticados.
revoke all on function public.invite_pet_member_by_email(uuid, text, public.co_owner_role) from public, anon;
revoke all on function public.get_my_pet_invitations() from public, anon;
revoke all on function public.get_pet_members(uuid) from public, anon;

grant execute on function public.invite_pet_member_by_email(uuid, text, public.co_owner_role) to authenticated;
grant execute on function public.get_my_pet_invitations() to authenticated;
grant execute on function public.get_pet_members(uuid) to authenticated;
