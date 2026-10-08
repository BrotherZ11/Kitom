# Decisiones técnicas

Registro breve de decisiones técnicas relevantes: contexto, decisión y consecuencias. Las más
recientes, arriba. El detalle de cada contrato vive en su documento de referencia.

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
