-- ============================================================
-- KITOM v2.2 · 24 · PET_SHARED_REPORTS
-- CAMBIO vs v2.1 (punto 16): se añade request_generate_report(), una
-- función de VALIDACIÓN (no de creación) para que el frontend tenga
-- el mismo patrón consistente que en IA: "valida vía RPC, genera vía
-- Edge Function". No inserta nada en pet_shared_reports — sigue sin
-- existir ningún camino de insert directo para 'authenticated'. El
-- flujo real sigue siendo:
--
--   Mobile → rpc('request_generate_report', {...}) [valida acceso y
--   rango de fechas, devuelve error claro si algo no cuadra]
--     ↓ si pasa, Mobile invoca la Edge Function "generate-pet-report"
--       con los mismos parámetros
--     ↓ Edge Function genera el PDF, lo sube a Storage, e inserta la
--       fila en pet_shared_reports con service_role
--
-- No se guarda un estado "pending" en esta tabla porque haría falta
-- añadir una columna de estado y complicar el modelo para un caso que
-- no lo necesita (el documento pide explícitamente no complicar si no
-- hace falta) — la validación y la generación son dos pasos
-- encadenados desde el cliente, no un flujo asíncrono con estado
-- intermedio como si tiene la IA.
-- ============================================================
create table public.pet_shared_reports (
  id                 uuid primary key default gen_random_uuid(),
  pet_id             uuid not null references public.pets(id) on delete cascade,
  generated_by       uuid references public.profiles(id) on delete set null,
  file_path          text not null,
  date_range_start   date not null,
  date_range_end     date not null,
  created_at         timestamptz not null default now(),
  check (date_range_end >= date_range_start)
);

alter table public.pet_shared_reports enable row level security;

create policy "shared_reports: select members" on public.pet_shared_reports for select using (public.is_pet_member(pet_id));
-- Sin policy de insert/update/delete para 'authenticated': 100% backend-owned.

revoke insert on public.pet_shared_reports from authenticated;

create or replace function public.request_generate_report(
  target_pet_id uuid,
  range_start date,
  range_end date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;
  if not public.can_edit_pet(target_pet_id) then
    raise exception 'No tienes acceso a esta mascota';
  end if;
  if range_end < range_start then
    raise exception 'El rango de fechas no es válido';
  end if;
  if range_end > current_date then
    raise exception 'El rango de fechas no puede terminar en el futuro';
  end if;
  -- Validación superada. El cliente debe invocar ahora la Edge
  -- Function "generate-pet-report" con los mismos parámetros.
end;
$$;

revoke execute on function public.request_generate_report(uuid, date, date) from public, anon;
grant execute on function public.request_generate_report(uuid, date, date) to authenticated;
