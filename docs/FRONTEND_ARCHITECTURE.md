# Kitom — Frontend Architecture (v2.2.1)

Documento de referencia para empezar el frontend sin tener que releer el SQL. Stack: React Native + Expo + TypeScript + Supabase.

---

## 1. Navegación

```
AUTH (stack, sin sesión)
├── Welcome
├── Login
├── Register
└── ForgotPassword

ONBOARDING (stack, sesión activa, onboarding_completed_at = null)
├── ProfileSetup
├── Disclaimer            (acepta -> profiles.disclaimer_accepted_at + disclaimer_version)
├── CreatePet
├── PetBasics              (especie, nombre, foto)
└── PetHealthInfo          (raza, nacimiento, peso... perfilado progresivo, no bloqueante)

APP (tabs, sesión activa, onboarding completo)
├── Home                   (selector de mascota activa + resumen)
├── PetOverview
│   ├── DailyLog
│   ├── History
│   ├── Reminders
│   ├── AIAnalysis
│   ├── Achievements
│   └── CoOwners
├── Profile
│   └── Settings
└── Paywall                (modal, no tab — se abre desde cualquier punto bloqueado)
```

Destinos lógicos. **Implementado (diseño v2, F2–F5)** con Expo Router; las URL anteriores no cambian:

```
(auth)  welcome · onboarding · login · register · forgot-password · auth-callback   (+ update-password)
(app)   Stack, sin cabecera nativa (cada pantalla lleva su TopBar)
├── (tabs)  barra Hoy · Historial · [Registrar] · Agenda · Perfil
│   ├── index        /            Hoy (mascota activa)
│   ├── history      /history     Historial de la mascota activa
│   ├── agenda       /agenda      «Próximamente» (sin recordatorios todavía)
│   └── profile      /profile     Perfil de la mascota activa
├── pets/index, pets/new, pets/[id] (perfil), pets/[id]/edit
├── pets/[id]/daily-log                 registro de hoy (modal a pantalla completa)
├── pets/[id]/daily-logs                historial de esa mascota
├── pets/[id]/daily-logs/[date]         detalle del día; `?edit=1` lo edita
├── pets/[id]/daily-logs/resolve/[date] · daily-logs/unsynced · sign-out
└── settings                             Tu cuenta (mínima)
```

«Registrar» es una acción, no una pestaña: abre `pets/[id]/daily-log` de la mascota activa (punto sol si
hoy falta; «Hecho» si ya está). La mascota activa es un React Context (`features/pets/active-pet-context.tsx`)
que se recuerda por usuario en el dispositivo; si ya no es visible, se usa la primera.
`unstable_settings.initialRouteName = '(tabs)'`: un enlace directo deja las pestañas debajo. Decisión:
`DECISIONS.md` (2026-10-19).

## 2. Estados de Auth

**Implementado (sesión):** `loading` → `signed_in` | `offline` | `signed_out` (`features/auth/auth-state.ts`).
`offline` = sesión guardada de un usuario identificado que Supabase no ha podido renovar ni comprobar
(sin conexión): se ve la app con sus datos locales y no se usa el servidor. Detalle: §5 «Arranque en
frío sin conexión». El onboarding sigue pendiente.

```
loading                 -> splash, comprobando sesión
unauthenticated          -> stack AUTH
authenticated_onboarding -> stack ONBOARDING (profiles.onboarding_completed_at IS NULL)
ready                     -> stack APP
```

Derivar así (no guardar como estado aparte, calcularlo de lo que ya viene de Supabase):

```ts
type AuthState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | { status: 'onboarding'; profile: Profile }
  | { status: 'ready'; profile: Profile; subscription: Subscription };
```

`activePet` y `permissions` (rol sobre la mascota activa: `owner` derivado de `pets.owner_id === session.user.id`, o `co_owner.role`) viven en el store de la app, no en el de auth — dependen de qué mascota está seleccionada, que puede cambiar sin recargar sesión.

## 3. Server state vs local state

| Tipo | Ejemplos | Dónde vive |
|---|---|---|
| Server state | `pets`, `daily_logs`, `reminders`, `subscriptions`... | React Query / TanStack Query (o SWR), nunca en un store global manual |
| Local UI state | tab activo, formulario abierto, texto en curso | `useState` local al componente |
| Offline persistence | `daily_logs` creados sin conexión; copia de solo lectura de `pets` | ver sección 5 |
| Derived state | "¿tengo acceso de edición a esta mascota?", "¿me queda cupo de IA?" | calculado a partir de server state, nunca duplicado a mano |

No se introduce Redux ni una capa de estado global adicional — con React Query + Context para sesión/mascota activa es suficiente para el alcance actual.

## 4. Contrato de datos por pantalla

### AuthScreens (Login/Register/ForgotPassword)
- **READ:** —
- **WRITE:** `supabase.auth.signIn/signUp/resetPasswordForEmail`
- **RPC / Edge Function / Storage:** ninguno

### ProfileSetup / Disclaimer (onboarding)
- **READ:** `profiles` (propia)
- **WRITE:** `profiles` (`full_name`, `locale`, `timezone`, `disclaimer_accepted_at`, `disclaimer_version`, `onboarding_completed_at` al terminar)
- **RPC:** ninguno
- **Storage:** ninguno todavía (el avatar se sube más adelante, no bloqueante)

### CreatePet / PetBasics / PetHealthInfo
- **READ:** `species` (`is_active = true`) + `catalog_translations` (`entity_type='species'`) para el selector
- **WRITE:** `pets` (insert; columnas físicas se pueden completar después, perfilado progresivo)
- **RPC:** ninguno
- **Storage:** `pet-photos` (insert, path `{pet_id}/{uuid}.jpg`; ver «Pets: fotos»)

### Pets: lista, alta, detalle, edición y borrado (implementado)
Rutas: `(app)/pets/index`, `pets/new`, `pets/[id]/index`, `pets/[id]/edit` y la pestaña `/profile`.
Código: `frontend/src/features/pets/`. La ficha `/pets/[id]` es el perfil (`PetProfile`) con, además, el
registro de hoy de esa mascota (`TodayLogCard`, aunque no sea la activa), todos sus datos (`PetDetails`,
también los no indicados) y el cambio de foto desde la cabecera. Diseño v2 (tableros 3.1–3.3, 3.6–3.11): alta con nombre y especie
obligatorios y el resto opcional ya al crear («Otro» explica que, por ahora, perros y gatos; la foto se
elige antes y se sube al crear, porque el path necesita el id); perfil con foto, datos, «Completa el
perfil» (9 datos opcionales, `pet-profile.ts`) y racha; edición con hoja de foto, borrado con diálogo y
aviso «Cambios guardados». En la edición la especie se muestra bloqueada; «¿Te has equivocado? Cambiar
la especie» pide confirmación (la raza concreta se borra al cambiarla, como ya hacía el formulario) y
muestra las especies; nada se guarda hasta «Guardar cambios». La BD lo permite (`species_id` tiene GRANT
de UPDATE y la FK compuesta con `breeds` impide una raza de otra especie). La mascota creada pasa a ser la activa.
- **Racha (READ, solo lectura):** `pet_streaks` (`current_streak`, `longest_streak`, `last_log_date`;
  RLS `pet_streaks: select members`). La calcula el servidor al guardar registros y no la pone a 0 si
  pasan días sin registrar: el cliente la da por terminada si `last_log_date` es anterior a ayer
  (`currentStreak`). Query key `['pets','detail',petId,'streak']`.
- **READ:** `pets` con columnas explícitas (`PET_COLUMNS`) y **sin filtrar por `owner_id`**: RLS
  (`is_pet_member`) devuelve las propias y las compartidas con `pet_co_owners.status = 'accepted'`. Lista
  y ficha en `api/pets-remote.ts`, con el token del usuario fijado en la cabecera y a través de la copia
  sin conexión (§5 «Pets sin conexión (fase 7)»). Especies: `species` (todas, para
  poder mostrar una ya desactivada) + `catalog_translations` (`entity_type='species'`, `field='name'`,
  `locale` activo), combinadas en el cliente porque la tabla de traducciones es polimórfica (sin FK).
- **WRITE (insert):** columnas editables + `owner_id = auth user id` tomado de la sesión, nunca del
  formulario (`pets: insert own`), y `client_request_id` (clave del alta idempotente, migración
  `20261020135440`). `id`, `is_active`, `photo_path` y timestamps no se envían. Se pide la fila creada
  (`RETURNING`), lo que requiere que la política SELECT acepte al propietario directamente (migración
  `20261007172110`). Desde la fase 8 el alta se guarda primero en el dispositivo y la envía el motor
  (`api/pet-writes-remote.ts`; §5 «Pets: altas y ediciones sin conexión (fase 8)»).
- **WRITE (update):** solo columnas editables: `name`, `species_id`, `sex`, `breed`, `birth_date`,
  `weight_kg`, `sterilized`, `known_conditions`, `allergies`, `temperament_notes`. `owner_id` no tiene
  GRANT de UPDATE (transferencia solo por `transfer_pet_ownership`). Desde la fase 8, con la precondición
  `updated_at = <versión editada>` y desde el motor de sincronización: 0 filas = otra versión, sin
  permiso (RLS, `can_edit_pet` falso) o no existe, y se decide leyendo la fila (§5, fase 8).
- **Raza:** `breeds` activas filtradas por `species_id` + `catalog_translations` (`entity_type='breed'`,
  `field='name'` y `field='aliases'` con valores separados por `|`), combinadas en
  `features/pets/api/breeds-api.ts`. Para mostrar la raza guardada se pide por id (aunque esté
  desactivada). En `pets`, combinaciones que envía la app (CHECK `pets_breed_status_check`):

  | Estado en la UI | `breed_status` | `breed_id` | `breed` |
  |---|---|---|---|
  | Sin contestar (por defecto) | `NULL` | `NULL` | `NULL` |
  | Con raza → del catálogo | `known` | id | `NULL` |
  | Con raza → «Otra / no aparece» | `known` | `NULL` | texto |
  | Mestizo / mezcla | `mixed` | `NULL` | `NULL` |
  | Sin raza / desconocida | `unknown` | `NULL` | `NULL` |

  Al cambiar la especie en el formulario se descarta una raza concreta (catálogo o texto) y vuelve a
  «sin contestar»; mestizo y desconocida se conservan (`pet-form.ts` → `withSpecies`). La FK compuesta
  rechaza igualmente una raza de otra especie (`23503`).
- **DELETE:** solo el propietario (`pets: delete owner`); 0 filas borradas = `not_allowed`. Borra en
  cascada `daily_logs`, `reminders`, `ai_analysis_requests`, `pet_achievements`, `pet_streaks`,
  `pet_co_owners` y `pet_shared_reports`; la UI pide confirmación explícita. Con registros diarios,
  el borrado requiere la migración `20261008150202` (antes violaba la FK de `pet_streaks`). Los objetos de Storage
  de la mascota (`{pet_id}/…`) **no** se borran: tras el borrado `can_edit_pet` ya es falso y el
  cliente no puede hacerlo. Pendiente: limpieza en backend (trigger o Edge Function).
- **RPC:** `can_edit_pet(pet_id)` solo para decidir si mostrar «Editar» (UX); «Eliminar» se muestra si
  `owner_id` es el usuario (UX). La autorización real es RLS.
- **Storage:** `pet-photos`, ver «Pets: fotos».
- **Query keys:** `['pets',userId,'list']`, `['pets',userId,'detail',id]`,
  `['pets',userId,'detail',id,'can-edit']`, `['pets',userId,'detail',id,'streak']`, copias del
  dispositivo `['pets',userId,'local',…]`, `['pets','photo',path]`, `['species',locale]`,
  `['breeds','list',speciesId,locale]`, `['breeds','detail',breedId,locale]`, operaciones del dispositivo
  `['pets',userId,'local','operations']`. Crear/editar/borrar
  invalidan la lista y actualizan o eliminan el detalle (y la copia local). La caché se vacía al
  cambiar de usuario (AuthProvider).
- **Errores** (`features/pets/pet-errors.ts`, por código y nombre de constraint): `42501` → `not_allowed`,
  `PGRST116` → `not_found`, `23503` → `invalid_breed` (`pets_breed_species_fkey`) o `invalid_species`,
  `23514` → `invalid_breed` (`pets_breed_status_check`), `invalid_weight` (`pets_weight_kg_check`) o
  `invalid_value`, `P0001` de `validate_pet_birth_date` → `birth_date_future`, fallo de red → `network`.

### Pets: fotos (implementado)
En la ficha (`pets/[id]/index`), componente `PetPhotoEditor`, independiente del formulario de datos.
Código: `features/pets/pet-photo.ts` (límites y path), `pet-photo-picker.ts` (permisos, galería/cámara,
validación, resize/compresión), `api/pet-photos-api.ts` (Storage) y `hooks/use-pet-photo.ts`.
- **Bucket:** `pet-photos` (privado). Políticas existentes: SELECT `is_pet_member`, INSERT/DELETE
  `can_edit_pet`, ambas sobre `safe_pet_id_from_path(name)`; sin UPDATE. Requiere la migración
  `20261007182429_grant_safe_pet_id_from_path.sql` (EXECUTE de `safe_pet_id_from_path` a `authenticated`).
- **Path:** `{pet_id}/{uuid}.jpg` (primer segmento = mascota, lo que leen las políticas; uuid nuevo en
  cada subida, sin `upsert`). Se guarda en `pets.photo_path` (path, nunca URL), que solo escribe
  `updatePetPhotoPath` (update de una columna, separado de `updatePet`).
