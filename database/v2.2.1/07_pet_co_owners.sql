-- ============================================================
-- KITOM v2.2 · 07 · PET_CO_OWNERS — sin cambios vs v2.1
-- Estructura idéntica. pets.owner_id sigue siendo la ÚNICA fuente de
-- verdad de propiedad (punto 18): co_owner_role nunca ha admitido
-- 'owner', así que no hay dos fuentes de verdad posibles.
-- ============================================================
create table public.pet_co_owners (
  id           uuid primary key default gen_random_uuid(),
  pet_id       uuid not null references public.pets(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  role         co_owner_role not null default 'viewer',
  status       co_owner_status not null default 'pending',
  invited_by   uuid references public.profiles(id) on delete set null,
  invited_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  unique (pet_id, user_id)
);

create index idx_co_owners_pet  on public.pet_co_owners(pet_id);
create index idx_co_owners_user on public.pet_co_owners(user_id);

alter table public.pet_co_owners enable row level security;
-- Sin policies de insert/update/delete: todo pasa por las funciones de 08.
