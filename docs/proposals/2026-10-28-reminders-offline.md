# Agenda sin conexión (propuesta, implementada)

> **Estado: aprobada el 2026-11-05 e implementada el 2026-11-06** (rama `db/integration-account-deletion-reminders`). La
> migración está probada en local y pendiente de `db push`. Lo implementado y sus límites:
> `docs/FRONTEND_ARCHITECTURE.md` §5 «Agenda sin conexión (fase 14)». Este documento queda como diseño y plan de pruebas.

## Por qué hace falta backend

Una alta cuya respuesta se pierde no se puede recuperar con seguridad con el esquema actual:

- `reminders` no tiene más índice único que la clave primaria y `authenticated` no tiene GRANT de INSERT
  sobre `id`: el cliente no puede fijar ni reconocer la fila que creó.
- `updated_at` no sirve: lo pone el servidor y solo protege filas que ya existen.
- Buscar una fila igual (mascota, título, fecha) no es una identidad. Daría por creada una fila que no es
  esa (dos recordatorios iguales son legítimos) y no encontraría la original si un co-tutor la editó, así
  que el reenvío la duplicaría.

Sin clave, lo único honesto sería dejar el alta incierta para siempre, con el riesgo de que el usuario la
repita. El resto de operaciones no necesita esquema nuevo.

## Garantías actuales del servidor (auditadas en las migraciones)

| Aspecto | Estado | Consecuencia |
|---|---|---|
| Permisos | RLS: leen los miembros (`is_pet_member`), escriben los editores (`can_edit_pet`); al crear, además `created_by = auth.uid()` | Sirve tal cual |
| GRANT por columna | INSERT: las editables, `pet_id`, `created_by`, `is_active`. UPDATE: las editables, `is_active`, `completed_at`. Sin `id` ni `updated_at` | Una columna nueva necesita su GRANT |
| Versión | Trigger `set_timestamp_reminders`; resolución de microsegundos | Vale como precondición, como en Pets |
| Editar | `update … eq('updated_at', base)` ya se usa | Sin cambios |
| Borrar | `deleteReminder` **no lleva precondición** | Se añade en el cliente (`eq('updated_at', base)`); no requiere esquema |
| `completed_at` | `sync_reminder_completion` respeta el valor enviado y solo pone `now()` si llega nulo | «Hecho» sin conexión puede conservar la hora real sin esquema nuevo |
| Mascota borrada | `ON DELETE CASCADE` | Sus recordatorios desaparecen; un alta posterior da 42501 |
| Pruebas | pgTAP de permisos e `is_active`. **Ninguna de concurrencia sobre `reminders`** | Se añade la suite |

Correcciones a la versión anterior de este documento: un borrado sin filas ya no da `ReminderChangedError`
(se relee la fila y se distingue con `ReminderNotWritableError`), y el borrado no tiene precondición.

## Backend (aprobado; rama `db/integration-account-deletion-reminders`)

Mismo diseño que `pets.client_request_id` (migración `20261020135440`, aplicada en `kitom-dev`). Migración real:
`supabase/migrations/20261105093545_reminders_client_request_id.sql`, probada en local.

```sql
-- 1. Clave que genera el cliente por alta (UUID v4). Las filas existentes y las altas online: NULL.
alter table public.reminders add column client_request_id uuid;

comment on column public.reminders.client_request_id is
  'Clave del cliente para un alta idempotente (UUID v4 por alta). NULL en altas sin clave. No se puede cambiar.';

-- 2. Única por creador y solo con clave: reenviar da 23505 y no se pueden probar claves de otras cuentas.
create unique index reminders_creator_client_request_id_key
  on public.reminders using btree (created_by, client_request_id)
  where client_request_id is not null;

-- 3. Solo INSERT: la clave no cambia después de crear.
grant insert (client_request_id) on table public.reminders to authenticated;
```

Sin cambios de RLS, políticas, triggers ni de `reminders.id`.