- **Imagen:** entrada JPEG/PNG/WebP/HEIC/HEIF (≤ 25 MB); salida siempre JPEG, lado mayor ≤ 1600 px,
  calidad 0.8, ≤ 5 MB. Sin recorte. Decisión: `DECISIONS.md`.
- **Subir / cambiar:** subir objeto nuevo → `photo_path` = nuevo → borrar el anterior. Si falla la
  subida no se toca `photo_path`; si falla el update se borra el objeto recién subido; si falla el
  borrado del anterior queda huérfano (best-effort, aviso en dev).
- **Quitar:** `photo_path = NULL` primero (RLS `can_edit_pet`) → borrar el objeto. Nunca queda una
  referencia a un archivo inexistente; en un fallo parcial queda, como mucho, un objeto huérfano.
- **Mostrar:** `createSignedUrl` (1 h) con query `['pets','photo',path]`: se firma una vez por path y
  se renueva a los 50 min; `expo-image` cachea por path (`cacheKey`), no por URL. Nunca `getPublicUrl`.
- **Permisos:** se piden al pulsar la acción. Denegado → mensaje y reintento; si no se puede volver a
  preguntar, botón «Abrir ajustes». Cancelar la selección no es un error.
- **Web:** solo «galería», con un `<input type="file">` propio (`pickFileOnWeb`) y no
  `launchImageLibraryAsync`: la librería solo resuelve en `change`, así que cancelar el diálogo dejaba
  la UI bloqueada para siempre. No hay permisos que pedir; en móvil web el navegador puede ofrecer la cámara.
- **Errores:** `camera_permission`, `gallery_permission`, `camera_unavailable`, `invalid_image_type`,
  `image_too_large`, `image_processing_failed`, `photo_upload_failed`, `photo_update_failed`,
  `photo_delete_failed`, `photo_url_failed`, `photo_storage` (5xx), además de `not_allowed` (401/403,
  RLS) y `network`. Mapeo de Storage en `toPetPhotoError`.
- **IA (futuro):** `request_ai_analysis` exige un `photo_path` del mismo bucket con el `pet_id` de la
  mascota; el flujo de análisis puede reutilizar `pickPetPhoto` y subir con la misma convención.

### Home / PetOverview
**Hoy implementado** (`(app)/(tabs)/index.tsx`, tableros 4.1–4.6, 5.8, 5.10, 12.1/12.2):
- **READ:** `pets` (vía `ActivePetGate`), la primera página del historial combinado
  (`useWeekOverview` → `computeWeekOverview`, `features/daily-logs/week-overview.ts`: los 7 días que
  terminan hoy, servidor + pendientes del dispositivo sin duplicar), `can_edit_pet` y el nombre del
  perfil (saludo del primer día). La racha de Hoy sale de esos registros y solo se dice si se puede
  afirmar con lo cargado (`streak: null` si llega al registro más antiguo y hay más páginas).
- **Muestra:** cabecera con selector de mascota (hoja 3.9), tarjeta del día (anillo, mensaje, valores de
  hoy, crear/editar), «Así verás su evolución» con menos de 3 registros o «Su semana» (energía, apetito
  y ánimo; último valor tal cual) desde 3. Avisos: sin conexión, sesión sin comprobar y registros sin
  sincronizar. Aviso «El registro de hoy ya está subido» cuando, con la pantalla abierta, pasa de
  pendiente a sincronizado. Sin mascotas: tablero 3.10.
- **No se muestra** (sin datos o sin servicio): señales/alertas, «Consultar», voz de la mascota, idea del
  día y «Próximo» de la agenda.
- **WRITE:** — · **RPC:** ninguno

### DailyLogScreen
Backend: migraciones `20261008150202_daily_logs_fixes.sql` y
`20261010160332_daily_logs_concurrency.sql`. Frontend: registro de hoy e historial, con guardado
local y sincronización (§5 «Integración»). Decisiones: `DECISIONS.md`.

**Implementación.** Ruta `(app)/pets/[id]/daily-log` (registro de **hoy**, modal a pantalla completa);
se abre con «Registrar» de la barra, la tarjeta del día de Hoy o «Registrar hoy» del historial. Código:
`frontend/src/features/daily-logs/`: `api/daily-logs-api.ts`, `hooks/use-daily-log.ts`,
`hooks/use-today-log-date.ts`, `hooks/use-week-overview.ts`, `log-date.ts`, `daily-log-form.ts` (valores,
validación, payload y estado del editor), `scale-labels.ts` (textos de las escalas), `daily-log-errors.ts`,
`query-keys.ts`, `types.ts`, `components/` (`DailyLogEditor`, `PrimaryScaleSelector`/`DetailScaleSelector`,
`TagSelector`, `DailyLogSavedScreen`, `DayDetail`, `SyncStatus`). Pruebas: `*.test.mjs` (`npm test`).
- **Pantallas (diseño v2):** 5.1 escalas principales (progreso «n/4», «Todo como siempre» solo al
  crear), 5.2 «Añadir detalles» (sueño, vocalizaciones, con personas y otros animales, algo fuera de lo
  habitual, etiquetas y nota), 5.3 «Hecho» tras crear el de hoy, aviso «Cambios guardados» tras editar,
  5.6 error de guardado con lo marcado intacto y 5.7 «¿Salir sin guardar?» con cambios (X, «atrás»
  del sistema o gesto: `hooks/use-leave-confirmation.ts`).
- **Validación:** al **crear** (no hay nada de ese día ni en el servidor ni en el dispositivo) son
  obligatorias las 4 principales (energía, apetito, ánimo, actividad; error `primary_required`). Al
  **editar** se mantiene «no vacío». Los detalles nunca bloquean guardar. Son reglas del cliente: la BD
  sigue exigiendo solo `daily_logs_not_empty_check`.
- **Detalles con 3 opciones:** sueño «Peor / Normal / Mejor», vocalizaciones y con personas y otros
  animales «Menos / Normal / Más», guardadas como **2/3/4** (mismas columnas y rango 1–5). Un 1 o un 5
  guardado antes no se convierte: no se marca ninguna opción, se dice cuál era y se conserva si no se
  elige otra; en el historial y el detalle se muestra con su texto de 5 niveles.
- **"Hoy":** solo `useTodayLogDate()` / `todayLogDate()`: día del calendario (`Intl`, nunca
  `toISOString`) en la zona del **perfil** → la del **dispositivo** si es `NULL`/no válida → `UTC`. La
  pantalla fija la fecha al abrirse (el registro que se rellena no cambia de día); la tarjeta de la
  ficha la recalcula al volver a primer plano.
- **Abrir:** vista combinada servidor + dispositivo (`useDailyLog`, §5 «Integración»): lo pendiente en
  el dispositivo prevalece; sin pendientes, la fila del servidor (con conexión se espera hasta 3 s);
  sin conexión o si el servidor tarda, la última copia local, indicándolo, y si no hay ninguna,
  formulario vacío (solo hoy). Nunca crea nada al abrir. Una versión que llega después solo sustituye
  los valores si el usuario no ha tocado nada (§5 «Endurecimiento»).
- **Guardar:** valida, guarda **en el dispositivo** (`useSaveDailyLog` → `engine.saveLocal`, mutación
  con `networkMode: 'always'`), muestra «Guardado en este dispositivo.» y el estado «Pendiente de
  sincronizar», y pide sincronizar. El envío a `save_daily_log` lo hace el motor (§5), siempre con
  precondición. El formulario solo se bloquea durante la escritura local, nunca por la red. Botón
  deshabilitado + `createSubmitGuard` (`lib/submit-guard.ts`) contra dobles toques. Error local:
  «No se pudo guardar en este dispositivo» (`local_save_failed`), sin perder lo escrito.
- **Estado de sincronización** (`components/sync-status.tsx`, bajo el formulario): Sincronizado,
  Pendiente de sincronizar, Sincronizando, Conflicto pendiente de resolver, No se pudo sincronizar;
  con explicación y «Reintentar» cuando aplica. «Sincronizado» solo cuando el servidor confirmó o la
  reconciliación demostró que ya tiene ese contenido.
- **Tipos:** los generados marcan todos los parámetros de la RPC como no nulos; `SaveDailyLogArgs`
  (`types.ts`) admite `null` en niveles y notas y se convierte al tipo generado solo en la API.
- **«Todo como siempre»:** pone las 4 escalas principales en 3 en el formulario; no guarda ni toca
  los detalles ni lo opcional. Tocar una opción ya elegida la deja en `null`.
- **Comportamiento inusual:** la nota solo se envía con el interruptor activado (el campo no se ve si
  está desactivado).
- **Permisos (UX):** `can_edit_pet` (`useCanEditPet`). Sin permiso: formulario de solo lectura (o
  «Todavía no hay registro de hoy»), sin botones de guardar. RLS/RPC siguen siendo la autoridad.
- **Query keys:** `['daily-logs','detail',userId,petId,logDate]` (`null` = no existe; historial:
  `['daily-logs','history',userId,petId]`; todas las de Daily Logs llevan el usuario, ver §5 «Sesión»),
  `['profile','timezone']`.
- **READ:** `pets`, `daily_logs` (del día, si existe, para precargar el formulario). `SELECT`: miembros
  (`is_pet_member`, incluye `viewer`).
- **WRITE (crear y editar):** solo `rpc('save_daily_log', { p_pet_id, p_log_date, p_energy_level,
  p_appetite_level, p_mood_level, p_activity_level, p_sleep_quality, p_vocalization_level,
  p_social_interaction_level, p_unusual_behavior, p_unusual_behavior_notes, p_notes, p_tags })`. Todos los
  parámetros son obligatorios: guarda el **registro completo** del día (`NULL` = dato no indicado) y
  devuelve la fila. Identidad `(pet_id, log_date)`: si existe lo actualiza, si no lo crea; es
  idempotente. `logged_by` lo pone el servidor al crear y se conserva al editar; `last_edited_by` y
  `updated_at` los ponen triggers. **No usar `upsert`** de supabase-js: hace `SET` de `pet_id`/`logged_by`,
  que no tienen GRANT de UPDATE (`42501`). Solo owner y editores (`can_edit_pet`).
- **Concurrencia (migración `20261010160332_daily_logs_concurrency.sql`; el motor de sincronización
  envía siempre una de las dos):** dos parámetros opcionales, como mucho uno por llamada (`22023` si llegan los
  dos). `p_expected_updated_at` = `updated_at` de la fila leída: edita solo esa versión.
  `p_expect_absent: true`: crea solo si no existe registro de ese día. Si no se cumple, `P0001` con
  `hint` `daily_log_conflict` y `details` `version_mismatch` (otro guardado cambió la fila),
  `row_missing` (se borró) o `row_exists` (ya existía); HTTP 400 y nada escrito. Tras un conflicto
  hay que leer la fila: si su contenido es el que se envió (respuesta perdida de un envío anterior),
  ya está guardada.
  - **La versión es la cadena original.** PostgREST devuelve `updated_at` con microsegundos
    (`2026-10-10T16:14:12.851355+00:00`; omite los ceros finales, así que puede traer menos de seis
    decimales: `…:26.89152+00:00`) y la comparación en el servidor es exacta. Guardarla y
    reenviarla **tal cual llegó**, como `string`: nunca convertirla con `new Date(…)`,
    `toISOString()` ni librerías de fechas, que la truncan a milisegundos. Si se trunca, la versión
    no coincide nunca: cada guardado da conflicto (no se pierden datos, pero la sincronización no
    avanza).
  - **Sin precondición = gana el último guardado.** Sin ninguno de los dos parámetros la RPC
    sustituye el registro sin comprobar la versión y puede pisar en silencio el guardado de otro
    dispositivo o co-tutor. El frontend ya no la usa (desde la fase 2 del modo offline); se mantiene
    en el backend por compatibilidad con builds anteriores. Cada envío lleva
    `p_expected_updated_at` (editar lo que se leyó) o `p_expect_absent` (crear).
- **DELETE:** `delete().eq('pet_id', …).eq('log_date', …)`; owner y editores, también registros que
  creó otra persona. 0 filas = `not_allowed`. Recalcula la racha.
- **Campos:** niveles `smallint` 1–5, empiezan en `NULL` (nunca 3 por defecto). Energía, apetito,
  actividad, vocalización e interacción social son **relativos a lo habitual** (1 mucho menos · 2 menos ·
  3 como siempre · 4 más · 5 mucho más); ánimo y sueño son **calidad** (1 muy malo … 5 muy bueno).
  `unusual_behavior` (bool) + `unusual_behavior_notes` (≤ 1000 caracteres), `notes` (≤ 2000), `tags`
  de la lista cerrada `vet_visit`, `home_change`, `new_pet` (la RPC quita duplicados y espacios
  sobrantes; solo espacios = sin nota). Prohibido el registro vacío (CHECK `daily_logs_not_empty_check`).
- **Fechas:** al crear, `log_date` entre hoy y hoy − 7 en la zona horaria del **propietario**
  (`profiles.timezone`; `UTC` si no se ha sincronizado). Editar: sin límite de antigüedad. `log_date`
  no se puede cambiar (para "mover" un registro: borrar y crear).
- **Errores:** `42501` → `not_allowed` (viewer, ajeno, mascota inexistente o sin sesión); `P0001` con
  `hint` `log_date_future` / `log_date_too_old` → `invalid_log_date`; `23514` → valor inválido (nombre de
  la constraint en el mensaje: `daily_logs_*_check`, incluido `daily_logs_not_empty_check` y
  `daily_logs_tags_check`); fallo de red → `network`. Precondiciones: `P0001` con `hint`
  `daily_log_conflict` → conflicto; `22023` → se enviaron las dos a la vez. En la sincronización se
  clasifican con `classifySyncError` (§5).
