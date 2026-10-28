# Limpieza de fotos de mascotas eliminadas en Storage (backend)

> **Estado: IMPLEMENTADO en la rama `db/pet-storage-cleanup` (fase 12B, 2026-10-27; revisión de
> seguridad 2026-10-28), sin aplicar en `kitom-dev`.** Migraciones `20261027194904_pets_photo_path_own_pet.sql`,
> `20261027194908_pet_storage_cleanup.sql` y `20261028114317_pet_storage_cleanup_guards.sql` aplicadas y
> probadas solo en el Supabase local (también desde cero, con `db diff --local`); Edge Function
> `supabase/functions/pet-storage-cleanup/` sin desplegar; programación (cron) sin configurar en ningún
> entorno. Aplicarlo es del usuario: ver «Revisión y aplicación» y «Despliegue». Origen: Pets offline,
> fase 10 (`docs/DECISIONS.md`, 2026-10-26); auditoría de la propuesta original: fase 12A.

## Problema

Borrar una mascota borra en cascada sus filas (registros, consultas…), pero no sus objetos de
`pet-photos/{pet_id}/…` (foto de perfil y fotos de las consultas). La app no puede borrarlos después (la
política `pet-photos: delete editors` exige `can_edit_pet`, ya falso) ni antes (la eliminación se puede
deshacer o quedar en conflicto, y la foto seguiría referenciada). Reemplazar o quitar la foto de una
mascota que existe ya lo resuelve la app (fase 10: precondición sobre `photo_path` y diario local); esto
cubre solo las mascotas borradas.

## Lo que la auditoría encontró en la propuesta original (y cómo se resuelve)

| Hallazgo (verificado contra el esquema y el código) | Solución |
|---|---|
| `pets.photo_path` no tenía validación: `authenticated` puede escribir cualquier texto, también `{otra_mascota}/x.jpg`. Borrar la carpeta de una mascota podía borrar una foto que otra usa | CHECK `pets_photo_path_own_pet` (abajo) y, además, la limpieza no borra nada que alguna fila referencie |
| `safe_pet_id_from_path` (la de las políticas) acepta el uuid en mayúsculas o mixto y no limita la profundidad: `{ID}/x.jpg` y `{id}/a/b/c.jpg` son de la mascota. `list('{pet_id}/')` en minúsculas y de un nivel no los ve | Los candidatos se buscan en SQL con `safe_pet_id_from_path(name) = pet_id`, la misma regla que las políticas. Comprobado con Storage real: la subida a `{ID en mayúsculas}/…` se acepta |
| supabase-js no puede leer el esquema `private` (PostgREST solo expone `public`) | RPC en `public` con `SECURITY DEFINER`, `search_path` vacío y EXECUTE solo para `service_role`; el esquema `private` no tiene USAGE para nadie |
| Una subida en curso puede crear la fila del objeto después del borrado | Plazo de verificación y verificación en el servidor (abajo, «Subidas tardías») |
| Dos ejecuciones podían procesar el mismo trabajo | Reserva con `FOR UPDATE SKIP LOCKED` y un token por reserva |
| `reminder-attachments` y `shared-reports` también usan `{pet_id}/` | Excluidos a propósito (abajo, «Alcance») |
| Sin límite de intentos, estado terminal, retención ni alerta; `verify_jwt` aceptaría el JWT de cualquier usuario | Estados `pending`/`done`/`failed`, 10 intentos sin progreso, retención de 90 días, auditoría; secreto propio de la función |
| Mascotas borradas antes del trigger: sin trabajo | La auditoría las cuenta; no se encolan (no hay carga inicial) |

## Diseño implementado

### 1. `pets.photo_path` (migración `20261027194904_pets_photo_path_own_pet.sql`)

CHECK `pets_photo_path_own_pet`: `NULL`, o exactamente `{id de la propia mascota}/{nombre}.jpg` — el
primer segmento es el id en texto (minúsculas), un solo nivel, nombre de 1–128 caracteres
`[A-Za-z0-9_-]` que no empieza por `-` ni `_`, extensión `.jpg` (la única que genera la app desde
73c388d: `{pet_id}/{uuid v4}.jpg`). Sin cambios de grants ni RLS. La migración cuenta antes las filas que
no cumplen y, si hay alguna, aborta sin cambiar nada (no corrige datos; la consulta para revisarlas está en
la cabecera de la migración). En el Supabase local no había ninguna.

### 2. Cola (migración `20261027194908_pet_storage_cleanup.sql`)

