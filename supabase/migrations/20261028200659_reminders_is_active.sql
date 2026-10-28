-- =====================================================================
-- KITOM · reminders.is_active: activar y desactivar un recordatorio
-- =====================================================================
-- Recordatorios (fase 13): el usuario quiere pausar un recordatorio (p. ej.
-- una medicación interrumpida) sin borrarlo ni darlo por hecho. status solo
-- admite pending/completed/skipped: «hecho» y «pausado» son cosas distintas
-- (un pausado sigue pendiente cuando se reactiva) y reutilizar 'skipped'
-- cambiaría el significado de un valor que ya existe.
--
-- Cambios:
--  1. Columna is_active boolean NOT NULL DEFAULT true. Las filas existentes
--     quedan activas (default constante: sin reescribir la tabla).
--  2. GRANT INSERT (is_active), UPDATE (is_active) a authenticated (la tabla
--     tiene GRANT por columna para authenticated).
-- RLS, políticas y triggers sin cambios: solo los editores (can_edit_pet)
-- pueden escribirla ("reminders: insert editors" / "update editors") y la
-- ven los miembros ("select members"). anon conserva su GRANT de tabla de
-- siempre, sin filas visibles ni escribibles por RLS.
-- La columna no decide nada en el servidor: es una preferencia de la agenda
-- (el cliente no avisa ni cuenta como vencido un recordatorio inactivo).
-- =====================================================================

-- 1. Columna
alter table public.reminders add column is_active boolean not null default true;

comment on column public.reminders.is_active is
  'false = desactivado por el usuario: no avisa ni cuenta como vencido. No cambia status.';

-- 2. Grants por columna
grant insert (is_active), update (is_active) on table public.reminders to authenticated;