- **Storage:** ninguno

### HistoryScreen
**Historial implementado** (diseño v2, tableros 6.1, 6.2, 6.3, 6.5 y 12.3; sin borrado, alertas ni
límite del plan). Componente `PetHistory` (`features/daily-logs/components/pet-history.tsx`), lógica pura
en `history-view.ts`.
- **Rutas:** pestaña `/history` (mascota activa), `(app)/pets/[id]/daily-logs` (una mascota) y
  `(app)/pets/[id]/daily-logs/[date]` (detalle del día, `date` = `YYYY-MM-DD` validada con
  `parseLogDateParam`; `?edit=1` abre su edición).
- **Semana:** 5 series (energía, apetito, ánimo, actividad, sueño) con color y trazo propios, como mucho
  3 a la vez; los 7 días que terminan hoy, con huecos sin interpolar. «Día a día»: los 7 días (los que
  faltan, «Sin registro»; hoy, con «Registrar hoy») y después el resto de registros cargados.
- **Mes:** calendario (días con registro, hoy) y una línea por serie con los días del mes hasta hoy;
  carga sola las páginas que falten hasta el día 1 (`needsOlderPages`). Sin conexión, solo lo del
  dispositivo.
- **Menos de 3 registros:** «Su evolución aparecerá aquí» (6.5) con la lista de lo que hay.
- **READ (lista):** `daily_logs` filtrado solo por `pet_id` (RLS `is_pet_member` decide el acceso:
  owner y co-tutores aceptados; pendientes y ajenos reciben una lista vacía), `order(log_date desc)`,
  **paginación por cursor**: `lt('log_date', cursor)` + `limit(HISTORY_PAGE_SIZE + 1)` (20 por página; la
  fila sobrante indica que hay más). Usa `UNIQUE (pet_id, log_date)` / `idx_daily_logs_pet_date`. Código:
  `features/daily-logs/daily-log-history.ts` (`queryHistoryPage`, `toHistoryPage`, `flattenHistory`),
  `useDailyLogHistory` (`useInfiniteQuery`). Carga progresiva con «Cargar registros anteriores».
- **Resumen por día:** fecha **guardada** (`formatLogDateLabel`, con año si no es el actual; nunca
  recalculada con la zona actual), escalas indicadas con su texto corto, etiquetas, «Algo fuera de lo
  habitual» y «Con notas». Sin puntuaciones agregadas ni interpretaciones (`summarizeDailyLog`).
- **Lista combinada:** las páginas del servidor con los cambios pendientes del dispositivo encima,
  sin duplicar días (`resolveDailyLogHistory`); cada día pendiente, fallido o en conflicto muestra su
  estado. Un registro creado sin conexión aparece en su sitio si cae en lo ya cargado. Sin conexión
  se muestra lo guardado en el dispositivo (aviso arriba, sin «cargar más»); sin conexión y sin nada
  local, error (nunca una lista vacía engañosa). Al cargar páginas se guarda una copia local de cada
  fila sin cambios pendientes.
- **Un registro:** vista combinada por (`pet_id`, `log_date`). Si no existe, «No hay registro de este
  día» (nunca crea; sin conexión y sin copia local, error). Si existe, detalle de solo lectura
  (`DayDetail`: escalas con 5 marcas y texto, detalles, nota, etiquetas, quién y a qué hora lo
  registró según `logged_by`/`created_at`/`updated_at`) y, si `can_edit_pet`, «Editar este día» →
  `?edit=1` con `DailyLogEditor` (aviso de día anterior). Guardar = igual que hoy (local + motor), con
  la fecha original (la RPC edita sin límite de antigüedad).
- **Tras sincronizar** (hoy o histórico): la fila confirmada pasa a la caché del registro y a la del
  historial (`applyLocalChangeToCache`); si ese día no estaba cargado, se revalida el historial.
- **Errores:** primera página → `ErrorState` con reintento; «cargar más» → mensaje bajo la lista sin
  perder lo cargado. Mapeo con `toDailyLogError`.
- **WRITE:** solo `save_daily_log` con precondición, desde el motor (ver «DailyLogScreen» y §5). Sin
  borrado en esta fase.

### RemindersScreen
- **READ:** `reminders`
- **WRITE:** `reminders` (insert/update sobre columnas permitidas — nunca `pet_id`/`created_by`/`created_at`)
- **RPC:** ninguno
- **Storage:** `reminder-attachments` (insert/delete)

### AIAnalysisScreen
- **READ:** `pets`, `ai_analysis_requests` (columnas públicas solamente — `select('*')` fallará a propósito), `symptoms_catalog` + `symptom_species` (filtrado por especie), `ai_analysis_symptoms`
- **WRITE:** ninguna escritura directa sobre campos internos de IA
- **RPC:** `get_ai_analysis_entitlement()` (antes de mostrar el botón), `request_ai_analysis(pet_id, photo_path, symptom_ids)`, `submit_ai_feedback(analysis_id, feedback, comment)` — **solo puede modificar el feedback de sus propias solicitudes** (`requested_by = auth.uid()`); un co-tutor puede ver el análisis de otro pero no valorarlo por él
- **Edge Function:** `ai-analysis-process(analysis_id)`, invocada justo después de que el RPC devuelva el `analysis_id`. **Importante para frontend:** esta llamada NO es un mero "disparo y olvido" confiando en que `request_ai_analysis()` ya autorizó todo — la Edge Function vuelve a validar el JWT y `requested_by` por su cuenta en cada invocación; si el frontend la reintenta o la llama para un `analysis_id` ajeno, recibirá `403 not_authorized`
- **Storage:** `pet-photos` (insert, antes de llamar al RPC)

### AchievementsScreen
- **READ:** `pet_achievements`, `achievements_catalog`, `catalog_translations` (`entity_type='achievement'`)
- **WRITE:** ninguna — se otorgan solos en el backend

### CoOwnersScreen
- **READ:** `pet_co_owners`, `pets`; con la migración `20261023082848`: `get_my_pet_invitations()` (invitaciones
  pendientes con el nombre de la mascota y de quien invita) y `get_pet_members(pet_id)` (co-tutores con su nombre)
- **WRITE:** ninguna directa
- **RPC:** `invite_pet_member_by_email(pet_id, email, role)` (el cliente no conoce ids de otros usuarios; responde
  igual exista o no la cuenta: decir «Si tiene cuenta en Kitom, le llegará la invitación»), `accept_pet_invitation`,
  `decline_pet_invitation`, `revoke_pet_invitation`, `change_pet_member_role`. Errores: `hint` `not_pet_owner`,
  `invalid_email`, `not_pet_member`

### OwnershipTransferScreen
- **READ:** `pets`, `pet_co_owners` (co-tutores aceptados, candidatos a nuevo propietario)
- **WRITE:** **NO** update directo de `pets.owner_id` (Postgres lo rechazaría igualmente)
- **RPC:** `transfer_pet_ownership(pet_id, new_owner_id)`

### ReportsScreen
- **READ:** `pet_shared_reports`
- **WRITE:** ninguna directa
- **RPC:** `request_generate_report(pet_id, start, end)` — validación previa (cuota de fechas, acceso), no crea nada
- **Edge Function:** `generate-pet-report(pet_id, start, end)`, invocada tras el RPC. **Importante para frontend:** vuelve a comprobar el acceso a la mascota por su cuenta (misma regla `can_edit_pet`, no una nueva) — no basta con que `request_generate_report()` haya devuelto éxito antes
- **Storage:** `shared-reports` (solo lectura vía signed URL)

### SettingsScreen
**Versión mínima implementada** (`(app)/settings.tsx`, tablero 10.1): nombre y email, «Mis mascotas»,
«Registros sin sincronizar», zona horaria del perfil (solo lectura) y cerrar sesión (mismo flujo con
pendientes, §5 «Sesión»). El resto del tablero (idioma, tema, notificaciones, seguridad, privacidad,
fotos, exportar, suscripción, eliminar cuenta) no se muestra hasta tener servicio.
- **READ:** `profiles`, `notification_preferences`, `push_tokens`
- **WRITE:** `profiles` (columnas permitidas), `notification_preferences`, `push_tokens`
- **RPC:** `register_push_token(token, platform, device_id, app_version, os_version)` — llamar en login, en app launch y en cada refresh de token (ver sección 10)
- **Storage:** `avatars` (insert/delete, path `{user_id}/{uuid}`)

### PaywallScreen
- **READ:** `subscriptions` (columnas públicas)
- **WRITE:** ninguna — RevenueCat gestiona la compra; `subscriptions` se actualiza vía webhook, nunca desde el cliente
- **RPC:** ninguno directo (RevenueCat SDK gestiona el checkout nativo)

### DeleteAccountScreen
- **READ:** `owner_has_pets()` (para mostrar de antemano si hay que transferir mascotas primero — solo es UX, no la autorización real)
- **WRITE:** ninguna directa
- **Edge Function:** `delete-account` — **es la única vía real de borrado.** Ignora cualquier `user_id` que el cliente pudiera enviar (no hace falta enviarlo: usa el JWT), y vuelve a comprobar `owner_has_pets()` ella misma antes de borrar. Si el usuario tiene mascotas, responde `409 has_pets` y el frontend debe dirigir a `OwnershipTransferScreen` — no intentar el borrado de nuevo hasta que se resuelva

## 5. Offline (daily logs y pets)

```
Usuario pulsa Guardar
  ↓
Validación del formulario
  ↓
Guardado local inmediato (AsyncStorage, clave (user_id, pet_id, log_date)):
una sola operación por registro; las ediciones sucesivas se funden en ella
  ↓
«Guardado en este dispositivo» + «Pendiente de sincronizar»
  ↓
Motor de sincronización (si hay conectividad y sesión de ese usuario):
una operación detrás de otra, la más antigua primero
rpc('save_daily_log', registro completo + p_expected_updated_at | p_expect_absent)
  ↓
success  -> «Sincronizado»; la fila devuelta es la nueva base
conflict -> se lee la fila remota: si ya tiene lo enviado (respuesta perdida,
            guardado idéntico) -> «Sincronizado»; si no -> «Conflicto
            pendiente de resolver», datos locales intactos, nada se reenvía
retry    -> red o servidor: backoff con jitter; la red nunca agota la
            operación; el servidor, tras 8 fallos -> «No se pudo sincronizar»
give_up  -> permisos o validación -> «No se pudo sincronizar», sin reintento
            automático; «Reintentar» tras corregir la causa
auth     -> espera a una sesión válida, sin contar el intento
```

Casos a manejar explícitamente en la UI:
- **Fecha inválida / futura / fuera de la ventana:** `validate_daily_log_date` la rechazará (`hint` `log_date_future` o `log_date_too_old`); no reintentar automáticamente. Consecuencia de la ventana de creación de 7 días: un registro **nuevo** creado sin conexión que tarde más de 7 días en sincronizarse será rechazado (editar uno que ya existe en el servidor no tiene límite).
- **Permisos perdidos mientras estaba offline** (p. ej. el owner revocó el acceso del co-tutor): `save_daily_log` fallará con `42501` al reconectar; mostrar "ya no tienes acceso a esta mascota", no reintentar indefinidamente.
- **Timezone:** el `log_date` se calcula en el momento de crear el registro (sección 14 del README), no al sincronizar — así un registro offline no cambia de día solo por tardar en subir.

### Integración (fase 2: guardado local y motor de sincronización)

Implementada en Daily Logs (registro de hoy, registro de un día del historial, lista del historial y
tarjeta de la ficha). Decisiones: `DECISIONS.md` (2026-10-15). Pruebas: `npm test` (motor con un
servidor falso que reproduce el contrato de la RPC, vista, caché, repositorio) y `npm run
test:integration` (motor contra el Supabase **local**: Postgres real, RLS y precondiciones; nunca
`kitom-dev`).

**Piezas** (`frontend/src/features/daily-logs/offline/`, puras salvo el proveedor):
- `daily-log-repository.ts`: registros locales de un usuario sobre `LocalStore`. Única puerta de
  escritura local: `update` ejecuta lectura → cambio → escritura de una en una y avisa de cada cambio
  (con el registro anterior). `refreshSnapshot` guarda la última fila del servidor como copia **solo**
  si no hay cambios pendientes (nunca toca la base de una operación) y nunca retrocede (ver
  «Endurecimiento»).
- `daily-log-remote.ts`: `save_daily_log` y lectura de la fila de un día, con tiempo límite propio
  (20 s; sin él una conexión colgada bloquearía la cola), sin los reintentos internos de supabase-js
  y devolviendo error + `status` HTTP para clasificarlos. Nunca lanza.
- `daily-log-sync-engine.ts`: el motor (ver flujo arriba). `saveLocal`, `requestSync` (una sola
  pasada a la vez: lo que llega durante una pasada se junta en otra), `retry`, `idle`, `start`/`stop`
  y `setSessionUserId`. Solo envía si hay conectividad (señal) y la sesión es del dueño del almacén;
  se comprueba antes de cada envío. Red o sesión detienen la pasada; el backoff programa la siguiente.
- `sync-triggers.ts`: pasada al arrancar, al recuperar la conectividad (`onlineManager`) y al volver
  a primer plano (`AppState`); además, tras cada guardado local y al renovarse la sesión.
- `daily-log-view.ts`: vistas combinadas (registro y lista) y estado visible.
- `daily-log-cache.ts`: coherencia con TanStack Query. Cada escritura local actualiza la query local
  (`['daily-logs','local',userId,petId,logDate]`) y la lista local; una fila confirmada pasa al
  registro del día y al historial. La caché nunca se persiste.