`private.pet_storage_cleanup_jobs`: `id`, `pet_id` (único), `deleted_at`, `status`
(`pending`/`done`/`failed`), `attempts`, `next_attempt_at`, `locked_until` + `lock_token` (reserva),
`verified_at`, `completed_at`, `objects_removed`, `last_error` (solo un código `[a-z_]`). RLS sin
políticas y sin grants para `anon`, `authenticated` ni `service_role`.

Trigger `AFTER DELETE` en `pets`: encola en la misma transacción que el borrado (si se revierte, no queda
trabajo). Un trabajo por mascota; si la misma `pet_id` vuelve a borrarse (solo posible a mano), el trabajo
se reabre.

### 3. RPC (solo `service_role`)

| RPC | Qué hace |
|---|---|
| `pet_storage_cleanup_claim(p_limit 1–10, p_lock_seconds 60–900)` | Reserva trabajos vencidos (`FOR UPDATE SKIP LOCKED`), un token nuevo, `attempts + 1`. Antes, pasa a `failed` (`max_attempts`) lo que agotó los intentos sin informar |
| `pet_storage_cleanup_objects(job, token, p_after, p_limit 1–1000)` | Con la reserva vigente: objetos de `pet-photos` de esa mascota, paginados por nombre, con `referenced` si `pets.photo_path` o `ai_analysis_requests.photo_path` los nombran (sin distinguir mayúsculas). Se niega si la mascota existe |
| `pet_storage_cleanup_report(job, token, p_removed, p_error)` | Libera la reserva y decide el estado; la verificación final (contar lo que queda) la hace el servidor |
| `pet_storage_cleanup_preview(p_limit)` · `_audit(p_limit)` | Solo lectura: lo que se borraría; carpetas de mascotas que ya no existen y su trabajo |
| `pet_storage_cleanup_purge()` | Borra los trabajos `done` de más de 90 días |

Garantías previas (`20261028114317_pet_storage_cleanup_guards.sql`, de la revisión de seguridad):
`claim`, `objects`, `report`, `preview` y `audit` empiezan por `private.pet_storage_cleanup_assert_ready()`,
que exige que su propietario vea `storage.objects` entero (superusuario, `BYPASSRLS` o propietario sin RLS
forzada) y que exista el CHECK `pets_photo_path_own_pet`. Si no, error
`pet_storage_cleanup_storage_not_visible` / `_photo_path_unchecked`: nada se reserva, lista ni termina.
Sin esto, un propietario que no se saltara RLS vería 0 objetos y daría por terminado un trabajo con todo en
su sitio; en el Supabase local `postgres` sí lo salta (integración), en otro entorno no está demostrado.

Reglas de `report`:
- Mascota existente → `failed` (`pet_exists`), nunca se lista ni se borra nada.
- Sin error, nada en la carpeta y han pasado 25 h desde el borrado → `done` (`verified_at`).
- Sin error, nada en la carpeta, antes de las 25 h → pendiente hasta `deleted_at + 25 h` (no es un fallo).
- Sin error pero con objetos aún → pendiente en 1 min (`objects_remaining`).
- Con error → pendiente con espera exponencial (5 min · 2ⁿ⁻¹, máximo 6 h); a los 10 intentos seguidos sin
  progreso, `failed` (terminal: lo revisa una persona). Borrar algo es progreso y reinicia los intentos.
- Un token que no es el de la reserva vigente (caducada y tomada por otra ejecución, o ya informada) se
  rechaza (`pet_storage_cleanup_lock_lost`).

### 4. Edge Function `pet-storage-cleanup`

`cleanup.ts` (lógica, sin Deno), `rest.ts` (RPC y Storage por HTTP, las mismas llamadas que supabase-js) e
`index.ts` (Deno). Para cada trabajo reservado: pide los candidatos por páginas de 200, vuelve a validar
cada uno (bucket `pet-photos` fijado en código, id de mascota del primer segmento igual al del trabajo,
nombre sin caracteres de control y de hasta 1024, `referenced === false`) y borra los válidos con la API de
Storage (`DELETE /storage/v1/object/pet-photos`, lotes de 100), nunca con SQL. Lo dudoso no se borra:
error recuperable (`invalid_object`, `object_referenced`). Un fallo de Storage se informa con lo ya
borrado; el reintento sigue con lo que queda. Presupuesto de 50 s por ejecución y reservas de 300 s.

**Invocación.** Solo `POST` con la cabecera `x-kitom-cleanup-secret` igual a `PET_STORAGE_CLEANUP_SECRET`
(≥ 32 caracteres, comparación sin cortocircuito). Sin el secreto configurado responde 503; con uno
incorrecto, 401, sin tocar la BD. `verify_jwt = false` en `config.toml`: un JWT de usuario no autoriza
nada aquí, y el secreto es más limitado que la clave de servicio (que se quedaría en la BD si la tarea
programada la enviara). Cuerpo opcional `{ "task": "process" | "audit", "batch": 1..10 }`; cualquier otra
clave (un bucket, una ruta) es 400.

