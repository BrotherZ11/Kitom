# Agenda sin conexión (propuesta, sin implementar)

> **Estado: PROPUESTA (fase 13, 2026-10-28).** No hay código ni migración. La agenda sigue solo con
> conexión (decisión del 2026-10-21 en `docs/DECISIONS.md`). Implementarla exige aprobar antes el cambio
> de esquema de la sección «Backend» y una fase propia del frontend.

## Situación actual (auditada)

- Lecturas: TanStack Query en memoria. Sin conexión se ve lo ya cargado en esa sesión (con el aviso
  «Sin conexión») y nada tras un arranque en frío. No hay copia en `LocalStore`.
- Escrituras: solo con sesión utilizable y red (`auth.serverCall`); si no, fallan al instante con un
  mensaje. **Nada se guarda en el dispositivo**, así que no existen cambios pendientes: todo lo que se ve
  en la agenda es del servidor. Los avisos ya programados siguen sonando sin red.

## Qué falta para escribir sin conexión con garantías

| Operación | Hoy | Falta |
|---|---|---|
| Crear | `insert` sin clave del cliente; `authenticated` no tiene GRANT sobre `reminders.id` | Alta idempotente: si la respuesta se pierde, reenviar duplicaría el recordatorio |
| Editar / hecho / posponer | Precondición `eq('updated_at', base)`; conflicto = 0 filas | Suficiente (mismo patrón que Pets, fase 8). `updated_at` tiene resolución de microsegundos |
| Borrar | `delete … select('id')`; 0 filas = `ReminderChangedError` | 0 filas no distingue «ya borrado» de «sin permiso» ni de «mascota borrada»: hay que resolverlo como en Pets (releer y decidir) |
| Avisos | Calculados con datos del servidor | Calcular también con los cambios pendientes del dispositivo (si no, un recordatorio creado sin red no avisa) |
| Mascota local (id local, sin crear en el servidor) | No tiene agenda | Encadenar: el recordatorio espera a que el alta de la mascota se confirme |

## Backend (requiere aprobación y rama `db/`)

Mismo diseño que `pets.client_request_id` (migración `20261020135440`):

```sql
alter table public.reminders add column client_request_id uuid;
create unique index reminders_creator_client_request_id_key
  on public.reminders (created_by, client_request_id) where client_request_id is not null;
grant insert (client_request_id) on table public.reminders to authenticated;
```

Reenviar el mismo alta daría `23505` y el cliente leería la fila por su clave. No se propone
`GRANT INSERT (id)` por la misma razón que en Pets (ids de filas borradas reutilizables).

## Frontend (fase propia)

Reutilizar el patrón de Pets offline (fases 7–10): copia por usuario en `LocalStore` (lista por mascota),
operación local por recordatorio (`create` / `update` / `delete`) con su estado (pendiente, enviado sin
respuesta, conflicto, fallido, sin permiso), motor de sincronización con la precondición `updated_at`,
pantalla de conflictos y recuento en «Cambios sin sincronizar» y en el cierre de sesión
(`sign-out-provider.tsx`). Cada fila con un cambio del dispositivo se marca como «Guardado en este
dispositivo», distinta de los datos del servidor.

## Riesgos

- Repeticiones: «Hecho» sin conexión en dos dispositivos avanza la misma serie dos veces; la
  precondición lo convierte en conflicto, pero el usuario tendría que elegir.
- Avisos duplicados al confirmar un alta: el aviso local se programaría con un id provisional y luego con
  el del servidor; hay que migrar el identificador al confirmar.
- Coste: es la superficie más grande de la app después de Pets. Mientras la agenda no tenga copia local,
  la recomendación es mantenerla solo con conexión.
