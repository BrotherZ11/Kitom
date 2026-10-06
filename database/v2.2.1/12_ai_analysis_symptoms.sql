-- ============================================================
-- KITOM v2.2 · 12 · AI_ANALYSIS_SYMPTOMS + REQUEST_AI_ANALYSIS()
-- CAMBIO DE FONDO vs v2.1 (punto 5, CRÍTICO):
--
-- En v2.1 esta tabla tenía una policy de INSERT para 'authenticated'
-- (con can_edit_pet como condición). El documento de esta revisión es
-- explícito: "El cliente NO debe poder insertar/modificar
-- arbitrariamente ai_analysis_symptoms... debe ser backend-owned."
-- Se elimina esa policy por completo.
--
-- Aparece aquí request_ai_analysis(): es la ÚNICA forma de crear una
-- solicitud de IA. Hace TODO el flujo de validación pedido en el
-- documento (usuario, acceso a la mascota, especie, síntomas,
-- suscripción, entitlement, límite) y crea, en una sola transacción
-- atómica, la fila de ai_analysis_requests Y las de
-- ai_analysis_symptoms. Devuelve el id de la solicitud creada.
--
-- Se define en este archivo (no en 11) porque toca ambas tablas y
-- porque, para cuando alguien la INVOQUE de verdad, las 12 tablas ya
-- existen — el orden de creación de los archivos no afecta a esto:
-- PL/pgSQL no valida las referencias internas de una función hasta la
-- primera vez que se ejecuta (a diferencia de LANGUAGE SQL), así que
-- no importa que aquí se llame a award_pet_achievement(), definida
-- más adelante en 15_pet_achievements.sql.
--
-- Lo que NO hace esta función: llamar al proveedor de IA. Eso sigue
-- siendo responsabilidad de una Edge Function ("ai-analysis-process"),
-- que el cliente invoca justo después de recibir el analysis_id, y
-- que actualiza la fila (status/urgency_level/...) con service_role.
-- Mantener la llamada HTTP fuera de SQL evita depender de pg_net y
-- mantiene la función simple, tal y como pedía el documento.
-- ============================================================
create table public.ai_analysis_symptoms (
  analysis_id  uuid not null references public.ai_analysis_requests(id) on delete cascade,
  symptom_id   uuid not null references public.symptoms_catalog(id),
  primary key (analysis_id, symptom_id)
);

alter table public.ai_analysis_symptoms enable row level security;

create policy "ai_symptoms: select members" on public.ai_analysis_symptoms for select using (
  exists (select 1 from public.ai_analysis_requests r where r.id = analysis_id and public.is_pet_member(r.pet_id))
);
-- Sin policy de insert/update/delete para 'authenticated': solo se
-- escribe desde dentro de request_ai_analysis() (SECURITY DEFINER).

create or replace function public.validate_symptom_species_compat()
returns trigger as $$
declare
  pet_species_id uuid;
  compatible boolean;
begin
  select p.species_id into pet_species_id
  from public.ai_analysis_requests r
  join public.pets p on p.id = r.pet_id
  where r.id = new.analysis_id;

  select exists (
    select 1 from public.symptom_species ss
    where ss.symptom_id = new.symptom_id and ss.species_id = pet_species_id
  ) into compatible;

  if not compatible then
    raise exception 'El síntoma % no está registrado como compatible con la especie de esta mascota', new.symptom_id;
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function public.validate_symptom_species_compat() from public, anon, authenticated;

create trigger trg_validate_symptom_species
before insert on public.ai_analysis_symptoms
for each row execute procedure public.validate_symptom_species_compat();

create or replace function public.request_ai_analysis(
  target_pet_id uuid,
  p_photo_path text,
  symptom_ids uuid[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  pet_row public.pets%rowtype;
  entitlement record;
  sid uuid;
  compatible boolean;
  new_request_id uuid;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  -- 1) Acceso a la mascota
  if not public.can_edit_pet(target_pet_id) then
    raise exception 'No tienes acceso de edición sobre esta mascota';
  end if;

  select * into pet_row from public.pets where id = target_pet_id;
  if not found or not pet_row.is_active then
    raise exception 'Mascota no encontrada o archivada';
  end if;

  -- 2) La foto (si la hay) debe pertenecer a esta mascota
  if p_photo_path is not null then
    if public.safe_pet_id_from_path(p_photo_path) is distinct from target_pet_id then
      raise exception 'photo_path no corresponde a esta mascota';
    end if;
  end if;

  -- 3) Cada síntoma debe ser compatible con la especie del animal
  --    (misma comprobación que hace después el trigger de la tabla
  --    puente; se repite aquí para poder dar un mensaje de error claro
  --    antes de crear ninguna fila, no a mitad de una inserción).
  foreach sid in array symptom_ids loop
    select exists (
      select 1 from public.symptom_species ss
      where ss.symptom_id = sid and ss.species_id = pet_row.species_id
    ) into compatible;
    if not compatible then
      raise exception 'El síntoma % no es compatible con la especie de esta mascota', sid;
    end if;
  end loop;

  -- 4) Entitlement del SOLICITANTE (auth.uid()), nunca del owner de
  --    la mascota (punto 6). Advisory lock por usuario para que dos
  --    dispositivos del mismo usuario no gasten el mismo cupo a la vez
  --    (punto 7): la segunda llamada concurrente espera a que la
  --    primera confirme (o falle) antes de volver a contar cuántas
  --    solicitudes lleva este mes.
  perform pg_advisory_xact_lock(hashtext('ai_quota:' || auth.uid()::text)::bigint);

  select * into entitlement from public.get_ai_analysis_entitlement();

  if not entitlement.can_request then
    raise exception 'Has alcanzado tu límite mensual de análisis de IA (% de %)', entitlement.monthly_used, entitlement.monthly_limit;
  end if;

  -- 5) Crear la solicitud. used_full_history lo decide el backend
  --    (entitlement.would_use_full_history), nunca un parámetro del cliente.
  insert into public.ai_analysis_requests (pet_id, requested_by, photo_path, used_full_history, status)
  values (target_pet_id, auth.uid(), p_photo_path, entitlement.would_use_full_history, 'pending')
  returning id into new_request_id;

  foreach sid in array symptom_ids loop
    insert into public.ai_analysis_symptoms (analysis_id, symptom_id) values (new_request_id, sid);
  end loop;

  -- 6) Logro "primer análisis con IA" (backend-owned, ver 15).
  perform public.award_pet_achievement(target_pet_id, 'first_photo_scan');

  return new_request_id;
end;
$$;

revoke execute on function public.request_ai_analysis(uuid, text, uuid[]) from public, anon;
grant execute on function public.request_ai_analysis(uuid, text, uuid[]) to authenticated;