- `features/daily-logs/sync/daily-log-sync-provider.tsx`: crea almacén y motor por usuario (en
  `(app)/_layout.tsx`): una instancia por usuario y proceso; solo está activa la del usuario con
  sesión (fase 5, «Sesión y cierre de sesión»).

**Reglas de datos.**
- Crear: sin fila remota conocida → `p_expect_absent`. Si ya existe (`row_exists`), se lee la fila y
  se clasifica: mismo contenido → sincronizado; distinto → conflicto.
- Editar: `p_expected_updated_at` con la cadena exacta de la fila sobre la que se editó; la base solo
  cambia al confirmar el servidor o al reconciliar. El formulario guarda sobre la fila que mostró al
  abrirse o cargó después sin cambios del usuario (no sobre una versión de otro dispositivo que llegue
  mientras el usuario edita: así se detecta el conflicto).
- Respuesta perdida: un error sin respuesta nunca es éxito; el reintento recibe conflicto y se
  reconcilia leyendo la fila.
- Conflicto: se conservan los datos locales y la fila remota. Seguir editando en conflicto se
  guarda en local, sin enviar. Se resuelve en la pantalla de conflictos (ver «Resolución de
  conflictos»).
- Cola: primero lo que menos ha fallado y, a igualdad, lo más antiguo, para que un registro que
  falla una y otra vez no bloquee a los demás. Un 5xx no detiene la pasada; la red y el 401 sí (y el
  401 bloquea hasta una sesión nueva).

**Web.** `networkMode: 'always'` **solo** en la mutación de guardado de Daily Logs (que ya solo es
local): sin conexión no queda en pausa ni TanStack la reenvía al reconectar. El resto de la app
conserva su configuración (`query-defaults.ts`). Las queries locales también usan `always`.

**Pendiente:** borrar registros (local y remoto); Pets y Pet Photos sin conexión. Cerrar sesión con
pendientes y el aislamiento al cambiar de cuenta están en la fase 5 («Sesión y cierre de sesión»); el
arranque en frío sin conexión, en la fase 6 («Arranque en frío sin conexión»). Los datos locales de
otras cuentas no se borran solos. Sin conexión, la ficha de la mascota sigue sin cargar (Pets no es
offline): a sus registros se llega desde «Registros guardados en este dispositivo» (lista de mascotas).

### Resolución de conflictos (fase 3)

Pantalla `(app)/pets/[id]/daily-logs/resolve/[date]`, a la que se llega con «Revisar y resolver»
(conflicto) o «Ver detalles» (no se pudo sincronizar) desde el estado de sincronización del
formulario. Componente `features/daily-logs/components/conflict-resolution.tsx`. Decisiones:
`DECISIONS.md` (2026-10-15, fase 3).

**Qué muestra.** Mascota y fecha; que tus cambios se conservaron en el dispositivo y no se guardarán
en el servidor hasta que decidas; el estado y su motivo; para cada dato distinto, tu versión, la del
servidor y quién lo cambió («Solo lo cambiaste tú», «Solo cambió en el servidor», «Cambió en los dos
sitios: tienes que elegir», etiquetas que se juntan); y siempre tus datos locales completos, en texto
seleccionable para copiarlos.

**Decisiones** (`buildResolvedContent` en `offline/daily-log-merge.ts`, sobre la fusión a tres bandas):
- «Conservar mis cambios»: tu versión completa.
- «Conservar los del servidor»: la versión remota (no se envía nada).
- «Combinar»: lo cambiado solo por ti se conserva, lo cambiado solo en el servidor se acepta, las
  etiquetas se unen como conjunto sin duplicados y cada dato cambiado en los dos sitios exige elegir.
  Para `notes` y para comportamiento inusual (con su nota, como unidad) se ofrece además «Conservar
  ambas y revisar» solo si las dos versiones tienen texto: la propuesta (`suggestCombinedText`) aparece
  en un campo editable y se guarda lo que el usuario deje; nunca se concatena sola. Se ve el resultado
  antes de guardar.
- Fila remota borrada (o sin acceso: RLS no lo distingue): «Volver a crearlo con mis datos»
  (`p_expect_absent`) o descartar la copia del dispositivo. Nunca se recrea sola.
- No se pudo sincronizar: motivo, «Reintentar», descartar la copia del dispositivo y, sin permiso, que
  los datos no se guardaron en el servidor y se pueden copiar (fase 4: «Endurecimiento»).

**Guardar la resolución** (`engine.resolveConflict`): espera a que no haya una pasada en curso; lee la
versión remota más reciente; si no es la que vio el usuario, guarda la nueva y vuelve a pedir
resolución sin enviar nada; si es la misma, el contenido elegido queda pendiente sobre esa versión y se
envía con su precondición. «Sincronizado» solo si el servidor confirma o ya tenía exactamente ese
contenido. Si vuelve a haber conflicto, se conserva la decisión y se pide de nuevo. Sin conexión no
se cambia nada; si la red cae al enviar, queda pendiente en el dispositivo. Al resolverse, el
formulario abierto carga el resultado si no se ha tocado; si se estaba editando, conserva lo escrito y
avisa (`decideSourceChange`; antes se volvía a montar y se perdía lo no guardado).

### Endurecimiento (fase 4)

Decisiones: `DECISIONS.md` (2026-10-15, fase 4). Pruebas: `offline/daily-log-hardening.test.mjs`,
`daily-log-form.test.mjs`, `offline/daily-log-view.test.mjs` e integración (`npm run test:integration`).

**Lecturas tardías** (`daily-log-repository.ts`, `daily-log-cache.ts`, `daily-log-version.ts`). Ninguna
respuesta del servidor hace retroceder la copia local ni la caché:
- Las versiones (`updated_at`) se comparan como instantes con microsegundos, sin pasar por `Date`
  (`compareVersions`). Iguales (aunque se escriban distinto) = la misma fila: no se escribe nada. Una
  cadena que no se puede comparar no sustituye a nada salvo en una lectura reciente.
- Quien lee del servidor toma una marca (`snapshotMark`) antes de pedir y la pasa a
  `refreshSnapshot`. Si el registro cambió en el dispositivo después de la marca, la respuesta es
  tardía: solo se acepta una versión estrictamente posterior; una ausencia, una versión igual, una
  anterior o una no comparable se ignoran. Una versión anterior a la copia nunca se acepta. Nunca se
  toca una operación pendiente, fallida o en conflicto.
- Las queries del registro del día y del historial leen **a través** del almacén
  (`readDailyLogThroughRepository`, `readHistoryPageThroughRepository`): devuelven la versión más
  reciente conocida. La query del día además nunca acepta una fila anterior a la que tiene
  (`structuralSharing: keepNewestDailyLog`, aplicado por TanStack dentro de la propia escritura de la
  caché), y `applyLocalChangeToCache` solo escribe filas posteriores. No se cancelan lecturas en vuelo:
  cancelar y escribir después dejaría una ventana entre las dos operaciones; así la decisión ocurre
  siempre en un único punto (la cola del almacén o la escritura de TanStack).
- Límite conocido: una ausencia (`null`) que llega a la query en el mismo instante en que el motor
  confirma una creación puede verse un momento; la siguiente lectura lo corrige (no afecta a la copia
  local ni a la base de la precondición).

**Abrir el formulario** (`useDailyLog(…, { waitForRemote: true })` en hoy y en un registro anterior):
- Con conexión y sin cambios pendientes, espera a la versión del servidor hasta `REMOTE_WAIT_MS` (3 s).
- Sin conexión, o pasado el tope, abre con la copia del dispositivo y lo indica («todavía no se ha
  podido comprobar la versión del servidor» o «Sin conexión»). Hoy, sin copia, permite empezar.
- Si la versión del servidor llega con el formulario abierto, `decideSourceChange`
  (`daily-log-form.ts`): misma versión → nada (renders o cambios de caché irrelevantes); mismo
  contenido → solo avanza la base; contenido distinto y formulario sin tocar → se cargan los valores
  nuevos; contenido distinto y el usuario ya editó → se conservan sus valores, la base no cambia (la
  precondición detecta el cambio al guardar) y se avisa, con un botón explícito para cargar esa versión.
  Lo mismo al resolverse un conflicto en segundo plano: el formulario ya no se vuelve a montar.

**Descartar la copia de este dispositivo** (`engine.discardLocalChanges`, transición
`discardLocalChanges` en `local-daily-log.ts`), a petición, con confirmación en dos pasos en el detalle:
- Fallido (permisos, fecha, validación, reintentos agotados): queda la última fila confirmada como
  copia sincronizada o, si nunca existió en el servidor según el dispositivo, desaparece la copia.
- Conflicto con la fila remota leída: queda esa fila (o nada, si el servidor ya no la tiene). Sin leer
  la fila remota no se descarta (`remote_unknown`): no hay una versión fiable que conservar.
- Pendiente: no se descarta (`not_discardable`); todavía se puede enviar o editar.
- Espera a que no haya una pasada en curso y decide dentro de `repository.update`. Nunca llama al
  servidor. El texto dice que no se borra nada del servidor.

**Registros sin sincronizar** (`(app)/daily-logs/unsynced`, entrada con contador en la pantalla de
inicio `(app)/index.tsx`, `components/unsynced-entry.tsx`, `useUnsyncedDailyLogs`). Lista los registros
pendientes, fallidos o en conflicto del usuario con sesión, de todas sus mascotas, leídos solo del
almacén local (`repository.list()`, query `['daily-logs','local-unsynced',userId]`): no depende de que
RLS deje ver la mascota. El nombre sale de la lista de mascotas si está; si no, «Mascota no disponible».
Cada uno abre su detalle (`daily-logs/resolve/[date]`, que no exige la mascota): conflicto → resolver;
fallido → motivo, reintentar o descartar; pendiente → qué falta y los datos. Nada se borra solo al
perder el acceso a una mascota. La query se revalida solo cuando un registro entra o sale de la lista.

**Sesión.** Tras un 401 el motor no envía nada más con esa sesión: ni volver a primer plano, ni
recuperar la red, ni un guardado nuevo. Solo una sesión nueva o renovada (`setSessionUserId`, que el
proveedor llama en cada cambio de sesión de Supabase Auth) lo desbloquea. Un 401 de una sesión ya
sustituida no bloquea la nueva.

**Errores de lectura local.** Un fallo al leer el almacén se muestra como error
(`local_read_failed`) con «Reintentar» en el registro, el historial, la lista y el detalle; nunca como
"no hay datos". **Resolver** solo devuelve `synced` si el registro sigue en el dispositivo y el
servidor lo confirmó o ya tenía ese contenido; si desaparece mientras tanto, `not_in_conflict`.

**Detalle sin conexión.** Si la fila remota de un conflicto no se ha leído: sin conexión se dice y
quedan los datos para copiar; con conexión se lee sola; si falla, «No se ha podido comprobar» y
«Reintentar».

### Sesión y cierre de sesión (fase 5)

Decisiones: `DECISIONS.md` (2026-10-16, fase 5). Pruebas: `features/auth/sign-out-flow.test.mjs`,
`features/auth/owner-session.test.mjs`, `offline/daily-log-session.test.mjs` (motor real, cliente de
Supabase falso que actúa como el usuario del token) y `offline/daily-log-session.integration.test.mjs`
(Supabase **local**, un cliente compartido que cambia de cuenta de verdad).

**Qué garantiza el aislamiento entre cuentas.**
- **Escrituras.** Cada petición del motor (`save_daily_log` y la lectura de reconciliación) se
  autoriza con el token de la sesión del **dueño** de la operación, pedido justo antes de enviarla
  (`features/auth/owner-session.ts`: la sesión y el `sub` del JWT deben ser del dueño) y fijado en la
  cabecera `Authorization` (`daily-log-remote.ts`). Si la sesión ya es de otra cuenta, o no hay, la
  petición **no sale** (401 local `owner_session_required`: espera a una sesión nueva sin contar el
  intento). Lo que ya salió va con el token del dueño aunque la sesión cambie después. Además el motor
  solo envía registros con `userId` igual al de su almacén y solo si su sesión es la del dueño.
- **Datos locales.** Cada cuenta tiene su almacén (claves `kitom:v1:<userId>:…`). Un registro cuyo
  dueño no coincide con su clave (`key_mismatch`) no se lista, no se envía y no se sobrescribe
  (`ownership_unverified`): se conserva para recuperarlo.
- **Instancias.** `offline/daily-log-sync-sessions.ts`: un almacén y un motor por usuario mientras
  dure el proceso; activar uno para y deja sin sesión a los demás. Si la misma cuenta sale y vuelve con
  una petición en vuelo, se reutilizan (las escrituras siguen siendo de una en una y la pasada en curso
  se junta con la siguiente).
- **Caché e interfaz.** Todas las query keys de Daily Logs llevan el usuario; AuthProvider vacía la
  caché al cambiar de usuario; la suscripción del almacén a la caché y la copia de lecturas del servidor
  en el almacén (`ownerScopedSnapshots`) solo actúan si `isCurrentUser(userId)` (que cambia en el mismo
  instante del evento de Supabase Auth, antes de que React vuelva a pintar). Sin usuario, el proveedor
  no pinta la zona autenticada; al cambiar de usuario, toda ella se vuelve a montar (`key`).
- **Respuestas tardías.** Una respuesta que llega después de cambiar de cuenta se aplica al almacén de
  su dueño (es lo que el servidor guardó para él) y no toca la caché ni la interfaz de la cuenta nueva.
  Nunca se marca nada como sincronizado sin la confirmación del servidor o una lectura con el mismo
  contenido; una respuesta perdida se reconcilia como siempre (precondición → conflicto → lectura).