**Modos.** `PET_STORAGE_CLEANUP_MODE=delete` borra; cualquier otro valor, o ninguno, es el modo informe:
`process` solo lee `preview`; `audit` solo lee (y en modo borrado, además, purga).

**Registros.** JSON con códigos y recuentos (`job`, `status`, `removed`, `error`): nunca rutas, URLs, el
secreto ni la clave.

### Subidas tardías

Comprobado en local (concurrencia, caso 5, y la integración con TUS):
- Una subida que empieza después de confirmarse el borrado la rechaza la política (la mascota ya no existe
  para `can_edit_pet`).
- Una subida reanudable (TUS) creada con la mascota viva y terminada después del borrado: Storage local
  responde 403 al terminarla (vuelve a evaluar la política) y no crea el objeto.
- Sí puede pasar, a nivel de BD, que la inserción de la fila del objeto evalúe la política con la mascota
  viva y confirme después del borrado: la fila aparece sin mascota. La ventana es la de esa transacción.

Política: nada se da por terminado hasta un listado vacío hecho **25 h o más** después del borrado (más que
la validez de 24 h de una subida reanudable). Una pasada temprana que no ve nada deja el trabajo pendiente
hasta entonces; si la verificación encuentra objetos, los borra y vuelve a comprobar. **Límite conocido:**
un objeto que apareciera después de un trabajo `done` no se detecta solo; la auditoría (`task: audit`) lo
cuenta como «carpeta de una mascota borrada con trabajo `done`» y reabrirlo es manual. Con lo comprobado,
eso exigiría una transacción de subida abierta más de 25 h.

### Alcance: buckets

- `pet-photos`: incluido. Existe en `kitom-dev` (privado; `docs/README.md` §18) y declarado para el local
  en `config.toml`. Propiedad (`{pet_id}/`, validada por las políticas) y ciclo de vida comprobados: sus
  referencias (`pets.photo_path`, `ai_analysis_requests.photo_path`) desaparecen con la mascota.
- `reminder-attachments`: **excluido**. La app no implementa adjuntos y no hay una retención definida.
- `shared-reports`: **excluido**. `generate-pet-report` no existe y no está decidido si un informe ya
  compartido con un veterinario debe sobrevivir a la mascota.
- `avatars` (por usuario, no por mascota): fuera de alcance.

## Pruebas

| Capa | Archivo | Qué cubre |
|---|---|---|
| pgTAP | `supabase/tests/database/pets_photo_path.test.sql` | CHECK: acepta NULL, `{id}/{uuid}.jpg`, `{id}/p1.jpg`; rechaza otra mascota, id en mayúsculas, subcarpetas, `..`, otras extensiones, nombres vacíos, largos o con `-` inicial, sin carpeta, URL; grants sin cambios |
| pgTAP | `supabase/tests/database/pet_storage_cleanup.test.sql` | Permisos (esquema, tabla, RPC, trigger), encolar al borrar, nada si se revierte o en un UPDATE, sin duplicados, reabrir; candidatos con mayúsculas, anidados, otro bucket y rutas mal formadas, referencias; reservas, caducidad y tokens; plazo de 25 h, espera exponencial, progreso, `failed`, caídas, mascota existente, parámetros; informe, auditoría y retención |
| Concurrencia | `supabase/tests/concurrency/pet_storage_cleanup_concurrency.sh` | 4 ejecuciones a la vez sin solapes; reserva retenida que no bloquea; sesión caída; reserva caducada; informes duplicados; subida durante el borrado |
| Unidad | `supabase/functions/pet-storage-cleanup/cleanup.test.mjs` | Validación de rutas y objetos, secreto, cuerpo, modos, paginación, anidadas y mayúsculas, otro bucket o mascota, referenciados, mascota existente, fallo parcial y reintento, trabajo repetido o terminado, reserva perdida, presupuesto, aislamiento entre trabajos, HTTP, adaptadores y registros sin secretos |
| Integración (local) | `supabase/functions/pet-storage-cleanup/cleanup.integration.test.mjs` (`run-integration.mjs`) | Auth, PostgREST, trigger, RPC y Storage reales: subidas del usuario (anidada y en mayúsculas), CHECK por la API, encolar, modo informe, borrado solo de esa mascota, otra intacta, plazo y verificación; subida TUS terminada tras el borrado |

## Revisión y aplicación (usuario)

