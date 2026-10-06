-- ============================================================
-- KITOM v2.2.1 · 27 · ORGANIZATIONS (preparación)
-- CAMBIO vs v2.2 (punto 8): is_org_member() tenía el mismo problema de
-- EXECUTE que is_pet_member()/can_edit_pet() — solo se revocaba de
-- 'anon', no de 'public'. Corregido. Sin más cambios: sigue siendo
-- solo preparación (sin portal, sin alta desde la app, sin vincular
-- mascotas a una organización).
-- ============================================================
create table public.organizations (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  type            org_type not null default 'individual',
  contact_email   text,
  contact_phone   text,
  city            text,
  country         text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger set_timestamp_organizations
before update on public.organizations
for each row execute procedure public.trigger_set_timestamp();

create table public.organization_members (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  user_id           uuid not null references public.profiles(id) on delete cascade,
  role              org_member_role not null default 'member',
  created_at        timestamptz not null default now(),
  unique (organization_id, user_id)
);

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;

create or replace function public.is_org_member(target_org_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = target_org_id and m.user_id = auth.uid()
  );
$$;

revoke execute on function public.is_org_member(uuid) from public, anon;
grant execute on function public.is_org_member(uuid) to authenticated;

create policy "organizations: select members" on public.organizations for select using (public.is_org_member(id));
create policy "organization_members: select own org" on public.organization_members for select using (public.is_org_member(organization_id));