- **Compatibilidad:** columna opcional sin default, así que las versiones instaladas siguen funcionando. El
  índice no usa `CONCURRENTLY` porque `db push` va en transacción; la tabla es pequeña.
- **Exportación de datos:** no cambia, porque usa `REMINDER_COLUMNS` y la clave no se añadirá ahí.
- **Borrar la cuenta:** `created_by` pasa a NULL y esas filas no chocan en el índice (NULL es distinto de NULL).
- **`GRANT INSERT (id)`, descartado:** permitiría recrear una fila borrada con el mismo id, y es la misma
  razón por la que se rechazó en Pets.
- **Límite que se acepta:** si el alta se crea, la respuesta se pierde y otra persona la borra antes del
  reenvío, el reenvío la vuelve a crear (no duplica: la original ya no existe). Evitarlo exigiría lápidas en
  el servidor. El resultado es visible y se puede borrar, y no se pierden datos.

### Pruebas de la migración

`supabase/tests/database/reminders_client_request_id.test.sql` (pgTAP):

1. Esquema: columna `uuid` que admite NULL, definición exacta del índice y GRANT solo de INSERT.
2. `authenticated` sigue sin poder fijar `id`; las cuatro políticas de `reminders` siguen igual.
3. Alta con clave como editor: funciona con `insert … returning`.
4. Reenvío con la misma clave: 23505, queda una sola fila y se lee por `(created_by, client_request_id)`.
5. Altas sin clave: varias filas con NULL no chocan.
6. Actualizar la clave, o añadirla a una fila existente: 42501.
7. Otra cuenta con la misma clave en su mascota: no choca y no ve la fila ajena.
8. Lector o ajeno: 42501 aunque la clave ya exista (RLS actúa antes que el índice; es lo que evita filtrar claves).
9. Fila con `created_by` NULL (cuenta borrada): no impide otra alta con esa clave.

`supabase/tests/concurrency/reminders_concurrency.sh`, sobre el patrón de `pets_concurrency.sh`:

1. Dos altas con la misma clave: la segunda espera y recibe 23505 en el índice.
2. La primera hace ROLLBACK: la segunda crea la fila.
3. N altas simultáneas con la misma clave: se crea exactamente una.
4. Dos ediciones con la misma versión: la segunda toca 0 filas.
5. N ediciones simultáneas con la misma versión: se aplica exactamente una.
6. Borrado con precondición contra una edición simultánea: nunca se borra una versión que no se vio.

Flujo (`supabase/CLAUDE.md`): aprobación → migración en la rama `db/` → `migration up --local` (sin
`db reset`), pgTAP, concurrencia y `db diff --local` → PR propio → `db push` del usuario → tipos regenerados
con `--linked`. **El frontend no se publica antes del `db push`:** sin la columna, cada alta fallaría.

## Frontend (fase propia, solo tras aplicar la migración)

Sigue el patrón de Pets (fases 7–10): colecciones en `LocalStore` y un motor propio, con las piezas comunes
ya existentes (`sync-errors`, `sync-backoff`, `daily-log-version`, `sync-triggers`, `owner-session`,
`createDailyLogSyncSessions`, `sign-out-flow`). No se crea un motor genérico nuevo.

### Operación local

Una por recordatorio (`kitom:v1:<userId>:reminder-ops:<localId>`), siempre con `userId` y `petId`. Campos: `kind`
(`create` / `update` / `delete`), `content`, `baseRow`, `restore`, `operationId`, `status`, `attempts`,
`nextAttemptAt`, `lastError`, `inFlightSince` y `conflictRemote`. Ediciones consolidadas: mismo id, misma base y
contenido nuevo. Nada se marca confirmado sin la fila que devuelve el servidor.