1. Revisar las dos migraciones (PR propio `db/pet-storage-cleanup`; no mezclar con UI).
2. En el entorno de destino, antes de aplicar, la consulta de solo lectura de la cabecera de
   `20261027194904_pets_photo_path_own_pet.sql`. Si devuelve filas, no aplicar: decidir qué hacer con
   ellas (la migración abortaría de todas formas, sin cambios).
3. Aplicar las tres en orden (`db push` las aplica así y se detiene en la primera que falle). Sin el
   CHECK de la primera, la limpieza no trabaja (`pet_storage_cleanup_photo_path_unchecked`).
   Antes, comprobar también que el esquema `private` no existe ya con otros usos:
   `select nspname from pg_namespace where nspname = 'private'` (la migración le quita el USAGE a
   `anon`, `authenticated` y `service_role`).
4. Regenerar los tipos con `--linked` (las RPC nuevas aparecen en `public`; el cliente no las usa).

## Despliegue (primero en un entorno de pruebas autorizado, en modo informe)

1. Secretos: `PET_STORAGE_CLEANUP_SECRET` (≥ 32 caracteres aleatorios, solo en `supabase secrets set` y
   en Vault) y **sin** `PET_STORAGE_CLEANUP_MODE` (modo informe).
2. `functions deploy pet-storage-cleanup` (lee `verify_jwt = false` de `config.toml`).
3. Invocar a mano `process` y `audit`. Si responde 500 con `pet_storage_cleanup_storage_not_visible`, el
   propietario de las RPC no ve `storage.objects`: no seguir. Revisar en los registros: `referenced` y
   `pet_exists` deben ser 0;
   `foldersWithoutJob` son las mascotas borradas antes del trigger (no se tocan).
4. Borrar una mascota de prueba con fotos; a los 15 min el informe la muestra **con sus objetos (> 0)**.
5. `PET_STORAGE_CLEANUP_MODE=delete`; invocar a mano con `{"batch":1}`: solo desaparece esa carpeta, el
   trabajo queda pendiente hasta las 25 h y después `done`.
6. Solo entonces programarlo. Plantilla (no aplicada; requiere `pg_cron` y `pg_net`, que no están
   habilitados en las migraciones, y los valores en Vault, nunca en el repo):

```sql
select vault.create_secret('<URL del proyecto>', 'pet_storage_cleanup_url');
select vault.create_secret('<PET_STORAGE_CLEANUP_SECRET>', 'pet_storage_cleanup_secret');

select cron.schedule('pet-storage-cleanup', '*/15 * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'pet_storage_cleanup_url')
           || '/functions/v1/pet-storage-cleanup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-kitom-cleanup-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'pet_storage_cleanup_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000)
$$);
-- Auditoría y retención, una vez al día, con body := '{"task":"audit"}'::jsonb.
```

Trabajos atascados: `failed`, o `pending` con `deleted_at` de hace más de 2 días (consulta como
`postgres`). Reabrir un `failed` tras revisarlo: `update private.pet_storage_cleanup_jobs set status =
'pending', attempts = 0, last_error = null, next_attempt_at = now() where id = …`.

## Revisión de seguridad (2026-10-28)

Sin hallazgos críticos. Corregidos antes del PR: la comprobación de garantías de arriba (alto), la prueba
de aplicación desde cero (`db diff --local`), la prueba TUS (solo 204 con objeto o 403 de RLS), la
comprobación «exactamente 6 RPC» de pgTAP y el aislamiento del script de concurrencia. Abiertos (medio o
bajo): coste de las consultas con muchos objetos (cada llamada recorre `pet-photos` evaluando
`safe_pet_id_from_path`; la vista previa cruza trabajos × objetos): a revisar antes de producción; el
progreso de una ejecución que cae tras borrar no se registra (los intentos no se reinician); los rechazos sin
secreto se registran uno a uno; `config.toml` declara `pet-photos` sin límites (no usar `config push`); la
espera de 60 s de `pg_net` en la plantilla es justa; las claves nuevas (`sb_secret`) no se han probado.

## Pendiente

- Validación contra el Storage de un entorno real (el local reproduce las APIs, pero no los límites ni la
  configuración del bucket de `kitom-dev`, que no se han verificado).
- `pg_cron`/`pg_net`/Vault: no probados en local; la programación es una plantilla.
- Decidir qué hacer con las carpetas de mascotas borradas antes del trigger (la auditoría las cuenta).
- `reminder-attachments` y `shared-reports`, cuando exista su funcionalidad y una retención definida.
- (Opcional) Distinguir «eliminada» de «sin acceso» al confirmar una eliminación en la app: una tabla de
  borrados por usuario y una RPC; prioridad baja.