**Cerrar sesión** (`features/auth/sign-out-flow.ts`; desde la fase 8.5, `createAppSignOutFlow` en
`unsynced-changes.ts`, proveedor `sign-out-provider.tsx` con `useSignOutFlow` y `useUnsyncedChanges`,
pantalla `(app)/sign-out`). «Cerrar sesión» lee del dispositivo **los registros diarios y las altas y
ediciones de mascotas** (fase 8.5: pendientes de crear, ediciones pendientes, enviadas sin confirmar,
en conflicto, fallidas, sin permiso e ilegibles). Si cualquiera de los dos almacenes no se puede leer,
no se da por vacío:
- Ninguno: cierra sesión como siempre.
- Alguno, o no se pudo leer el dispositivo: no cierra y abre la pantalla de decisión, con cuántos hay
  de cada tipo, que esos cambios solo existen en este dispositivo y el acceso a «Registros sin
  sincronizar» (resolver, copiar o descartar uno a uno, como siempre). No hay descarte masivo.
  - **A. Intentar sincronizar y cerrar sesión** (`syncNow` de los dos motores a la vez, 15 s como
    máximo cada uno; las mascotas «sin permiso» no se reintentan, no lo arregla reenviar): como
    «Reintentar» en cada registro (fallido → pendiente, espera del backoff anulada, conflicto → volver a
    leer el servidor) y una pasada. Cierra sesión solo si después el dispositivo no tiene nada sin
    sincronizar. Si no, vuelve a mostrar las opciones con lo que queda y el motivo: quedan cambios,
    tiempo agotado (la pasada sigue en segundo plano y nunca cierra la sesión sola), sin conexión (no se
    espera a la red) o la sesión no permite enviar (p. ej. tras un 401).
  - **B. Conservar en este dispositivo y cerrar sesión**: cierra sesión sin tocar nada. Los cambios
    quedan en el almacén de esa cuenta, ocultos (la interfaz solo lee el almacén de la cuenta activa) y
    sin enviarse (no hay sesión del dueño). Al volver a entrar **en este dispositivo con la misma
    cuenta** se recuperan y el motor los envía con precondición. No están en el servidor ni en otros
    dispositivos.
  - **C. Cancelar** (o salir de la pantalla): la sesión sigue y no cambia nada; si había un intento de
    A en curso, sigue en segundo plano pero ya no cierra la sesión al terminar.
- Una operación a la vez (`busy` para dobles toques o dos pantallas) y `signOut` de AuthProvider
  compartido entre llamadas simultáneas (`lib/single-flight.ts`).

**Ciclo de vida.**
- **Inicio de sesión / reapertura con sesión persistida:** se activa la instancia de esa cuenta, que
  vuelve a leer sus operaciones del dispositivo y las envía (`INITIAL_SESSION` / `SIGNED_IN`).
- **Renovación del token:** `TOKEN_REFRESHED` cuenta como sesión renovada (desbloquea tras un 401). Si
  la renovación falla sin conexión, no hay token (`unavailable`) y se espera a la siguiente.
- **Sesión revocada** (el servidor rechaza el token de renovación): Supabase Auth cierra la sesión sin
  pasar por la pantalla de decisión: equivale a B (nada se borra; se recupera al volver a entrar con esa
  cuenta). El cierre desde `update-password` (sesión de recuperación, fuera de la zona autenticada)
  también. Un token caducado que **no se puede renovar por falta de red no es un cierre**: estado
  `offline` (fase 6).
- **Otra cuenta en el mismo dispositivo:** no ve, no lista y no envía nada de la anterior; tampoco se
  migran ni se borran sus datos.
- **Cierre de la app** durante la pantalla de decisión o con un intento en vuelo: no se ha cerrado la
  sesión ni cambiado nada; al reiniciar la sesión sigue y las operaciones se reconcilian (si el
  servidor ya la tenía: conflicto `row_exists` o `version_mismatch` → lectura → mismo contenido →
  sincronizado, sin otra escritura).

**Límites.** Los datos que se conservan siguen sin cifrar (AsyncStorage / `localStorage`, ver
«Infraestructura»); los de una cuenta que no vuelve a entrar en este dispositivo se quedan ahí (no
hay limpieza automática). En web, dos pestañas comparten `localStorage` y la sesión: el aislamiento
entre cuentas se mantiene, pero dos pestañas de la misma cuenta no coordinan su cola. Pets y el resto
de queries mantienen el aislamiento previo (caché vaciada al cambiar de usuario, claves sin usuario).

### Arranque en frío sin conexión (fase 6)

Decisiones: `DECISIONS.md` (2026-10-16, fase 6). Pruebas: `features/auth/auth-session-controller.test.mjs`
(con `fake-supabase-auth.mjs`, que reproduce supabase-js 2.117), `lib/user-token-fetch.test.mjs` (con
el supabase-js real), `daily-logs/daily-log-pet-context.test.mjs`, `offline/daily-log-cold-start.test.mjs`
(reinicios sobre el mismo disco) y `offline/daily-log-cold-start.integration.test.mjs` (Supabase
**local**, supabase-js real, red cortada o colgada).

**Qué hace supabase-js al arrancar** (2.117, comprobado en `GoTrueClient`):
- Token de acceso vigente (a más de 90 s de caducar): entrega la sesión guardada **sin red** (no la
  comprueba en el servidor).
- Token caducado: intenta renovarlo, con reintentos durante ~25 s. Sin red (error reintentable)
  **conserva la sesión guardada** pero emite `INITIAL_SESSION` sin sesión; después, durante 60 s,
  devuelve ese mismo fallo sin volver a pedir nada. Token de renovación rechazado: borra la sesión y
  emite `SIGNED_OUT`.
- `signOut()` con el token caducado y sin red: devuelve el error de renovación **sin borrar** la sesión.
- Mientras se inicializa, cualquier petición de datos espera a que termine (hasta ~25 s sin red).

**Estados de la sesión** (`features/auth/auth-state.ts`, `auth-session-controller.ts`, en AuthProvider
como `status`, `canUseServer`, `recoverSession` y `serverCall`):

| Estado | Cuándo | Qué se ve | Servidor |
|---|---|---|---|
| `loading` | hasta `INITIAL_SESSION`, **4 s como máximo** | splash | — |
| `signed_in` | Supabase da una sesión utilizable (token vigente o renovado; no se sabe si el servidor la acepta hasta usarla) | la app | sí |
| `offline` | Supabase no da sesión, pero sigue guardada y su usuario se identifica (`refresh_failed`), o no llegó `INITIAL_SESSION` en 4 s (`slow_start`) | la app con los datos locales de ese usuario y el aviso «Sesión sin comprobar» | **no**: ni envíos ni lecturas |
| `signed_out` | no hay sesión guardada, o no se puede atribuir a un usuario | login, sin datos | — |

- **Identidad local** (`persisted-session.ts`): la sesión guardada por supabase-js (misma clave,
  `AUTH_STORAGE_KEY`, y mismo almacenamiento, `secure-session-storage.ts`), con forma válida y con el
  `sub` del token igual a `user.id`. Si no, o si el almacenamiento falla al leer: `signed_out`. Solo
  identifica de quién son los datos locales; nunca se usa para enviar.
- **Un error de red al iniciar no es un cierre de sesión.** `INITIAL_SESSION` sin sesión solo lleva al
  login si el almacenamiento ya no la tiene.
- **Carreras:** cada evento invalida las lecturas del almacenamiento pedidas antes; un
  `INITIAL_SESSION` que llega después del tope se aplica normalmente (p. ej. `offline` → `signed_in`).
- **Recuperación** (`offline` → `signed_in`): `getSession()` (lo renueva si puede), una petición a la
  vez y como mucho 10 s, al volver la conectividad, al volver a primer plano, con «Volver a comprobar» y
  periódicamente mientras dure `offline`; solo con conexión y en primer plano (política y tiempos en
  «Estabilización de la sesión (fase 6.5)»). Al recuperarla, se vuelven a pedir las queries
  (`invalidateQueries`) y el motor recibe la sesión y envía.
- **Cerrar sesión en `offline`:** la sesión se borra del dispositivo (Supabase no puede); también si con
  sesión `signed_in` Supabase no la quita (token caducado sin red) o no responde en 10 s. Sin red el
  servidor no se entera.

**Nada sale sin sesión utilizable.**
- `serverCall` (AuthProvider): todas las queries y mutaciones de Pets y las lecturas del servidor de
  Daily Logs pasan por él; sin sesión utilizable fallan **al instante** con `SessionUnavailableError`
  (que la app trata como «sin conexión»), sin esperar a la inicialización de supabase-js.
- `lib/user-token-fetch.ts` (`global.fetch` del cliente): ninguna petición a PostgREST, Storage o Edge
  Functions sale como `anon`. Sin ella, con la sesión sin renovar RLS respondería «vacío» (una lista sin
  mascotas, un registro «que no existe») y eso podría pisar la copia local. El error lleva
  `code: 'ABORT_ERR'` para que postgrest-js no lo reintente.
- Motor: la sesión que recibe es `null` en `offline` y, además, el token del dueño
  (`owner-session.ts`) no está disponible sin una sesión que Supabase entregue: doble barrera. Mantiene
  precondiciones, respuestas perdidas, conflictos y 401 como siempre (los conflictos y los fallidos no
  se reintentan solos).
- «Hoy» sin sesión utilizable usa la zona del dispositivo (la del perfil no se pide); en los
  formularios la fecha calculada al abrir se conserva aunque llegue después la del perfil.

**Pantallas sin conexión (arranque en frío).**
- Completas: inicio (aviso, «Registros sin sincronizar» con contador, cerrar sesión), «Registros sin
  sincronizar», detalle/resolución de un registro (datos para copiar, descartar fallidos y conflictos
  con la versión remota conocida; resolver necesita conexión, como antes), historial (lo guardado en el
  dispositivo), registro de hoy y de un día (ver y editar lo guardado; crear el de hoy).
- Con límites: sin copia de la lista de mascotas (fase 7), «no disponible sin conexión» y, debajo,
  «Registros guardados en este dispositivo» (por mascota, sin nombre: «Mascota (información no
  disponible sin conexión)»), con acceso al registro de hoy y al historial. Con copia, la lista, las
  fichas y las pestañas funcionan (ver «Pets sin conexión (fase 7)»). En el registro, sin copia de la
  mascota: «Información de la mascota no disponible sin conexión» y, sin el permiso, se permite editar
  con el aviso de que el servidor decidirá al sincronizar (`daily-log-pet-context.ts`; si no hay permiso, queda «No se pudo
  sincronizar» con los datos intactos).
- No disponibles: borrado de mascotas y fotos (necesitan el servidor). La ficha, desde la fase 7, con
  la copia del dispositivo; alta y edición, desde la fase 8, guardadas en el dispositivo.

### Estabilización de la sesión (fase 6.5)

Decisión: `DECISIONS.md` (2026-10-19, fase 6.5). Pruebas: `lib/auto-refresh-gate.test.mjs` (premisas de
auth-js con el cliente real y reloj simulado), `lib/auth-refresh-fetch.test.mjs`,
`lib/chunked-storage.test.mjs`, `lib/user-token-fetch.test.mjs`,
`features/auth/auth-session-controller.test.mjs` y `features/auth/auth-session-recovery.integration.test.mjs`
(Supabase **local**). Tiempos: `frontend/scripts/measure-session-recovery.mjs`.

**Qué hace auth-js 2.117 con la renovación** (probado contra el cliente real; si cambia, las pruebas
de `auto-refresh-gate.test.mjs` fallan):
- Fuera del navegador (React Native) arranca **su propio temporizador** de renovación (cada 30 s, con
  una pasada inmediata) al terminar de inicializarse, sin mirar la red ni `AppState`.
- Una renovación fallida por la red reintenta ~25 s (200 ms … 12,8 s) y después, durante **60 s**,
  devuelve el mismo fallo sin pedir nada. Las llamadas simultáneas comparten una sola renovación.
- Una respuesta de error que no sea fallo de red ni 5xx (p. ej. un 403 en HTML de un proxy) la toma
  como rechazo y, con el token caducado, **borra la sesión**.

**Política** (sin temporizadores nuevos):
- Temporizador de auth-js en móvil: solo en primer plano **y con conexión** (`lib/auto-refresh-gate.ts`,
  conectado en `lib/supabase.ts`; se reaplica tras la inicialización de auth-js, que lo arranca por su
  cuenta). Sin red no se intenta renovar, así que al volver la red no hay bloqueo de 60 s que esperar.
  En web lo sigue gestionando auth-js según la visibilidad de la pestaña.
- Controlador (`auth-session-controller.ts`): intenta recuperar solo si `canAttemptRecovery()` (con
  conexión y en primer plano); al volver la red o el primer plano, al momento; mientras siga `offline`,
  cada **5 s** contados desde el final del intento anterior. No añade peticiones: auth-js comparte la
  renovación en curso y responde con el fallo guardado durante su bloqueo; el intervalo solo acorta lo
  que se tarda en notar que ha terminado.
- Sesión rechazada (`isSessionRejected`: 4xx de Auth salvo 408/429, o `AuthSessionMissingError`):
  auth-js la borra y emite `SIGNED_OUT`; si no pudo, se quita del dispositivo; si tampoco, queda
  `offline` sin más intentos. Nunca se reintenta.
- Respuesta tardía de `recover`: solo se aplica si la sesión de la app sigue `offline` con el mismo
  usuario y la sesión recibida es de ese usuario. Si Supabase ya no tiene sesión guardada (sin error),
  `signed_out`.