| Estado pedido | Representación |
|---|---|
| Creación pendiente | `create` + `pending`; `localId` = `local-<uuid>`, `operationId` = `client_request_id` |
| Edición pendiente | `update` + `pending`; `baseRow` guarda la versión editada |
| Activar / desactivar | `update` en el que solo cambia `is_active` (consolidable y deshacible) |
| Eliminación pendiente | `delete` + `pending`, con `restore` para deshacerla |
| Sincronización en curso | `getSyncingKey()` (en memoria) e `inFlightSince` (persistido) |
| Resultado incierto | `pending` con `inFlightSince` ≠ null; no se puede descartar |
| Conflicto | `conflict` + `conflictRemote`; decide el usuario |
| Falta de permisos | `forbidden`; datos intactos, sin reintentos automáticos |
| Error recuperable | `pending` + `lastError` + `nextAttemptAt` (red y sesión no cuentan como intento) |
| Requiere intervención | `failed` (datos rechazados o intentos agotados) |
| Confirmada | Alta: `synced` (mapeo `localId → id`). Edición: se borra. Eliminación: `synced` (lápida) |

Grupos de campos para la fusión a tres bandas: contenido (`type`, `title`, `description`), fecha (`due_at`,
`recurrence_rule`, `snooze_until`), estado (`status`, `completed_at`) y activo (`is_active`). «Hecho» y «posponer»
también pasan por aquí: si siguieran solo con conexión, chocarían con una edición pendiente de la misma fila.

### Envío

- **Alta:** se anota `inFlightSince` y se inserta con la clave. Un 23505 de ese índice se resuelve leyendo por
  `(created_by, client_request_id)`; se comprueba además que `pet_id` coincide. Un reenvío nunca crea otra fila.
- **Edición:** `eq('updated_at', base)`. Con 0 filas se lee la fila: mismo contenido → confirmada (respuesta
  perdida); misma versión → sin permiso; otros campos → se reaplica sobre la versión nueva; los mismos campos
  con otro valor → conflicto.
- **Conflicto frente a permiso:** con otra versión, `rejection()` y Pets dicen «conflicto» aunque quien escribe
  haya perdido el permiso. Aquí se pregunta antes `can_edit_pet` (RPC existente), para no pedir que resuelva
  un conflicto a quien ya no puede escribir.
- **Eliminación:** con precondición. 0 filas → ya no está (se cierra), misma versión (sin permiso) o cambió
  (conflicto; nunca se borra lo que el usuario no vio).
- **Sesión:** cada petición con el token del dueño (`createOwnerAccessToken`); una instancia por usuario.
- **Pestañas o procesos:** cada envío es seguro en el servidor (clave en altas, precondición en lo demás). No
  hay coordinación local entre pestañas web: es el pendiente ya registrado para Daily Logs y Pets, y aquí solo
  puede causar un envío de más que termina en confirmación.

### Copia local y vistas

- Una entrada por recordatorio y marcas por alcance (lista general y agenda de cada mascota), con la marca de
  lectura de `pet-cache-repository.ts` (nunca retrocede). Sin URLs firmadas ni tokens.
- Vista combinada con estados distintos: `ready`, `local` (copia), `offline_unavailable` (nunca descargada, y
  se explica), `empty` (vacía **confirmada**) y `local_error`. Un fallo de red nunca borra la copia.
- Una consulta que llegue al tope de 300 filas no se marca como lista completa.
- Cada fila con cambio local lleva «Guardado en este dispositivo». Un id `local-…` nunca se pide al servidor
  (hoy `useReminder` lo enviaría y daría 22P02).

### Mascotas

- **Mascota sin crear en el servidor:** sigue sin agenda hasta que se confirme, como en Daily Logs. Evita
  encadenar dos motores.
- **Eliminación pendiente:** sus operaciones se retienen (no se envían), no avisa y no admite cambios. Se deriva
  de `withoutDeleted`, así que al deshacer o conservar la mascota en un conflicto todo vuelve solo.
- **Eliminación confirmada (lápida):** sus operaciones se cierran y no se envían; el servidor ya borró esas filas.
- **Borrada por otra persona o permiso revocado:** `forbidden`, se conserva y se explica; el usuario decide descartar.

### Avisos

