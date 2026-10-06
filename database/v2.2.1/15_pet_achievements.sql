-- ============================================================
-- KITOM v2.2 · 15 · PET_ACHIEVEMENTS
-- CAMBIO vs v2.1 (punto 26): en v2.1 ya era imposible que el cliente
-- se autoasignara achievements (no existía policy de insert), pero
-- tampoco existía ningún mecanismo que los otorgara de verdad — la
-- tabla estaba "viva" solo en la teoría. award_pet_achievement() es
-- esa pieza que faltaba: backend-only (sin EXECUTE para
-- authenticated/anon bajo ningún concepto), idempotente por el propio
-- UNIQUE(pet_id, achievement_id) vía ON CONFLICT DO NOTHING (no puede
-- haber duplicados), y se invoca desde dentro de otras funciones
-- SECURITY DEFINER que sí conocen el contexto correcto:
--   - recompute_pet_streak() (16) para first_log/streak_7/streak_30
--   - request_ai_analysis() (12) para first_photo_scan
-- Nunca se invoca directamente desde el cliente.
-- ============================================================
create table public.pet_achievements (
  id              uuid primary key default gen_random_uuid(),
  pet_id          uuid not null references public.pets(id) on delete cascade,
  achievement_id  uuid not null references public.achievements_catalog(id),
  earned_at       timestamptz not null default now(),
  unique (pet_id, achievement_id)
);

alter table public.pet_achievements enable row level security;

create policy "pet_achievements: select members" on public.pet_achievements for select using (public.is_pet_member(pet_id));
-- Sin policy de insert/update/delete para 'authenticated' bajo ningún
-- concepto: los logros solo se otorgan vía award_pet_achievement().

create or replace function public.award_pet_achievement(target_pet_id uuid, achievement_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ach_id uuid;
begin
  select id into ach_id from public.achievements_catalog where code = achievement_code;
  if ach_id is null then
    return; -- código desconocido: no-op silencioso, no debe romper quien la llama
  end if;

  insert into public.pet_achievements (pet_id, achievement_id)
  values (target_pet_id, ach_id)
  on conflict (pet_id, achievement_id) do nothing;
end;
$$;

revoke execute on function public.award_pet_achievement(uuid, text) from public, anon, authenticated;
