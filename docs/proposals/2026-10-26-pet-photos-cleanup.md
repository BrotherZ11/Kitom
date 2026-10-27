# Propuesta — Limpieza de fotos de mascotas en Storage (backend)

> **Estado: PROPUESTA, sin aplicar.** Nada de esto existe en `supabase/migrations/` ni en
> `supabase/functions/`. Requiere aprobación explícita antes de crear la migración (rama `db/…`, PR
> propio) y la Edge Function. Origen: Pets offline, fase 10 (`docs/DECISIONS.md`, 2026-10-26).

## Problema

1. **Mascota eliminada.** Al borrar `pets`, la cascada borra sus filas (registros, análisis…), pero no
   los objetos del bucket `pet-photos` bajo `{pet_id}/`: la foto de perfil y las fotos de las consultas.
   El cliente no puede borrarlos después (la política `pet-photos: delete editors` exige
   `can_edit_pet(safe_pet_id_from_path(name))`, que ya es falso), ni debe borrarlos antes (la eliminación
   se puede deshacer o quedar en conflicto, y la foto seguiría referenciada).
2. **Objetos que la app no pudo cerrar.** El diario local (`offline/pet-photo-journal.ts`) deja `blocked`
   las rutas de mascotas que ya no ve. Solo existen en ese dispositivo.
3. (Opcional) **Distinguir «borrada» de «sin acceso»** al confirmar una eliminación: hoy, con RLS, no
   se puede.

La app ya no crea huérfanos en un fallo sin respuesta (fase 10), pero los dos primeros casos solo se
pueden resolver en el servidor.

## Diseño propuesto (caso 1)

Una cola en la base de datos y una Edge Function programada que borra la carpeta de las mascotas que
ya no existen. Nunca toca una mascota existente.

### Migración (borrador)

```sql
-- db/pet-photos-cleanup · PROPUESTA: no aplicar sin aprobación
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.pet_storage_cleanup (
  pet_id     uuid primary key,
  deleted_at timestamptz not null default now(),
  attempts   integer not null default 0,
  last_error text,
  done_at    timestamptz
);
revoke all on table private.pet_storage_cleanup from public, anon, authenticated;

create or replace function private.enqueue_pet_storage_cleanup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.pet_storage_cleanup (pet_id) values (old.id)
  on conflict (pet_id) do nothing;
  return old;
end;
$$;
revoke all on function private.enqueue_pet_storage_cleanup() from public, anon, authenticated;

create trigger trg_pets_enqueue_storage_cleanup
  after delete on public.pets
  for each row execute function private.enqueue_pet_storage_cleanup();
```

No cambia RLS ni las políticas de Storage, y el borrado de la mascota no espera a Storage.

### Edge Function `pet-photos-cleanup` (borrador)

- Clave `service_role` (secreto de la función, nunca en la app). Se invoca con una programación (cron
  de Supabase o `pg_cron` + `pg_net`, a decidir) y no es pública.
- Por cada fila con `done_at is null` (en lotes):
  1. Comprueba que `public.pets` no tiene esa `pet_id`. Si existe (p. ej. un id reutilizado, imposible
     con UUID, o una fila puesta a mano), no hace nada.
  2. Lista `pet-photos/{pet_id}/` con la API de Storage (paginada) y borra esos objetos con
     `storage.from('pet-photos').remove([...])`. No usa `delete from storage.objects` (Supabase lo
     bloquea y dejaría el archivo en el almacenamiento).
  3. Marca `done_at`; ante un error, `attempts + 1` y `last_error`.
- Idempotente: listar una carpeta vacía y volver a marcarla no tiene efecto.

### Pruebas previstas

- pgTAP (`supabase/tests/database/pet_storage_cleanup.test.sql`):
  - el borrado de una mascota por su propietario (RLS) encola su id; el `UPDATE` no;
  - borrar dos veces (o una cascada) no duplica la fila;
  - `anon` y `authenticated` no leen ni escriben la cola ni ejecutan la función.
- Edge Function (Deno, con un Storage falso): borra solo `{pet_id}/` de mascotas inexistentes; deja la
  carpeta de una mascota existente; reintento tras un fallo parcial; carpeta vacía.
- Local: el bucket `pet-photos` no existe en el Supabase local (pendiente conocido). Haría falta
  declararlo en `supabase/config.toml` (`[storage.buckets.pet-photos]`) con las mismas políticas para
  probarlo de punta a punta.

## Caso 2 (opcional, más delicado)

Borrar objetos de mascotas **existentes** que no referencia nada: `{pet_id}/…` con más de 24 h que no
son `pets.photo_path` ni ningún `ai_analysis_requests.photo_path`. Puede hacerse en la misma función,
pero solo después de una ejecución en modo informe (sin borrar) revisada a mano, porque cualquier nueva
referencia a ese bucket tendría que añadirse a la lista.

## Caso 3 (opcional)

Tabla `private.pet_deletions (pet_id, deleted_by, deleted_at)` llenada por el mismo trigger y una RPC
`pet_deleted_by_me(pet_id) returns boolean` (`security definer`, solo `deleted_by = auth.uid()`), para
que la app diga «eliminada» en lugar de «ya no estaba o ya no tienes acceso». No revela nada que el
usuario no supiera, pero añade una tabla y una función solo por un mensaje: prioridad baja.
