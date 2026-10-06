-- ============================================================
-- KITOM v2.2 · 02 · FUNCIONES DE UTILIDAD — sin cambios vs v2.1
-- ============================================================
create or replace function public.trigger_set_timestamp()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

revoke execute on function public.trigger_set_timestamp() from public, anon, authenticated;

create or replace function public.safe_pet_id_from_path(object_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  first_segment text;
begin
  first_segment := (storage.foldername(object_name))[1];
  if first_segment is null
     or first_segment !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return null;
  end if;
  return first_segment::uuid;
exception when others then
  return null;
end;
$$;

revoke execute on function public.safe_pet_id_from_path(text) from public, anon, authenticated;
