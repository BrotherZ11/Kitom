-- =====================================================================
-- KITOM · pets.client_request_id: alta idempotente desde el cliente
-- =====================================================================
-- Pets offline (fase 8): una mascota creada sin conexión se envía al
-- volver la red. Si el servidor la crea pero la respuesta se pierde (red
-- cortada, tiempo agotado), el cliente no puede saber si existe: authenticated
-- no puede fijar pets.id (no tiene GRANT de INSERT sobre id) y no hay otra
-- restricción única, así que repetir el INSERT podría duplicarla.
--
-- Se descartó dar GRANT INSERT (id): los objetos de Storage de una mascota
-- borrada se quedan en {pet_id}/…, y quien conociera ese id (p. ej. un
-- antiguo co-tutor) podría crear otra mascota con el mismo id y pasar
-- is_pet_member sobre esas fotos.
--
-- Cambios:
--  1. Columna client_request_id uuid (nullable): la genera el cliente por
--     alta (UUID v4) y la envía en el INSERT. Las filas existentes y las
--     altas online siguen con NULL.
--  2. Índice único (owner_id, client_request_id) para las filas con clave:
--     reenviar el mismo alta da 23505 (pets_owner_client_request_id_key) y
--     el cliente lee la fila por su clave. Ligada al propietario: no se
--     pueden probar claves de otras cuentas.
--  3. GRANT INSERT (client_request_id) a authenticated. Sin UPDATE: la clave
--     no cambia después de crear.
-- RLS, políticas, triggers e id sin cambios ("pets: insert own" sigue
-- exigiendo owner_id = auth.uid()). La clave es visible para quien ya puede
-- ver la mascota (SELECT de tabla): es un UUID aleatorio sin información.
-- Límite: si la mascota se creó y otro dispositivo la borró antes de que
-- este recupere la respuesta, el reenvío la vuelve a crear (no duplica: la
-- original ya no existe).
-- =====================================================================

-- 1. Columna
alter table public.pets add column client_request_id uuid;

comment on column public.pets.client_request_id is
  'Clave del cliente para un alta idempotente (UUID v4 por alta). NULL en altas sin clave. No se puede cambiar.';

-- 2. Única por propietario (solo filas con clave)
create unique index pets_owner_client_request_id_key
  on public.pets using btree (owner_id, client_request_id)
  where client_request_id is not null;

-- 3. Grants por columna: solo INSERT
grant insert (client_request_id) on table public.pets to authenticated;