- `lib/auth-refresh-fetch.ts`: una respuesta de error **no JSON** a la renovación del token se convierte
  en fallo de red (el servidor de Auth siempre responde JSON); los rechazos reales siguen cerrando.
- Identidad: una sesión de Supabase solo da `signed_in` si el `sub` del token es `user.id` (como la
  sesión guardada); si no, `signed_out` sin borrar nada.
- SecureStore (`lib/chunked-storage.ts`): los fallos de leer, escribir o borrar se propagan, nunca se
  borra nada para «arreglarlos»; un valor escrito a medias que mezcle dos cuentas no identifica a
  ninguna.

**Tiempos medidos** (Node, supabase-js real con `autoRefreshToken: true` contra el Supabase local; red,
conectividad y `AppState` simulados; desde que vuelve la red hasta la sesión renovada · sincronización
del pendiente). Antes → después:

| Escenario | Antes | Después |
|---|---|---|
| Token vigente sin red | utilizable al arrancar, 0 peticiones | igual |
| Caducado, la red vuelve a los 10 s (durante los reintentos del arranque) | 2,7 s | 2,7 s |
| Caducado, la red vuelve a los 150 s | 25,6 s | **0,12 s** · 0,24 s |
| Red + primer plano + «Volver a comprobar» ×2 a la vez | 30 s, 1 renovación | **0,13 s**, 1 renovación |
| La red vuelve en segundo plano; medido desde el primer plano | (renovada en segundo plano) | **0,16 s** · 0,32 s |
| Renovación colgada 15 s | 25,6 s | **15,1 s** |
| Caducado, la red vuelve a los 45 s (dentro del bloqueo de 60 s del arranque) | 40,6 s | 45,1 s |
| Sesión revocada; la red vuelve a los 40 s | cierre a los 45,5 s, 0 renovaciones después | 50,1 s, 0 después |
| 503 durante 180 s y luego servidor sano (sin evento de red) | 51 s; 16 renovaciones en 180 s | 60,2 s; 16 en 180 s |
| Renovaciones sin red en 150 s | 16 | **8** (solo las del arranque) |

Los tres últimos casos están limitados por el bloqueo de 60 s de auth-js (no se puede saltar con su
API pública): la espera es lo que le quede más ≤ 5 s; la diferencia antes/después depende de en qué
momento del bloqueo vuelve la red.

**Consultas tras recuperar la red** (2026-10-20): con el token vigente la sesión nunca pasa por
`offline`, así que las queries que fallaron sin red se recuperan con la revalidación al reconectar
de TanStack Query (activada en móvil; ver `networkMode` en «Infraestructura (fase 1 del frontend)»);
con el token caducado, con la invalidación de AuthProvider al recuperar la sesión.

**Verificado en Android** (emulador Android 16, Expo Go 57.0.9 con su SecureStore nativo, Supabase
local en `10.0.2.2` para que el modo avión lo corte de verdad; peticiones contadas en los registros de
Kong): arranque sin red con token vigente y caducado, ida y vuelta a primer plano durante los
reintentos, crear/editar sin red y cerrar la app, recuperación en primer plano con el token caducado
(1 renovación, 1 escritura con precondición; renovación a 3,3 s de quitar el modo avión, ~3 s de ellos
la reconexión del wifi), cambio de cuenta y cierre de sesión sin red conservando los cambios. Solo en
Node: la red que vuelve en segundo plano y el cierre de sesión en `offline` con el token caducado.
Para repetirlo: arrancar Expo con `EXPO_PUBLIC_SUPABASE_URL=http://10.0.2.2:54321` y la clave anónima
local, `adb reverse` solo para Metro, y esperar 1 h (`jwt_expiry`) con la app cerrada para el token
caducado.

### Pets sin conexión (fase 7)

Solo lectura: no hay escrituras de mascotas sin conexión ni cola. Decisión: `DECISIONS.md` (2026-10-20,
fase 7). Código: `features/pets/offline/` (puro) y `hooks/use-pets.ts`. Pruebas:
`pet-snapshot.test.mjs`, `pet-cache-repository.test.mjs`, `pet-view.test.mjs` (vistas, formularios,
foto y compatibilidad con Daily Logs), `pet-queries.test.mjs` (`@tanstack/query-core` con las opciones
de la app y el controlador de sesión) y `pets-offline.integration.test.mjs` (Supabase **local**).

**Copia en el dispositivo** (`LocalStore`, `offline/pet-snapshot.ts`; validada y versionada al leer):

| Clave | Valor (v1) | Significado |
|---|---|---|
| `kitom:v1:<userId>:pets:<petId>` | `{ pet, savedAt, unavailableAt }` | Mascota leída del servidor al menos una vez. `pet`: solo las columnas de `PET_COLUMNS` (`photo_path` es un path, nunca una URL). `unavailableAt` ≠ `null`: el servidor dejó de devolverla (sin acceso o eliminada); la copia se conserva |
| `kitom:v1:<userId>:pets-list:current` | `{ savedAt, petIds }` | Última lista correcta del servidor. No existe: **nunca cargada**. `petIds: []`: **vacía confirmada** |

No se guardan URLs firmadas, `can_edit_pet`, la racha, tokens ni credenciales. `savedAt` es la hora del
dispositivo al confirmar esa versión con el servidor (solo para «actualizados: …»).

**Estados** (`offline/pet-view.ts`):

| Caso | Lista | Ficha |
|---|---|---|
| Con servidor, primera carga | cargando (no se enseña la copia para luego sustituirla) | cargando |
| Datos del servidor | `ready`, `source: 'server'` | `ready` / `not_found` (solo lo dice el servidor) |
| Datos del servidor y se pierde la conexión | `ready`, `stale` con la hora | igual |
| Sin servidor (sin red, sesión `offline` o fallo de red) y con copia | `ready`, `source: 'device'`, `stale` | `ready` (copia) o `unavailable` si tiene `unavailableAt` |
| Sin servidor y sin copia | `offline_unavailable` («no disponible sin conexión» + Reintentar + registros del dispositivo) | `offline_unavailable` (nunca «no existe») |
| Copia ilegible (corrupta, otra versión, almacenamiento) | `local_error` (Reintentar; no es «sin mascotas») | `local_error` |
| Otro error del servidor | `error` | `error` |

«Sin servidor» = `!canUseServer || !online` o la petición falló por la red. «Reintentar» en `offline`
vuelve a comprobar la sesión. Las pantallas de un registro reciben la ficha con forma de query
(`petDetailAsQuery`): nombre de la copia si la hay; sin ella, como antes («Información de la mascota no
disponible sin conexión»). La mascota activa sale de la lista (también de la copia).

**Qué entra en la copia.** Solo respuestas correctas del servidor (un error lanza antes de llegar al
almacén: nunca se interpreta como lista vacía), pedidas por `serverCall` con la sesión utilizable, con
el **token del dueño** en la cabecera (`api/pets-remote.ts` + `createOwnerAccessToken`: si la sesión del
cliente compartido es de otra cuenta, la petición no sale) y guardadas solo si al terminar
`isCurrentUser(userId)`. Lista y ficha con `enabled: canUseServer`: en `offline` no se ejecuta ningún
`queryFn`. Las filas que devuelven crear, editar y borrar también entran (borrar = `unavailableAt`).

**Orden** (`offline/pet-cache-repository.ts`, una instancia por usuario y proceso): marca de lectura
antes de cada petición. Por mascota, la lectura iniciada más tarde decide la visibilidad, pero los datos
nunca retroceden (se conserva un `updated_at` estrictamente posterior); una respuesta tardía solo entra
con un `updated_at` estrictamente posterior de una mascota que sigue visible; la lista guardada solo la
sustituye una lista con marca posterior. Límite: `updated_at` es `now()` (inicio de la transacción) y no
cambia con la visibilidad; la marca es el orden de salida desde el dispositivo, no el de llegada al
servidor. La siguiente lectura corrige un orden equivocado. Escrituras de una en una y de mejor esfuerzo
(si el dispositivo no guarda, lo aceptado sigue en memoria y la siguiente lectura lo reintenta).

**Cambio de cuenta.** Query keys con `userId`; AuthProvider vacía la caché (`clear` cancela las queries,
pero el `queryFn` en curso termina: por eso la comprobación de `isCurrentUser` antes de guardar). Las
copias de otras cuentas se quedan en el dispositivo, aisladas por su clave, y no se borran.

**Escrituras y fotos.** En la fase 7, crear y editar necesitaban conexión. Desde la fase 8 se guardan
en el dispositivo; ver «Pets: altas y ediciones sin conexión (fase 8)». La foto sigue necesitando
servidor y permiso conocido (el permiso no se guarda ni se da por vigente). Foto sin conexión, sin sesión o con la URL caducada: «La foto no está disponible ahora mismo» (y
la inicial en los avatares); `photo_path` no se toca. El flujo de subir/quitar no cambia.

**Pendiente:** limpieza (no automática) de copias de cuentas que no vuelven; una mascota creada o
compartida en otro dispositivo no aparece sin conexión hasta leerla con conexión; si el sistema dice
«conectado» pero el servidor no responde, postgrest-js reintenta (~7 s) antes de pasar a la copia.

### Pets: altas y ediciones sin conexión (fase 8)

Crear y editar mascotas se guarda primero en el dispositivo y lo envía un motor de sincronización. Las
fotos y el borrado siguen necesitando conexión. Decisiones: `DECISIONS.md` (2026-10-20, migración; y
2026-10-21, fase 8). Código: `features/pets/offline/` (puro: `pet-operation.ts`,
`pet-operation-repository.ts`, `pet-sync-engine.ts`, `pet-write-view.ts`, `pet-form-gate.ts`,
`species-snapshot.ts`), `api/pet-writes-remote.ts`, `sync/pet-sync-provider.tsx` y
`hooks/use-pet-writes.ts`. Pruebas: `pet-operation.test.mjs`, `pet-sync-engine.test.mjs` (servidor
falso `fake-pet-server.mjs`), `pet-view.test.mjs`, `pets-offline-writes.integration.test.mjs` (Supabase
**local** con la migración) y `supabase/tests/concurrency/pets_concurrency.sh`.

**Operación local** (`kitom:v1:<userId>:pet-ops:<localId>`, v1, validada al leer). Hay una por mascota:

| Campo | Alta | Edición |
|---|---|---|
| `localId` | `local-<uuid>` (no tiene forma de id del servidor) | el id de la mascota |
| `petId` | `null` hasta confirmarse; después, el id del servidor (mapeo persistente) | el id de la mascota |
| `content` | columnas editables validadas (`parsePetFields`; nunca `owner_id`, `id`, `photo_path` ni `is_active`) | igual |
| `baseRow` | `null` | la fila del servidor (o de la copia) sobre la que se editó, con su `updated_at` exacto |
| `operationId` | UUID v4 estable = `client_request_id` del alta | UUID v4 estable |
| `status` | `pending` · `failed` · `forbidden` · `synced` (mapeo) | `pending` · `conflict` · `failed` · `forbidden` (confirmada: se borra) |
| `attempts`, `nextAttemptAt`, `lastError` | fallos con respuesta del servidor y backoff (como Daily Logs) | igual |
| `inFlightSince` | se envió y no se sabe el resultado (respuesta perdida o app cerrada) | igual |
| `conflictRemote` | — | la fila del servidor con la que choca |

Si se edita varias veces sin conexión, todo se consolida en la misma operación: contenido nuevo y la
misma base. Editar un alta que aún no se ha confirmado cambia lo que se va a crear, con la misma clave.
Con un conflicto o sin permiso no se edita hasta decidir qué hacer con lo guardado. Lo ilegible no se
lista ni se envía, y tampoco se sobrescribe.

**Idempotencia del alta** (migración `20261020135440`): el `INSERT` lleva `client_request_id` =
`operationId`. Reenviarlo da `23505` en `pets_owner_client_request_id_key` y la fila se lee por la
clave (`findByRequestId`), así que nunca se crea una segunda mascota. Esto vale también con reenvíos
simultáneos o tras cerrar la app con el alta en vuelo (`inFlightSince` se anota antes de enviar). Si
alguien edita el borrador mientras se envía, el alta se confirma y lo nuevo queda como edición sobre la
fila creada.

**Ediciones con precondición** (sin cambios de esquema): se envían con `update … eq('id', …).eq('updated_at', base)`,
que es un compare-and-set atómico (probado con sesiones simultáneas reales). Si actualiza 0 filas, se
lee la fila:

| Fila leída | Resultado |
|---|---|
| ya tiene exactamente lo local | sincronizada (respuesta perdida o el mismo cambio) |
| no existe o no se ve | `forbidden` (`not_visible`), datos intactos |
| misma versión que la base | `forbidden` (`not_editable`: lo filtró RLS, no hay permiso) |
| otra versión, cambios en otros campos | se reaplica lo local sobre la versión nueva y se reenvía |
| otra versión, los mismos campos con otros valores | `conflict`: decide el usuario |
| versión anterior a la base o que no se puede comparar | `conflict` (no se demuestra cuál es la actual) |

La fusión se hace por grupos: especie y raza van juntas. Nunca se unen textos ni se sobrescribe un
campo que cambió en el servidor sin que el usuario lo decida (`(app)/pets/[id]/resolve`). Al guardar
la decisión se vuelve a leer el servidor: si cambió otra vez, se vuelve a pedir. Un `42501` o una sesión
rechazada nunca se reintentan solos.

Límites:
- `updated_at` es `now()`. En teoría, dos versiones podrían coincidir al microsegundo.
- Un cambio solo de foto en otro dispositivo también cambia `updated_at`. Como no choca, se reaplica lo
  local sin preguntar.
