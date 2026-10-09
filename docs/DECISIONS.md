# Decisiones técnicas

Registro breve de decisiones técnicas relevantes: contexto, decisión y consecuencias. Las más
recientes, arriba. El detalle de cada contrato vive en su documento de referencia.

## 2026-10-08 — Daily Logs frontend (fase 1): registro de hoy, online

**Decisión.**
- "Hoy" se calcula solo en `features/daily-logs/log-date.ts`: día del calendario con `Intl` en la zona
  del perfil → dispositivo → `UTC`. Nunca `toISOString()` (en Madrid daría el día siguiente entre las
  00:00 y las 02:00). La pantalla fija la fecha al abrirse para que el registro en curso no cambie de
  día si se cruza la medianoche.
- Una pantalla por día con el registro completo: abrir no crea nada; guardar envía todos los campos
  a `save_daily_log` (la RPC sustituye el registro). La fila devuelta se pasa al formulario y a la
  caché; un refetch posterior no pisa lo que el usuario está editando.
- Escalas sin valor inicial; volver a tocar la opción elegida la deja en `null` (sin indicar).
  «Todo como siempre» solo rellena el formulario.
- La nota de comportamiento inusual no se envía con el interruptor desactivado: el campo no se ve y
  no debe guardarse texto oculto (se conserva en pantalla por si se reactiva).
- Tipos de la RPC: los generados no admiten `null` en parámetros de función; `SaveDailyLogArgs`
  lo corrige solo para los parámetros que la RPC acepta y se convierte en un único punto de la API.
- Permisos solo como UX con `can_edit_pet` (lo mismo que Pets); sin lógica por `owner_id`.

**Consecuencias.** Un co-tutor en otra zona horaria calcula "hoy" con la suya, pero la BD valida con
la del propietario: alrededor de medianoche podría recibir `invalid_date` (los co-tutores aún no
tienen UI; pendiente una RPC tipo `pet_local_today`). Contrato: `FRONTEND_ARCHITECTURE.md` §4.

## 2026-10-08 — Zona horaria del perfil: NULL = sin configurar e inicialización desde el dispositivo

**Contexto.** `profiles.timezone` ya existía (`text NOT NULL DEFAULT 'UTC'`) y su trigger convertía
`NULL` en `'UTC'`: no se podía distinguir "nunca configurada" de "el usuario está en UTC", así que la
app no podía inicializarla sin pisar una elección real. Además `pg_timezone_names` acepta abreviaturas
y alias (`CET`, `GMT+0`, `EST5EDT`, `posix/…`), en contra del contrato documentado.

**Decisión** (migración `20261008155257_profile_timezone.sql`; sin columna nueva).
- `timezone` admite `NULL` y no tiene default. `NULL` = sin configurar; el servidor sigue usando `UTC`
  donde necesita un "hoy" (`coalesce`, sin cambios en `daily_logs`).
- Los `'UTC'` existentes pasan a `NULL`: siempre eran el default (no hay pantalla para elegirla).
- Validación sin catálogo propio: el trigger exige `UTC` o Área/Ubicación existente en
  `pg_timezone_names`, y solo valida cuando el valor cambia (guardar lo mismo es un no-op y un valor
  heredado no bloquea editar el resto del perfil). La app aplica la misma regla, más `Intl`.
- Inicialización en la app: una vez por usuario y arranque, `update … where id = $user and timezone
  is null`. La condición en la propia consulta hace el guardado atómico e idempotente y garantiza que
  nunca se sobrescribe un valor existente (sin leer antes). Si no hay zona válida o falla, no se hace
  nada y la app sigue.
- Detección con `Intl.DateTimeFormat().resolvedOptions().timeZone`, sin dependencias nuevas
  (`expo-localization` no está instalado y no aporta nada para esto).
- RLS y grants sin cambios: `authenticated` ya tenía `UPDATE (timezone)` y `profiles: update own`.

**Consecuencias.** Si el usuario viaja, el perfil conserva la zona inicial hasta que exista un ajuste
manual (Settings, pendiente). Pruebas: `supabase/tests/database/profile_timezone.test.sql` y
`frontend/src/features/profile/timezone.test.mjs` (`npm test`, runner de Node sin dependencias).

## 2026-10-08 — Daily logs: un registro por día, guardado por RPC y reglas de contenido en la BD

**Contexto.** `daily_logs` existía desde la baseline (columnas = PRD §8.3), pero ninguna escritura
funcionaba (`recompute_pet_streak` sumaba `date + bigint`), el upsert documentado necesitaba UPDATE
sobre columnas inmutables, y borrar una mascota con 2+ registros violaba la FK de `pet_streaks` (el
trigger de rachas recalculaba durante la cascada).

**Decisión** (migración `20261008150202_daily_logs_fixes.sql`).
- Un único registro por mascota y día (`UNIQUE (pet_id, log_date)`): es el estado general del día, la
  clave natural sirve de idempotencia offline y el cliente no envía `id`. Sin síntomas en el MVP: son
  del flujo de IA (PRD §8.4) y no se crea `daily_log_symptoms`.
