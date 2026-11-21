-- =====================================================================
-- KITOM · Avisos de invitación de co-tutor (email + push)
-- =====================================================================
-- Problema (QA-07, docs/QA_2026-11-16.md): una invitación solo se veía al
-- abrir la app. Ahora la persona invitada recibe un email y un push.
--
-- El remoto no tiene pg_net, así que la base no puede llamar a nadie: deja
-- el aviso en una cola y la Edge Function `invitation-notify` lo envía. La
-- app la llama justo después de invitar, con el JWT de quien invita; la
-- función solo procesa los avisos de las invitaciones de ese usuario.
--
-- Cambios (tablas, RLS y políticas existentes sin cambios):
--  1. Cola private.pet_invitation_notifications (un aviso por invitación),
--     con RLS y sin grants.
--  2. Trigger AFTER INSERT/UPDATE en pet_co_owners: encola cuando una
--     invitación pasa a `pending` o se renueva (invited_at cambia), en la
--     MISMA transacción. Como antes, invite_pet_member_by_email no revela si
--     el email tiene cuenta: sin cuenta no hay fila y no hay aviso.
--  3. RPC para la función, SECURITY DEFINER con search_path vacío y EXECUTE
--     solo para service_role:
--       pet_invitation_notifications_claim(inviter, limit): reserva los
--         avisos pendientes de ese usuario y devuelve lo necesario para
--         enviarlos (email y tokens de la persona invitada, nombres).
--       pet_invitation_notifications_complete(...): anota el resultado por
--         canal y desactiva los tokens que Expo da por no registrados.
--
-- Reglas:
--  - Cada canal (email, push) se envía como mucho una vez por invitación
--    (email_done / push_done). Un canal que falla se reintenta en la
--    siguiente llamada, hasta 3 reservas; una reserva caduca a los 5 min.
--  - Solo invitaciones `pending` de mascotas activas, de menos de 7 días.
--  - `alert_notifications_enabled = false` (Ajustes › Notificaciones) apaga
--    los dos canales; sin fila de preferencias, se avisa (default true).
--  - Solo el email de una cuenta confirmada y vigente (como al invitar).
--  - Los estados guardan códigos ([a-z_]), nunca texto libre.
--  - Al borrar la invitación, la mascota o la cuenta, el aviso se borra
--    (ON DELETE CASCADE desde pet_co_owners).
-- Contrato: docs/README.md §13.1.
-- =====================================================================

-- 1. Cola
create table private.pet_invitation_notifications (
  invitation_id uuid        primary key references public.pet_co_owners (id) on delete cascade,
  invited_at    timestamptz not null,
  created_at    timestamptz not null default now(),
  claimed_at    timestamptz,
  attempts      integer     not null default 0,
  email_done    boolean     not null default false,
  push_done     boolean     not null default false,
  email_status  text,
  push_status   text,
  completed_at  timestamptz,
  constraint pet_invitation_notifications_status_code check (
    (email_status is null or email_status ~ '^[a-z_]{1,40}$')
    and (push_status is null or push_status ~ '^[a-z_]{1,40}$')
  )
);

comment on table private.pet_invitation_notifications is
  'Avisos (email + push) de las invitaciones de co-tutor pendientes de enviar. La escribe el trigger de pet_co_owners y la procesa la Edge Function invitation-notify.';

alter table private.pet_invitation_notifications enable row level security;
revoke all on table private.pet_invitation_notifications from public, anon, authenticated, service_role;

create index pet_invitation_notifications_pending_idx
  on private.pet_invitation_notifications (created_at)
  where completed_at is null;

-- 2. Encolar
create or replace function private.enqueue_pet_invitation_notification()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $function$
begin
  if new.status <> 'pending'::public.co_owner_status then
    return null;
  end if;
  if tg_op = 'UPDATE' then
    if old.status = 'pending'::public.co_owner_status and old.invited_at is not distinct from new.invited_at then
      return null;
    end if;
  end if;

  insert into private.pet_invitation_notifications (invitation_id, invited_at)
  values (new.id, new.invited_at)
  on conflict (invitation_id) do update
    set invited_at   = excluded.invited_at,
        created_at   = now(),
        claimed_at   = null,
        attempts     = 0,
        email_done   = false,
        push_done    = false,
        email_status = null,
        push_status  = null,
        completed_at = null;
  return null;
end;
$function$;

revoke all on function private.enqueue_pet_invitation_notification() from public, anon, authenticated, service_role;

create trigger trg_enqueue_pet_invitation_notification
  after insert or update of status, invited_at on public.pet_co_owners
  for each row execute function private.enqueue_pet_invitation_notification();

-- 3a. Reservar los avisos de un usuario
create or replace function public.pet_invitation_notifications_claim(
  p_inviter_id uuid,
  p_limit      integer default 5
)
  returns table (
    invitation_id    uuid,
    invited_at       timestamptz,
    invitee_id       uuid,
    invitee_email    text,
    invitee_locale   text,
    inviter_name     text,
    pet_name         text,
    role             public.co_owner_role,
    alerts_enabled   boolean,
    send_email       boolean,
    send_push        boolean,
    push_tokens      text[]
  )
  language plpgsql
  security definer
  set search_path = ''
  as $function$