- Si la mascota se creó y otro dispositivo la borró antes de recuperar la respuesta, el reenvío la
  vuelve a crear. No es un duplicado, porque la original ya no existe.

**Envío.** Mismas reglas que Daily Logs:
- Una pasada a la vez y una operación detrás de otra, con las altas primero.
- Solo con conectividad, la sesión del dueño (`setSessionUserId`) y el token del dueño en la cabecera
  (`createOwnerAccessToken`).
- Un 401 bloquea los envíos hasta tener una sesión nueva.
- La red no cuenta como intento; tras `MAX_SYNC_ATTEMPTS` fallos del servidor, pasa a `failed`.
- Disparadores: arranque, conectividad, primer plano, cada guardado y la sesión renovada.
- Lo confirmado pasa a la copia de mascotas (`cache.applyPet`) con la marca tomada antes de enviar.
- Una respuesta que llega tras cambiar de cuenta se guarda en los almacenes de su dueño, pero no toca la
  caché de TanStack Query ni la interfaz de la cuenta nueva (`isCurrentUser`).

**Interfaz.**
- Lista, ficha, pestaña Perfil y formulario muestran la mascota con lo local encima, con su estado como
  etiqueta y aviso (texto e icono, nunca solo color):
  - Pendiente de crear.
  - Cambios pendientes.
  - Sincronizando.
  - Comprobando si se guardó (resultado incierto).
  - Conflicto.
  - No se pudo sincronizar (con «Corregir» si el servidor rechazó los datos y «Reintentar» si fue un
    error suyo).
  - Sin permiso: los datos se muestran para copiarlos o descartarlos.
- Descartar es solo local y con confirmación. No se puede descartar un envío de resultado incierto.
- Las altas sin confirmar van aparte («Guardadas solo en este dispositivo»), nunca pasan a ser la
  mascota activa y no tienen registros diarios ni foto. Las rutas de Daily Logs con un id local muestran
  «disponibles cuando la mascota se sincronice» (`withServerPetId`), sin montar nada de Daily Logs, y el
  servidor rechaza un id temporal en `save_daily_log` (`22P02`).
- Al confirmarse el alta, el id local redirige al del servidor.

**Formularios** (`pet-form-gate.ts`). Sin conexión se abren si hay con qué rellenarlos:
- El catálogo de especies: del servidor o de su copia en el dispositivo
  (`kitom:v1:<userId>:species-catalog:<locale>`, guardada al leerlo con conexión).
- En la edición, la mascota: del servidor, de la copia o el borrador.

Avisan de que se guardará en el dispositivo. Con conexión esperan hasta 5 s (`SUBMIT_WAIT_MS`) a que el
servidor confirme. Si el servidor rechaza los datos, el error se muestra en el formulario y los datos
siguen guardados.

El permiso de edición no se guarda nunca. Sin poder comprobarlo se permite editar y el servidor decide
al sincronizar. Si se sabe que no hay permiso, no se ofrece.

La foto y el borrado necesitan conexión:
- El alta sin conexión no permite elegir foto.
- Con conexión, la foto se sube cuando el servidor confirma el alta, como antes.
- Borrar una mascota descarta su edición pendiente en el dispositivo.

**Validación y endurecimiento (fase 8.5).** Verificado a mano en el emulador Android (Expo Go contra
el Supabase local en `10.0.2.2`, modo avión, peticiones contadas en los registros de Kong) y en web
(Chromium con Playwright, sin red o con el Supabase bloqueado):

| Caso | Android | Web | Resultado |
|---|---|---|---|
| Crear con conexión | sí | — | una fila con `client_request_id` |
| Editar sin conexión, cerrar la app y reabrir | sí | recarga de pestaña | el cambio sigue en el dispositivo |
| Volver la red | sí | sí | **un** `PATCH` con `updated_at=eq.<base>` |
| Crear sin conexión, reiniciar y sincronizar | sí | sí | **un** `POST`; el borrador pasa a la lista del servidor |
| Respuesta perdida tras un alta confirmada | no (no se puede cortar solo la respuesta) | no | cubierto en integración (`pets-offline-writes`) |
| Mismo campo cambiado en otro dispositivo | sí | — | conflicto, `PATCH` de 0 filas, el usuario elige, sin sobrescribir |
| Acceso revocado (co-tutor) | sí | — | «sin permiso», datos para copiar o descartar |
| Cambio de cuenta con pendientes | sí | sí | ni se ven ni se envían con la otra cuenta (0 escrituras) |
| Cerrar sesión conservando y volver el propietario | sí | sí | se envía **una** vez |
| Fotos y borrado sin conexión | sí | — | no se ofrecen |
| Dos pestañas de la misma cuenta | — | sí | alta: `201` + `409` (una mascota); edición: dos `PATCH`, uno aplica y el otro 0 filas → sincronizada |

Defectos encontrados y corregidos:
- El cierre de sesión no contaba las operaciones de mascotas: con solo mascotas pendientes se cerraba
  sin preguntar.
- El formulario seguía bloqueando el envío sin conexión (resto de la fase 7): botón deshabilitado.
- Las ediciones de mascotas que ya no se ven (sin permiso, borradas) no aparecían en la lista: ahora
  están en «Cambios de mascotas que ya no ves» (`orphanedEdits`).
- Sin el catálogo de razas no se podía escribir la raza a mano; el nombre de una raza del catálogo se
  quedaba «Cargando…» y en la ficha salía «Sin indicar». Ahora se ofrece «Otra / no aparece», se dice
  que el nombre no está disponible sin conexión y la ficha muestra «Con raza».

**Concurrencia de la edición.** El `UPDATE … eq('updated_at', base)` es atómico (comprobado con
sesiones simultáneas en `pets_concurrency.sh`). `photo_path` no se envía nunca: un cambio de foto en
otro dispositivo solo cambia `updated_at`, así que la edición se reaplica sobre la versión nueva y la
foto nueva se conserva (un `PATCH` más). Límite: `updated_at` es `now()` (inicio de la transacción); dos
ediciones que empiecen en el mismo microsegundo podrían dejar el mismo valor y la segunda no se
detectaría. Sin migración, la alternativa sería comparar en el `WHERE` todas las columnas editables de
la base, pero las listas de texto en filtros de PostgREST obligan a escapar comillas y comas, y un error
daría conflictos falsos o, peor, una precondición incompleta. Se deja documentado; la solución robusta
es una fase `db/` aparte con una columna de versión (p. ej. `row_version bigint` que incremente un
trigger) y la precondición sobre ella.

**Dos pestañas (web).** No hay coordinación de colas entre pestañas: cada una tiene su motor sobre el
mismo `localStorage` y las dos pueden enviar la misma operación. No duplica ni sobrescribe (clave del
alta y precondición de la edición, verificado). Queda una ventana de milisegundos: si se edita una
mascota en una pestaña justo mientras la otra confirma el envío de una edición anterior de esa misma
mascota, la confirmación puede borrar del dispositivo la edición nueva antes de enviarla (las
escrituras locales son atómicas dentro de una pestaña, no entre pestañas). Solución futura: Web Locks o
`BroadcastChannel` para que una sola pestaña sincronice.

**Catálogo de razas sin conexión** (comprobado en web con el Supabase bloqueado y la pestaña recargada):
el de especies sale de la copia del dispositivo; el de razas no. Sin él se puede elegir «mestizo»,
«desconocida», «sin contestar» y, desde la fase 8.5, escribir la raza a mano. Cambio mínimo propuesto
para elegir del catálogo sin conexión: guardar en `LocalStore` la lista de razas de cada especie al
cargarla (`breeds-catalog:<speciesId>:<locale>`, como `species-catalog`) y usarla solo sin conexión.

**Pendiente:**
- Copia del catálogo de razas (ver arriba) y columna de versión para la edición (fase `db/`).
- Coordinación entre pestañas en web.
- No hay registros diarios para mascotas aún no creadas en el servidor.
- Limpieza (no automática) de las operaciones de cuentas que no vuelven.

### Infraestructura (fase 1 del frontend)

Módulos puros y probados (`npm test`) sobre los que se construye la integración. Decisiones:
`DECISIONS.md` (2026-10-13).

**LocalStore** (`frontend/src/lib/local-store/`).
- `local-store.ts`: `createLocalStore(storage, userId)` → `read`, `write`, `remove`, `list` sobre
  colecciones tipadas (`LocalCollection<T>`: `name`, `version`, `parse`, `matchesKey`). El proveedor se
  inyecta como `KeyValueStorage` (`getItem`, `setItem`, `removeItem`, `getAllKeys`).
- Adaptadores: `async-storage-adapter.ts` + `device-storage.ts` (AsyncStorage) y `memory-storage.ts`
  (tests).
- **Claves:** `kitom:v1:<userId>:<colección>:<id>[:<id>…]`, una por elemento (nunca una cola en una
  sola clave). Registros diarios: `kitom:v1:<userId>:daily-logs:<petId>:<logDate>`. Los segmentos solo
  admiten `[A-Za-z0-9_-]`. `v1` es la versión del formato de claves.
- **Valor:** JSON `{ "v": <versión de la colección>, "data": … }`.
- **Lectura:** `found` | `missing` | `corrupt` (`invalid_json`, `invalid_envelope`, `invalid_data`,
  `key_mismatch`) | `unknown_version`. Lo que no es válido nunca se devuelve como dato ni se borra
  solo: decide quien lee. Un fallo del proveedor lanza `LocalStoreError('storage_failed')`.
- **Aislamiento:** cada almacén solo ve las claves de su `userId`; además un valor guardado bajo la
  clave de otro usuario, mascota o fecha se rechaza (`key_mismatch`).
- **No es almacenamiento seguro.** AsyncStorage no cifra en reposo y en web es `localStorage`
  (legible por cualquier script del mismo origen). Nunca tokens ni credenciales (la sesión sigue en
  `secure-session-storage.ts`); las notas se guardan en claro en el dispositivo. El módulo no escribe
  contenido en logs. Límites por defecto: Android ~6 MB en total y ~2 MB por valor; web ~5 MB por origen.

**Modelo local** (`frontend/src/features/daily-logs/offline/local-daily-log.ts`, colección
`localDailyLogs`, versión 1). Un registro por (`userId`, `petId`, `logDate`):

| Campo | Contenido |
|---|---|
| `userId`, `petId`, `logDate` | identidad; `logDate` (`YYYY-MM-DD`) se fija al crear y ninguna transición la cambia |
| `serverRow` | última fila de `daily_logs` confirmada por el servidor, o `null` |
| `baseVersion` | `serverRow.updated_at`, la cadena exacta de PostgREST; `null` = se espera que no exista |
| `status` | `synced` · `pending` · `failed` (rechazo permanente) · `conflict` |
| `pending` | la única operación pendiente: `operationId` (UUID v4), `revision`, `content` (registro completo, columnas de la BD), `attempts` (envíos fallidos; marca el backoff), `countedAttempts` (los que cuentan para el límite: fallos con respuesta del servidor), `nextAttemptAt`, `editedAt`; `null` si `synced` |
| `error` | último error: `kind`, `reason` (código, nunca el mensaje), `at` |
| `conflict` | `detail` (`version_mismatch`, `row_missing` o `row_exists`), `remote` (`not_fetched`, `absent` o `present` + fila), `detectedAt` |

- **Validación** (`parseLocalDailyLog`, al leer y tras cada transición): forma de cada campo (UUID en
  minúsculas, fecha real, niveles 1–5 o `null`, `updated_at` como cadena) y coherencia (`baseVersion`
  igual a `serverRow.updated_at`; `synced` ⇔ sin operación; `conflict` ⇔ con datos de conflicto;
  `failed` con error; filas de la misma mascota y fecha). Un registro no válido es `corrupt`.
- **Ediciones sucesivas:** `applyLocalEdit` actualiza la misma operación (mismo `operationId`,
  contenido sustituido, `revision + 1`, intentos a cero). La base se fija al crear la operación. Sin
  cambios respecto a la fila del servidor no se crea operación.
- **Identificador de operación:** se genera una sola vez, al crear la operación; ediciones,
  reintentos y conflictos lo conservan. Único generador: `createOperationId()` de
  `frontend/src/lib/device-operation-id.ts` (`expo-crypto`, `randomUUID`), sobre la lógica pura de
  `lib/operation-id.ts`. Nunca `Math.random`: si la fuente falla, lanza `OperationIdError`. El modelo
  rechaza cualquier `operationId` que no sea un UUID v4. En web necesita contexto seguro (HTTPS o
  localhost).
- **Precondición:** `toSyncPrecondition` → `p_expected_updated_at: baseVersion` o
  `p_expect_absent: true`. Nunca una llamada sin precondición.
- **Resultados de un envío:** `applySyncSuccess` (la fila devuelta pasa a ser la base; si hubo otra
  edición durante el envío, sigue pendiente), `applySyncFailure`, `setConflictRemote`, `resolveConflict`.
- **Nunca se descarta una operación.** `failed` (rechazo permanente o intentos agotados) conserva el
  contenido y el error; no se reintenta sola y vuelve a `pending` con `retryFailedSync` (reintento
  pedido por el usuario) o con una edición.
- Los instantes locales son ms del reloj del dispositivo y no se envían al servidor.

**Errores de sincronización** (`offline/sync-errors.ts`, `classifySyncError(error, httpStatus)`):