- El registro es de la mascota: owner y editores aceptados crean, editan y borran cualquier registro;
  `viewer` solo lee. RLS sin cambios. `last_edited_by` registra la última modificación.
- Guardado con `save_daily_log` **SECURITY INVOKER**: aplica la RLS y los grants de quien llama; pone
  `logged_by = auth.uid()` solo al crear; sustituye el registro completo. UPDATE y después INSERT
  (con reintento ante `unique_violation`), no `INSERT … ON CONFLICT`: los triggers BEFORE INSERT se
  ejecutan antes de detectar el conflicto y la ventana de fechas impediría editar registros antiguos.
- Escalas 1–5 sin valor por defecto (un 3 inventaría datos): relativas a lo habitual para energía,
  apetito, actividad, vocalización e interacción social; de calidad para ánimo y sueño. La escala no
  está en la BD (los CHECK 1–5 ya existían); es contrato de la UI y de la futura IA.
- Fechas: crear solo entre hoy y hoy − 7 en la zona del propietario (limita rellenar rachas a
  posteriori); editar sin límite; `log_date` inmutable (sin GRANT de UPDATE + trigger). Si el perfil
  del propietario no tiene zona sincronizada, vale `UTC` (default de `profiles.timezone`).
- Sin registros vacíos (`daily_logs_not_empty_check`): al menos un nivel, comportamiento inusual
  marcado o descrito, una nota con texto o una etiqueta.
- Tags de lista cerrada en un CHECK (`vet_visit`, `home_change`, `new_pet`, del PRD §8.3): añadir uno
  requiere migración, a cambio de que la IA y los informes reciban siempre códigos conocidos. Se
  descartó una tabla de catálogo con traducciones por ser excesiva para tres valores.
- Límites de texto: no había ningún criterio previo en la app. `notes` ≤ **2000** caracteres (unas
  300 palabras: holgado para un diario y acotado para el contexto de la IA) y
  `unusual_behavior_notes` ≤ **1000** (describe una sola conducta). Se cuentan caracteres, no bytes.
- Rachas: solo se corrigió el tipo (`rn::integer`). Al borrar un registro durante la cascada del
  borrado de la mascota no se recalcula (su racha se borra con ella), lo que hace el borrado
  independiente del orden de cascada, que depende de los OID de cada entorno.
- Grants: `anon` sin nada; `authenticated` sin TRUNCATE/REFERENCES/TRIGGER/MAINTAIN ni UPDATE de
  `log_date`.

**Consecuencias.** Un registro nuevo creado offline que tarde más de 7 días en sincronizarse se
rechaza. Con 8 días de ventana se puede ganar `streak_7` rellenando la semana anterior (aceptado).
Hasta sincronizar `profiles.timezone` desde el frontend, los usuarios por delante de UTC no pueden
registrar "hoy" entre su medianoche y la medianoche UTC. Pruebas: `supabase/tests/database/daily_logs.test.sql`.
Contrato: `FRONTEND_ARCHITECTURE.md` §4 «DailyLogScreen» y §5.

## 2026-10-07 — Fotos de mascota: JPEG ≤ 1600 px, path único por subida y referencia antes que archivo

**Contexto.** `pets.photo_path` y el bucket privado `pet-photos` (con políticas por `pet_id`) ya
existían. Las políticas llaman a `safe_pet_id_from_path`, cuyo EXECUTE estaba revocado a
`authenticated`, así que ninguna operación de Storage podía funcionar.

**Decisión.**
- Migración mínima `20261007182429_grant_safe_pet_id_from_path.sql`: solo `grant execute` a
  `authenticated`. Sin cambiar políticas ni buckets; la autorización sigue en `can_edit_pet` /
  `is_pet_member`.
- Formato de salida único **JPEG** (`image/jpeg`, `.jpg`): lo decodifican Android, iOS, web y los
  proveedores de IA; HEIC no se ve en web y WebP con pérdida no es universal en los modelos. Entrada
  aceptada: JPEG, PNG, WebP, HEIC/HEIF; el resto (GIF, archivos no imagen) se rechaza.
- Lado mayor ≤ **1600 px**, calidad **0.8**, sin recorte: ~200–800 KB, nitidez suficiente para un
  perfil y para reutilizar la foto en un análisis de imagen (los modelos de visión suelen reducir a
  ~1500 px). Límites duros: 25 MB de entrada, 5 MB de salida.
- Path `{pet_id}/{uuid}.jpg`: compatible con las políticas, sin datos personales y sin colisiones.
  Como no hay política UPDATE, cambiar la foto sube un objeto nuevo y borra el anterior **después** de
  actualizar `photo_path`.
- Al quitar la foto se limpia primero `photo_path` y luego se borra el objeto: un fallo parcial deja
  como mucho un objeto huérfano, nunca una referencia rota.
- Se descartó subir la foto dentro del formulario de datos: un fallo de Storage no debe bloquear la
  edición de la mascota.

