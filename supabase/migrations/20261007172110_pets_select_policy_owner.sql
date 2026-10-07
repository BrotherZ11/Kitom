-- =====================================================================
-- KITOM · pets: la política SELECT comprueba primero al propietario
-- =====================================================================
-- Problema: INSERT ... RETURNING (insert().select() de supabase-js) aplica
-- también la política SELECT a la fila nueva, ANTES de que exista en la
-- tabla. "pets: select members" solo usaba is_pet_member(id), que busca la
-- mascota en pets, no la encuentra y la comprobación falla:
--   42501 new row violates row-level security policy for table "pets"
-- Crear una mascota desde la app era imposible.
--
-- Solución: comprobar owner_id = auth.uid() directamente sobre la fila (no
-- necesita leer la tabla) antes de is_pet_member(id). Mismo conjunto de filas
-- visibles: is_pet_member ya incluía al propietario; los co-tutores aceptados
-- siguen viendo la mascota por is_pet_member. Sin cambios de grants ni datos.
-- =====================================================================

alter policy "pets: select members" on public.pets
  using ((owner_id = auth.uid()) or public.is_pet_member(id));
