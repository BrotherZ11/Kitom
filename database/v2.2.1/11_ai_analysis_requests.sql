-- ============================================================
-- KITOM v2.2.1 · 11 · AI_ANALYSIS_REQUESTS
-- CAMBIOS vs v2.2:
--
--   - submit_ai_feedback() (punto 3, CRÍTICO): la comprobación de
--     acceso era is_pet_member(req.pet_id), lo que dejaba que
--     CUALQUIER co-tutor con acceso a la mascota modificara el
--     feedback de un análisis pedido por OTRO usuario. Corregido:
--     ahora exige req.requested_by = auth.uid(). Un co-tutor sigue
--     pudiendo VER el análisis (la policy de select no cambia, sigue
--     siendo is_pet_member), pero ya no puede tocar el feedback de
--     alguien más. No se crea una tabla ai_analysis_feedback nueva ni
--     se permiten varios feedbacks por análisis — se mantiene el
--     modelo actual, solo se corrige quién puede escribir.
--
--   - Nueva claim_ai_analysis_for_processing() (punto 5): transición
--     atómica pending -> processing mediante un UPDATE condicional
--     (WHERE status = 'pending'). Si dos invocaciones de la Edge
--     Function "ai-analysis-process" llegan casi a la vez para el
--     mismo analysis_id, como mucho una de ellas consigue el cambio
--     de estado (Postgres serializa los UPDATEs sobre la misma fila);
--     la otra recibe `false` y no debe seguir procesando. Es
--     backend-only: ni siquiera 'authenticated' tiene EXECUTE, porque
--     solo la Edge Function (con service_role) debe poder reclamar un
--     análisis para procesarlo.
-- ============================================================
create table public.ai_analysis_requests (
  id                  uuid primary key default gen_random_uuid(),
  pet_id              uuid not null references public.pets(id) on delete cascade,
  requested_by        uuid references public.profiles(id) on delete set null,
  photo_path          text,
  used_full_history   boolean not null default false,
  status              ai_request_status not null default 'pending',
  error_message       text,
  ai_provider         text,
  ai_model            text,
  prompt_version      text,
  response_raw        jsonb,
  urgency_level       urgency_level,
  possible_causes     text[],
  recommendations     text[],
  feedback            feedback_value,
  feedback_comment    text,
  cost_usd            numeric(10,6),
  latency_ms          integer,
  created_at          timestamptz not null default now()
);

create index idx_ai_requests_pet      on public.ai_analysis_requests(pet_id, created_at desc);
create index idx_ai_requests_by_user  on public.ai_analysis_requests(requested_by, created_at desc);

alter table public.ai_analysis_requests enable row level security;

create policy "ai_requests: select members" on public.ai_analysis_requests for select using (public.is_pet_member(pet_id));
-- Sin policy de insert ni de update para 'authenticated'. Creación
-- exclusiva vía request_ai_analysis() (12). El resultado lo escribe
-- la Edge Function "ai-analysis-process" con service_role, tras
-- reclamar el análisis con claim_ai_analysis_for_processing(). El
-- único camino de escritura para el cliente autenticado normal es
-- submit_ai_feedback(), y solo sobre sus propias solicitudes.

revoke select, insert, update on public.ai_analysis_requests from authenticated;

grant select (
  id, pet_id, requested_by, photo_path, used_full_history,
  status, urgency_level, possible_causes, recommendations,
  feedback, feedback_comment, created_at
) on public.ai_analysis_requests to authenticated;

create or replace function public.validate_ai_request_photo_path()
returns trigger as $$
declare
  path_pet_id uuid;
begin
  if new.photo_path is null then
    return new;
  end if;
  path_pet_id := public.safe_pet_id_from_path(new.photo_path);
  if path_pet_id is null or path_pet_id <> new.pet_id then
    raise exception 'photo_path no corresponde a la mascota de esta solicitud';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function public.validate_ai_request_photo_path() from public, anon, authenticated;

create trigger trg_validate_ai_request_photo_path
before insert or update on public.ai_analysis_requests
for each row execute procedure public.validate_ai_request_photo_path();

create or replace function public.get_ai_analysis_entitlement()
returns table(
  can_request boolean,
  would_use_full_history boolean,
  monthly_used integer,
  monthly_limit integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  requester_plan subscription_plan;
  used_count integer;
  limit_count integer;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  select plan into requester_plan from public.subscriptions where user_id = auth.uid();

  select count(*) into used_count
  from public.ai_analysis_requests r
  where r.requested_by = auth.uid()
    and r.status <> 'failed'
    and r.created_at >= date_trunc('month', now());

  limit_count := case when requester_plan = 'premium' then null else 3 end;

  return query select
    (limit_count is null or used_count < limit_count),
    (requester_plan = 'premium'),
    used_count,
    limit_count;
end;
$$;

revoke execute on function public.get_ai_analysis_entitlement() from public, anon;
grant execute on function public.get_ai_analysis_entitlement() to authenticated;

create or replace function public.submit_ai_feedback(
  target_analysis_id uuid,
  new_feedback feedback_value,
  new_feedback_comment text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  req public.ai_analysis_requests%rowtype;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  select * into req from public.ai_analysis_requests where id = target_analysis_id;
  if not found then
    raise exception 'Análisis no encontrado';
  end if;

  -- Punto 3: el feedback pertenece a quien SOLICITÓ el análisis, no a
  -- cualquier miembro con acceso a la mascota.
  if req.requested_by is distinct from auth.uid() then
    raise exception 'Solo el usuario que solicitó el análisis puede enviar o modificar su feedback';
  end if;

  update public.ai_analysis_requests
  set feedback = new_feedback,
      feedback_comment = new_feedback_comment
  where id = target_analysis_id;
end;
$$;

revoke execute on function public.submit_ai_feedback(uuid, feedback_value, text) from public, anon;
grant execute on function public.submit_ai_feedback(uuid, feedback_value, text) to authenticated;

create or replace function public.claim_ai_analysis_for_processing(target_analysis_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  update public.ai_analysis_requests
  set status = 'processing'
  where id = target_analysis_id and status = 'pending';

  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

revoke execute on function public.claim_ai_analysis_for_processing(uuid) from public, anon, authenticated;
-- Exclusivamente invocable desde la Edge Function "ai-analysis-process"
-- con service_role.