**Consecuencias.** Pueden quedar objetos huérfanos (fallos parciales y mascotas borradas); pendiente
una limpieza en backend. En web solo se ofrece la galería. Contrato: `FRONTEND_ARCHITECTURE.md` §4.

## 2026-10-07 — Razas en el frontend: pregunta progresiva y payload siempre coherente

**Decisión.**
- La raza se pregunta en dos pasos: estado (*Con raza* / *Mestizo* / *Sin raza*) y, solo con raza,
  buscador del catálogo (nombre y alias, sin tildes) u «Otra / no aparece» (texto libre). Sin elegir
  nada queda `breed_status = NULL`; «Prefiero no indicarlo ahora» vuelve a ese estado. Nunca se
  convierte «sin contestar» en `unknown`.
- `toPetFields` genera siempre una de las cinco combinaciones válidas del CHECK, aunque el estado del
  formulario conserve restos (id o texto) de una opción anterior.
- Al cambiar de especie se descarta la raza concreta (catálogo o texto) y vuelve a «sin contestar»;
  mestizo y desconocida se conservan porque siguen siendo válidos para cualquier especie.
- El buscador pinta como máximo 25 resultados y pide afinar la búsqueda; sin texto muestra el
  catálogo en orden alfabético.

## 2026-10-07 — Razas: catálogo por especie, raza opcional y estado explícito

**Contexto.** `pets.breed` era texto libre: no permitía distinguir «sin contestar», «no sé» y
«mestizo», ni relacionar la raza con conocimiento clínico, ni impedir una raza de otra especie.

**Decisión** (migración `20261007152630_breeds.sql`).
- Tabla `breeds` ligada a `species` (`UNIQUE (species_id, code)`); nombres y alias en
  `catalog_translations` (`entity_type = 'breed'`), sin sistema de traducciones paralelo.
- `pets.breed_id` nullable y `pets.breed_status` (`known | mixed | unknown`, `NULL` = no preguntado).
  «Mestizo» y «No sé» son estados, no razas ficticias. Se descartó resolverlos solo en la UI porque
  todos acabarían en `NULL` y se perdería información útil para el perfilado progresivo y la IA.
- CHECK `pets_breed_status_check`: `known` exige exactamente uno de `breed_id` (catálogo) o `breed`
  (texto libre para razas no catalogadas); el resto de estados exige ambos `NULL`.
- Integridad especie ↔ raza con **FK compuesta** `pets (breed_id, species_id) → breeds (id, species_id)`,
  sin trigger: imposible asociar una raza de otra especie y cambiar la especie falla mientras haya
  una raza incompatible.
- `breeds` es de solo lectura para `authenticated` (RLS + `revoke all`/`grant select`); las razas no se
  borran, se desactivan con `is_active`.

**Consecuencias.** El frontend debe vaciar la raza al cambiar de especie y añadir `breed_id`/
`breed_status` a sus columnas de lectura y escritura (siguiente tarea). Catálogo y criterios: `SEED.md`.

## 2026-10-07 — Pets: RLS decide la visibilidad y las escrituras envían solo columnas editables

**Contexto.** `pets` se comparte entre propietario y co-tutores (`pet_co_owners`). La seguridad está
en tres capas de BD: GRANT por columna (sin UPDATE de `owner_id`), RLS (`is_pet_member`,
`can_edit_pet`, borrado solo del propietario) y triggers (`protect_pet_structural_fields`,
`validate_pet_birth_date`).

**Decisión.**
- Las lecturas no filtran por `owner_id`: RLS devuelve propias y compartidas.
- Corrección (migración `20261007172110`): la política SELECT pasa a ser
  `owner_id = auth.uid() OR is_pet_member(id)`. Con solo `is_pet_member(id)`, `INSERT … RETURNING`
  fallaba (42501) porque la política SELECT se evalúa sobre la fila nueva antes de que exista en la
  tabla. Las filas visibles no cambian.
- `owner_id` lo fija la capa de datos con el usuario de la sesión al crear; nunca sale del formulario
  y nunca se envía en un update. Las escrituras construyen el payload con una lista explícita de
  columnas editables (`pets-api.ts`), así que propiedades extra no llegan a Supabase.
- Las acciones de la UI se ocultan con `can_edit_pet` (editar) y `owner_id === user.id` (borrar), solo
  como UX. Un update o delete que RLS filtra (0 filas) se trata como `not_allowed`.
- `is_active` (archivar) y `photo_path` (subida) no se exponen todavía.

**Consecuencias.** Las mascotas compartidas funcionarán sin cambios cuando se implementen las
invitaciones. Contrato completo: `FRONTEND_ARCHITECTURE.md` §4 «Pets».

## 2026-10-07 — Auth: flujo PKCE y deep links con esquema `kitom`

Ver `AUTH.md` §2. Los enlaces de email y el retorno de Google vuelven a `/auth-callback` con un `code`
de un solo uso que solo sirve en el dispositivo que inició el flujo.
