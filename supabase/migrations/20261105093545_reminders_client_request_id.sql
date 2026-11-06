-- =====================================================================
-- KITOM · reminders.client_request_id: alta idempotente desde el cliente
-- =====================================================================
-- Agenda sin conexión (fase 14): un recordatorio creado sin conexión se envía
-- al volver la red. Si el servidor lo crea pero la respuesta se pierde (red
-- cortada, tiempo agotado), el cliente no puede saber si existe: authenticated
-- no puede fijar reminders.id (no tiene GRANT de INSERT sobre id) y no hay otra
-- restricción única, así que repetir el INSERT podría duplicarlo. Buscar una
-- fila igual no es una identidad: dos recordatorios iguales son legítimos y un
-- co-tutor puede haber editado el original.
--
-- Mismo diseño que pets.client_request_id (migración 20261020135440). Se
-- descartó GRANT INSERT (id): permitiría recrear una fila borrada con su id.
--
-- Cambios:
--  1. Columna client_request_id uuid (nullable): la genera el cliente por alta
--     (UUID v4) y la envía en el INSERT. Las filas existentes y las altas
--     online siguen con NULL.
--  2. Índice único (created_by, client_request_id) para las filas con clave:
--     reenviar la misma alta da 23505 (reminders_creator_client_request_id_key)
--     y el cliente lee la fila por su clave. Ligada al creador: no se pueden
--     probar claves de otras cuentas. RLS se evalúa antes que el índice: quien
--     ya no puede escribir recibe 42501, no 23505.
--  3. GRANT INSERT (client_request_id) a authenticated. Sin UPDATE: la clave no
--     cambia después de crear.
-- RLS, políticas, triggers e id sin cambios. La clave es visible para quien ya
-- puede ver el recordatorio (SELECT de tabla): es un UUID aleatorio sin
-- información.
-- Límite aceptado: si el recordatorio se creó, se perdió la respuesta y otra
-- persona lo borró antes del reenvío, el reenvío lo vuelve a crear (no duplica:
-- el original ya no existe). Evitarlo exigiría lápidas en el servidor.
-- =====================================================================

-- 1. Columna
alter table public.reminders add column client_request_id uuid;

comment on column public.reminders.client_request_id is
  'Clave del cliente para un alta idempotente (UUID v4 por alta). NULL en altas sin clave. No se puede cambiar.';

-- 2. Única por creador (solo filas con clave)
create unique index reminders_creator_client_request_id_key
  on public.reminders using btree (created_by, client_request_id)
  where client_request_id is not null;

-- 3. Grants por columna: solo INSERT
grant insert (client_request_id) on table public.reminders to authenticated;