Se siguen derivando del estado (`planNotifications` + `diffSchedule`, idempotente), ahora con la vista combinada,
lo que cubre reinicios, reconexiones y resolución de conflictos sin duplicados.

- **Hueco detectado:** hoy `NotificationPlanner` exige `canUseServer` y `notification_preferences`, que no tiene
  copia local. Con los datos del dispositivo, el plan cancelaría los avisos `daily-log:*`, porque `diffSchedule`
  cancela lo que no está en el plan. Se añade un alcance: sin conexión solo se tocan los `reminder:*`.
- **Alta local:** `reminder:<local-id>`. Al confirmarse, el mismo `diffSchedule` cancela ese id antes de
  programar el del servidor. El enlace de un aviso ya mostrado se resuelve con el mapeo.
- **Si falla la lectura del almacén:** no se cambia nada programado.
- **Sin cambios:** el tope de 60, el permiso denegado y el no-op de la web (`reminderNotifyState` sigue diciendo `web`).

### Cierre de sesión y pendientes

`SignOutSummary` añade `reminders`; `createAppSignOutFlow`, `signOutTotal`, `needsReview` y `useUnsyncedChanges`
los incluyen, y `(app)/daily-logs/unsynced` los lista. Un almacén ilegible cuenta como no sincronizado. La
copia solo se borra con el total a 0 (`clearLocalUserData`, sin cambios).

## Plan de pruebas (20 casos pedidos)

U = unitaria con servidor falso (`fake-reminder-server.mjs`) · I = integración contra el Supabase local · C = `reminders_concurrency.sh`
· M = manual.

| # | Caso | Nivel |
|---|---|---|
| 1 | Primera carga online y persistencia | U, I |
| 2 | Reinicio offline con copia | U, I |
| 3 | Offline sin copia | U |
| 4 | Crear offline y sincronizar una vez | U, I |
| 5 | Editar offline y sincronizar | U, I |
| 6 | Activar/desactivar offline | U, I |
| 7 | Eliminar offline | U, I |
| 8 | Respuesta perdida tras crear | U, I (23505 real) |
| 9 | Conflicto entre dos sesiones | U, I |
| 10 | Pérdida de permisos antes de sincronizar | U, I (RLS real) |
| 11 | Cambio de cuenta con pendientes | U, I |
| 12 | Cierre de sesión con pendientes | U |
| 13 | Fallo de lectura/escritura de `LocalStore` | U |
| 14 | Reinicio con operaciones inciertas | U, I |
| 15 | Avisos durante las transiciones | U, M (dispositivo) |
| 16 | Mascota con eliminación pendiente y conflicto | U, I |
| 17 | Fechas, repeticiones y zona horaria | U |
| 18 | Aislamiento entre usuarios y mascotas | U, I |
| 19 | Duplicados o sincronización simultánea | U, I, C |
| 20 | Recuperar conexión en primer y segundo plano | U (disparadores), M |

Manual: emulador Android con build nativa (avisos reales, reinicios y red que vuelve en segundo plano, con la
agenda; la señal de red ya se validó en la fase 11) y web (sin avisos).

## Riesgos

- **«Hecho» en dos dispositivos sin conexión:** si calculan la misma próxima vez, coincide y se fusiona; si no,
  la precondición lo convierte en conflicto.
- **Coste:** es la mayor superficie de la app después de Pets.

## Decisiones (aprobadas el 2026-11-05)

1. **Migración y límite** de la sección «Backend»: aprobados.
2. **Permiso sin conexión:** se guarda el último `can_edit_pet` confirmado por mascota, solo como indicación de interfaz.
   - `true`: se permite encolar cambios sin conexión.
   - `false`: se bloquean.
   - Sin valor conocido: solo lectura.
   - Si el permiso se revoca sin conexión, la operación puede quedar pendiente; RLS la rechaza al sincronizar y pasa a
     `forbidden`. No se pierde ni se descarta automáticamente.
   - Nunca se trata como autorización del servidor.