| Tipo | Cuándo | Qué se hace |
|---|---|---|
| `network` | no hubo respuesta (fetch lanzó o se abortó) | reintento con backoff; nunca agota los intentos |
| `server` | 5xx, 408, 429, Postgres 08/40/53/57, `PGRST000`–`003` | reintento con backoff; `failed` tras 8 fallos con respuesta |
| `auth` | 401, `PGRST301`–`303` | esperar a tener sesión; no cuenta como intento |
| `permission` | `42501`, 403 | `failed` |
| `validation` | `log_date_future`/`log_date_too_old`, Postgres 22/23 | `failed` |
| `conflict` | `P0001` + `hint` `daily_log_conflict` | `conflict`: leer la fila remota y fusionar |
| `unknown` | cualquier otro caso | otro 4xx → `failed`; sin datos → reintento con límite |

Una respuesta HTTP nunca se clasifica como `network`, y `network` se decide por el mensaje de `fetch`,
no por el tipo: un `TypeError` cualquiera es `unknown` y sí tiene límite. Solo los fallos con respuesta
cuentan para el límite: una racha sin conexión no acerca una operación a `failed`. Con `auth` el modelo
no programa espera: quien sincronice debe esperar a tener sesión antes de reenviar.

Backoff (`offline/sync-backoff.ts`): 2 s × 2ⁿ con tope de 5 min; la mitad fija y la otra mitad
aleatoria; reloj y azar inyectables. **Valores provisionales** (base, tope y límite de 8): no hay
datos de uso que los respalden; hay que validarlos al construir el motor de sincronización.

**Fusión a tres bandas** (`offline/daily-log-merge.ts`, `mergeDailyLogContent({ base, local, remote })`).
Por unidad: si solo cambió un lado, gana ese lado; si cambiaron a lo mismo, no hay conflicto; si
cambiaron a valores distintos, **conflicto** y decide el usuario (nunca se pisa en silencio).
- Cada nivel es una unidad.
- `unusual_behavior` + `unusual_behavior_notes` son una sola unidad.
- `notes`: dos ediciones distintas son siempre conflicto, aunque una contenga a la otra. No se
  concatenan solas: «conservar ambas» es un texto que el usuario revisa y edita
  (`suggestCombinedText` solo propone, sin duplicar ni recortar; si no cabe en el límite, hay que
  acortarlo o elegir).
- `tags`: se fusionan como conjunto, etiqueta a etiqueta; no generan conflicto. Sin duplicados y
  ordenadas, como en la RPC. Una etiqueta remota desconocida para esta versión se conserva.
- Sin `base` (creado sin conexión y ya existía, `row_exists`) se compara con un registro vacío.
- Sin estrategia automática, pendientes de decisión del usuario: fila remota borrada
  (`remote_deleted`) y fusión que deja el registro vacío (`empty_result`).
- Si lo local ya es lo que tiene el servidor (respuesta perdida de un envío anterior), queda
  `synced` sin reenviar.

**Conectividad** (`frontend/src/lib/connectivity.ts`, conectada en `lib/query-client.ts`).
`expo-network` → `onlineManager.setEventListener` de TanStack Query, en móvil y web. Es una señal:
solo hay «sin conexión» si el sistema afirma `isConnected === false`; estado desconocido o error de
lectura = conectado. `isInternetReachable` no se usa. Sin polling: eventos del sistema y una lectura
inicial. TanStack Query llama a la limpieza al sustituir el listener o quedarse sin suscriptores.

`networkMode` (`frontend/src/lib/query-defaults.ts`, probado contra `@tanstack/query-core`): conserva
lo que hacía cada plataforma antes de existir la señal. Solo Daily Logs fija el suyo
(`offline/daily-log-cache.ts`: queries locales y la mutación de guardado).
- **Móvil: `always`.** Antes TanStack Query no recibía señal de red en móvil, así que toda petición
  se intentaba y sin red fallaba con `network`; `always` es eso mismo. Con el modo por defecto las
  queries se quedarían cargando y las mutaciones de Pets, fotos y Daily Logs quedarían en pausa y se
  enviarían solas al reconectar.
- **Móvil: revalidación al reconectar (`refetchOnReconnect: true`, 2026-10-20).** Con `always`
  TanStack Query la desactiva por defecto y una query que falló sin red se quedaba en error hasta
  pulsar «Reintentar». Al volver la red se vuelven a pedir las queries **caducadas** con observadores
  (las de `staleTime: Infinity`, como las locales de Daily Logs, no). Sin sesión utilizable no sale
  nada: toda query de servidor pasa por `serverCall` (también la de zona horaria) y AuthProvider las
  vuelve a pedir al recuperar la sesión. Red, primer plano y recuperación a la vez: una renovación y
  una petición por query (TanStack Query reutiliza la petición en curso; la invalidación de la
  recuperación solo sustituye intentos que `serverCall` ya cortó). Las mutaciones no cambian.
  Probado contra `@tanstack/query-core` con el controlador de sesión (`lib/query-defaults.test.mjs`).
- **Web: modo por defecto de TanStack Query, sin cambios** (también la revalidación al reconectar,
  que en web ya estaba activa). Con el navegador sin conexión las queries quedan en pausa y se lanzan
  al reconectar. El guardado de Daily Logs usa `networkMode: 'always'` para no quedar en pausa y
  enviarse sin precondición (§5, «Web»).
- Auth y la sincronización de la zona horaria no pasan por TanStack Query: no les afecta.

**Comprobación del almacenamiento real** (`frontend/src/lib/local-store/local-store-check.ts`,
`checkLocalStore(deviceStorage, fase)`). Escribe, lee, lista, sobrescribe y borra datos de prueba
bajo usuarios reservados (`self-check-*`) y limpia al acabar; en dos fases (`write`, reiniciar la app,
`verify`) comprueba que los datos sobreviven a un reinicio. No forma parte de la app: se llama a
mano desde un build de desarrollo. Los tests de `npm test` (memoria y la implementación web de
AsyncStorage sobre un `localStorage` falso) **no equivalen** a una prueba en dispositivo. Ejecutada
el 2026-10-13: Android 16 (emulador, Expo Go 57.0.9) y Chromium, correcta en ambos, incluido el
reinicio. Sin probar: iOS, dispositivo Android físico y development build propio.

## 6. Errores — comportamiento esperado

| Código/situación | Comportamiento en UI |
|---|---|
| `not_authenticated` | redirigir a Login, limpiar sesión local |
| `not_pet_member` | "no tienes acceso a esta mascota", volver a Home |
| `not_pet_editor` | ocultar/deshabilitar la acción de escritura, no solo mostrar error al fallar |
| `permission_denied` (genérico de Postgres) | mensaje genérico + botón de reportar, no debería ocurrir si la UI ya oculta lo que no se puede hacer |
| `not_authorized` (Edge Function reautorizándose, ver sección 4) | tratar igual que `permission_denied` — indica que se intentó una acción sobre un recurso ajeno |
| `subscription_limit_reached` | abrir `Paywall` con el mensaje de `get_ai_analysis_entitlement()` |
| `ai_unavailable` (Edge Function caída/timeout) | mostrar estado `failed`, permitir reintentar (no consume cupo) |
| `already_processing_or_done` (respuesta de `ai-analysis-process`) | no es un error: tratar como éxito silencioso, seguir el poll/Realtime normal sobre la fila |
| `network_offline` | banner persistente, cola de sincronización visible |
| `storage_upload_failed` | reintentar la subida antes de llamar al RPC que depende de ese path (Pets: `photo_upload_failed`) |
| `invitation_expired` (estado ya no es `pending`) | refrescar la lista de invitaciones, mensaje claro |
| `ownership_transfer_failed` | mostrar el motivo exacto que da la excepción de `transfer_pet_ownership` (usuario no es co-tutor aceptado, etc.) |
| `invalid_log_date` | mismo tratamiento que "fecha inválida / futura" arriba |
| `has_pets` (respuesta 409 de `delete-account`) | dirigir a `OwnershipTransferScreen`, mensaje "transfiere tus mascotas antes de eliminar la cuenta" |
| `invalid_timezone` | si ocurre, es un bug del cliente: revisar que se está enviando un nombre IANA (ver sección 9), nunca una abreviatura |

## 7. Push tokens — ciclo de vida (nuevo en v2.2.1)

`push_tokens.token` es único a nivel global (es un identificador del dispositivo/instalación emitido por el sistema operativo, no algo exclusivo de una cuenta). El mismo teléfono puede tener sesiones de distintos usuarios a lo largo del tiempo, así que el frontend debe seguir esta disciplina exacta:

| Momento | Acción |
|---|---|
| **Login** | `rpc('register_push_token', { token, platform, device_id, app_version, os_version })` |
| **App launch** (con sesión ya activa) | repetir `register_push_token` — barato, idempotente, corrige `last_seen_at` |
| **Token refresh** (el SO rota el token) | repetir `register_push_token` con el nuevo `token` |
| **Logout** | recomendado (no obligatorio): `supabase.from('push_tokens').delete().eq('token', currentToken)` antes de cerrar sesión |
| **Cambio de usuario en el mismo dispositivo** | no hace falta lógica especial: el siguiente login vuelve a llamar `register_push_token`, que reasigna el token al nuevo `auth.uid()` automáticamente |

No intentar hacer `insert`/`update` directo sobre `push_tokens` para este caso — si el token ya pertenece a otro usuario, la policy `manage own` lo bloqueará (correctamente). `register_push_token` es la única vía pensada para el traspaso.

## 8. Seguridad en el cliente

- **La `service_role` key NUNCA va en la app** — solo `anon` key + JWT de sesión.
- El cliente **nunca** confía en valores que él mismo generó o recibió para decidir lógica de negocio: `user_id`, `owner_id`, plan de suscripción, entitlement de IA, coste/modelo/proveedor/estado/resultado de IA, `used_full_history`. Todo eso se re-lee siempre desde Supabase (RLS/RPC son la autoridad), nunca se calcula ni se confía en el lado del cliente aunque "ya se sepa" por una pantalla anterior.
- **Ninguna llamada a una RPC de validación (`request_ai_analysis`, `request_generate_report`, o consultar `owner_has_pets`) sustituye la autorización real de la Edge Function que viene después.** El frontend debe estar preparado para que `ai-analysis-process`, `generate-pet-report` o `delete-account` devuelvan `403`/`409` aunque el paso anterior haya ido bien — no es un bug, es el contrato de seguridad: cada Edge Function se autoriza a sí misma de forma independiente (ver sección 4, `AIAnalysisScreen`/`ReportsScreen`/`DeleteAccountScreen`).
- Cualquier UI que oculte una acción por permisos (botones deshabilitados, pantallas no accesibles) es solo UX — la protección real está en la base de datos, así que un fallo de UI nunca es un fallo de seguridad.

## 9. Timezone — formato exacto que espera el backend

`profiles.timezone` lo valida en el servidor el trigger `validate_profile_timezone` (ver README, sección 14; migración `20261008155257_profile_timezone.sql`). El frontend debe enviar siempre un **identificador IANA de zona**: `UTC` o Área/Ubicación existente en `pg_timezone_names`.

- ✅ `Europe/Madrid`, `America/New_York`, `America/Argentina/Buenos_Aires`, `UTC`
- ❌ `+01:00`, `GMT+1`, `CET`, `PST`, `GMT+0`, `posix/Europe/Madrid`: offsets, abreviaturas y alias. La validación los rechaza (`P0001`, `hint` `invalid_timezone`), aunque algunos estén en `pg_timezone_names`.

**`NULL` = sin configurar.** Es el valor de un perfil nuevo; el servidor usa `UTC` donde necesita un "hoy" (`daily_logs`).

En React Native/Expo, obtener el nombre IANA del dispositivo con `Intl.DateTimeFormat().resolvedOptions().timeZone` — no construirlo a mano a partir del offset UTC del dispositivo.

### Inicialización (implementado)
Código: `frontend/src/features/profile/` — `timezone.ts` (detección, validación e inicialización; módulo puro probado con `npm test`), `api/profile-api.ts`, `hooks/use-profile-timezone-sync.ts`.
- `useProfileTimeZoneSync()` se monta una vez en `(app)/_layout.tsx` (solo con sesión). Una vez por usuario y arranque de la app.
- Detecta la zona del dispositivo y la valida igual que el servidor. Si no hay una válida, no hace nada.
- **WRITE:** `profiles.update({ timezone }).eq('id', userId).is('timezone', null)`: guarda solo si el perfil no tiene zona, en la propia consulta (atómico y idempotente; sin leer antes). Nunca sobrescribe un valor existente: cambiarlo será una acción explícita de Settings (pendiente).
- Un fallo (red, servidor, zona rechazada) no rompe la sesión ni la app: se ignora (aviso en dev) y se reintenta en el siguiente arranque.
- Limitación conocida: si el usuario viaja, el perfil conserva la zona inicial hasta que la cambie a mano.

## 10. TypeScript

Generar tipos directamente desde el esquema, no mantenerlos a mano:

```bash
supabase gen types typescript --project-id <project-id> --schema public > src/types/database.types.ts
```

Repetir cada vez que cambie el esquema. Los tipos de los parámetros/retorno de las funciones RPC (`request_ai_analysis`, `transfer_pet_ownership`, `register_push_token`...) también se generan ahí — usarlos directamente en las llamadas `supabase.rpc(...)` en vez de redefinir interfaces manuales que puedan desincronizarse.

## 11. Orden de construcción del frontend

| Fase | Contenido |
|---|---|
| 1 | Auth + Profile |
| 2 | Onboarding + Create Pet |
| 3 | Home + Pet Dashboard |
| 4 | Daily Logs + Offline |
| 5 | Reminders |
| 6 | AI |
| 7 | Co-owners |
| 8 | Achievements + Streaks |
| 9 | Subscription / Paywall |
| 10 | Reports / Sharing |

Cada fase debe dejar la app usable de principio a fin con lo construido hasta ese punto (no bloques a medio terminar) antes de pasar a la siguiente.
