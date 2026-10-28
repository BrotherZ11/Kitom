-- =====================================================================
-- KITOM · pets.photo_path solo puede apuntar a una foto de la propia mascota
-- =====================================================================
-- Problema: authenticated tiene INSERT/UPDATE (photo_path) en pets y la
-- columna no tiene ninguna validación (ai_analysis_requests.photo_path y
-- reminders.attachment_path sí la tienen, por trigger). Una mascota podía
-- apuntar a `{otra_mascota}/x.jpg` o a cualquier texto. La app nunca lo
-- hace, pero la limpieza de Storage de las mascotas eliminadas
-- (20261027194908_pet_storage_cleanup.sql) borra la carpeta de la mascota
-- borrada: con una referencia cruzada, borraría una foto en uso.
--
-- Cambio: CHECK `pets_photo_path_own_pet`. NULL, o exactamente
-- `{id de la propia mascota}/{nombre}.jpg`:
--  - el primer segmento es el id en texto (minúsculas, como lo devuelve
--    Postgres y lo usa la app), nunca otra mascota ni otra forma del uuid;
--  - un solo nivel: nada de subcarpetas;
--  - nombre de 1–128 caracteres [A-Za-z0-9_-] que no empieza por - ni _
--    (la app usa un uuid v4) y extensión `.jpg`, la única que genera la
--    app (`PET_PHOTO_EXTENSION`, desde 73c388d).
-- Un CHECK (no un trigger) porque solo mira la propia fila y es inmutable;
-- validado, para que ninguna fila antigua haga fallar después cualquier
-- UPDATE de esa mascota. Sin cambios de grants, RLS ni políticas.
--
-- Antes de añadirlo se cuentan las filas que no cumplen: si hay alguna, la
-- migración aborta sin cambiar nada (no corrige datos). Para revisarlas:
--   select id, photo_path from public.pets where photo_path is not null
--     and not (starts_with(photo_path, id::text || '/')
--              and substr(photo_path, 38) ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\.jpg$');
-- =====================================================================

do $$
declare
  incompatible bigint;
begin
  select count(*) into incompatible
  from public.pets
  where photo_path is not null
    and not (starts_with(photo_path, id::text || '/')
             and substr(photo_path, 38) ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\.jpg$');
  if incompatible > 0 then
    raise exception 'pets.photo_path: % fila(s) no cumplen {pet_id}/{nombre}.jpg; revisarlas antes de aplicar esta migración', incompatible
      using hint = 'pets_photo_path_incompatible_rows';
  end if;
end;
$$;

-- 36 caracteres del uuid + '/': el nombre empieza en la posición 38.
alter table public.pets
  add constraint pets_photo_path_own_pet check (
    photo_path is null
    or (starts_with(photo_path, id::text || '/')
        and substr(photo_path, 38) ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\.jpg$')
  );