begin
  if p_inviter_id is null or p_limit is null or p_limit < 1 or p_limit > 20 then
    raise exception 'invitation_notify_invalid_parameter' using errcode = '22023';
  end if;

  return query
  with due as (
    select n.invitation_id
      from private.pet_invitation_notifications n
      join public.pet_co_owners co on co.id = n.invitation_id
      join public.pets p on p.id = co.pet_id
     where co.invited_by = p_inviter_id
       and co.status = 'pending'::public.co_owner_status
       and co.invited_at = n.invited_at
       and p.is_active
       and n.completed_at is null
       and n.attempts < 3
       and n.created_at > now() - interval '7 days'
       and (n.claimed_at is null or n.claimed_at <= now() - interval '5 minutes')
     order by n.created_at, n.invitation_id
     limit p_limit
     for update of n skip locked
  ),
  claimed as (
    update private.pet_invitation_notifications n
       set claimed_at = now(),
           attempts = n.attempts + 1
      from due
     where n.invitation_id = due.invitation_id
    returning n.invitation_id, n.invited_at, n.email_done, n.push_done
  )
  select c.invitation_id,
         c.invited_at,
         co.user_id,
         (select u.email::text
            from auth.users u
           where u.id = co.user_id
             and u.email_confirmed_at is not null
             and u.deleted_at is null
             and (u.banned_until is null or u.banned_until <= now())),
         invitee.locale,
         inviter.full_name,
         p.name,
         co.role,
         coalesce((select np.alert_notifications_enabled
                     from public.notification_preferences np
                    where np.user_id = co.user_id), true),
         not c.email_done,
         not c.push_done,
         coalesce((select array_agg(t.token order by t.last_seen_at desc)
                     from (select pt.token, pt.last_seen_at
                             from public.push_tokens pt
                            where pt.user_id = co.user_id
                              and pt.is_active
                            order by pt.last_seen_at desc
                            limit 5) t), '{}'::text[])
    from claimed c
    join public.pet_co_owners co on co.id = c.invitation_id
    join public.pets p on p.id = co.pet_id
    left join public.profiles invitee on invitee.id = co.user_id
    left join public.profiles inviter on inviter.id = co.invited_by;
end;
$function$;

comment on function public.pet_invitation_notifications_claim(uuid, integer) is
  'Edge Function invitation-notify: reserva (5 min) los avisos pendientes de las invitaciones de un usuario. Solo service_role.';

-- 3b. Anotar el resultado
create or replace function public.pet_invitation_notifications_complete(
  p_invitation_id  uuid,
  p_invited_at     timestamptz,
  p_email_done     boolean,
  p_email_status   text,
  p_push_done      boolean,
  p_push_status    text,
  p_invalid_tokens text[] default '{}'::text[]
)
  returns boolean
  language plpgsql
  security definer
  set search_path = ''
  as $function$
declare
  invitee uuid;
  updated integer;
begin
  if p_invitation_id is null or p_invited_at is null
     or p_email_done is null or p_push_done is null
     or (p_email_status is not null and p_email_status !~ '^[a-z_]{1,40}$')
     or (p_push_status is not null and p_push_status !~ '^[a-z_]{1,40}$')
     or coalesce(cardinality(p_invalid_tokens), 0) > 20 then
    raise exception 'invitation_notify_invalid_parameter' using errcode = '22023';
  end if;

  update private.pet_invitation_notifications n
     set email_done   = n.email_done or p_email_done,
         push_done    = n.push_done or p_push_done,
         email_status = coalesce(p_email_status, n.email_status),
         push_status  = coalesce(p_push_status, n.push_status),
         claimed_at   = null,
         completed_at = case when (n.email_done or p_email_done) and (n.push_done or p_push_done)
                             then now() else null end
   where n.invitation_id = p_invitation_id
     and n.invited_at = p_invited_at
     and n.completed_at is null;
  get diagnostics updated = row_count;

  -- Tokens que Expo da por no registrados (app desinstalada): solo los de la
  -- persona invitada, nunca los de otra cuenta.
  if updated > 0 and coalesce(cardinality(p_invalid_tokens), 0) > 0 then
    select co.user_id into invitee from public.pet_co_owners co where co.id = p_invitation_id;
    update public.push_tokens pt
       set is_active = false
     where pt.user_id = invitee
       and pt.token = any (p_invalid_tokens);
  end if;

  return updated > 0;
end;
$function$;

comment on function public.pet_invitation_notifications_complete(uuid, timestamptz, boolean, text, boolean, text, text[]) is
  'Edge Function invitation-notify: anota el resultado de cada canal y desactiva los tokens no registrados. Solo service_role.';

revoke all on function public.pet_invitation_notifications_claim(uuid, integer) from public, anon, authenticated;
revoke all on function public.pet_invitation_notifications_complete(uuid, timestamptz, boolean, text, boolean, text, text[]) from public, anon, authenticated;
grant execute on function public.pet_invitation_notifications_claim(uuid, integer) to service_role;
grant execute on function public.pet_invitation_notifications_complete(uuid, timestamptz, boolean, text, boolean, text, text[]) to service_role;
