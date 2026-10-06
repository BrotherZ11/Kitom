-- ============================================================
-- KITOM v2.2 · 23 · CLINIC_REFERRALS — sin cambios vs v2.1.
-- ============================================================
create table public.clinic_referrals (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     uuid not null references public.vet_clinics(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  source        text,
  campaign      text,
  referred_at   timestamptz not null default now(),
  unique (clinic_id, user_id)
);

alter table public.clinic_referrals enable row level security;

create policy "clinic_referrals: select own" on public.clinic_referrals for select using (user_id = auth.uid());

create or replace function public.create_clinic_referral(
  clinic_referral_code text,
  ref_source text default null,
  ref_campaign text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_clinic_id uuid;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  select id into target_clinic_id from public.vet_clinics where referral_code = clinic_referral_code;
  if not found then
    raise exception 'Código de referido no válido';
  end if;

  insert into public.clinic_referrals (clinic_id, user_id, source, campaign)
  values (target_clinic_id, auth.uid(), ref_source, ref_campaign)
  on conflict (clinic_id, user_id) do nothing;
end;
$$;

revoke execute on function public.create_clinic_referral(text, text, text) from public, anon;
grant execute on function public.create_clinic_referral(text, text, text) to authenticated;
