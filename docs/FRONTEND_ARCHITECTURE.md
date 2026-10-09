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

## 2. Estados de Auth

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
| Offline persistence | `daily_logs` creados sin conexión | ver sección 6 |
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
Rutas: `(app)/pets/index`, `pets/new`, `pets/[id]/index`, `pets/[id]/edit`. Código: `frontend/src/features/pets/`.
- **READ:** `pets` con columnas explícitas y **sin filtrar por `owner_id`**: RLS (`is_pet_member`) devuelve
  las propias y las compartidas con `pet_co_owners.status = 'accepted'`. Especies: `species` (todas, para
  poder mostrar una ya desactivada) + `catalog_translations` (`entity_type='species'`, `field='name'`,
  `locale` activo), combinadas en el cliente porque la tabla de traducciones es polimórfica (sin FK).
- **WRITE (insert):** columnas editables + `owner_id = auth user id` tomado de la sesión, nunca del
  formulario (`pets: insert own`). `id`, `is_active`, `photo_path` y timestamps no se envían. Se pide
  la fila creada (`RETURNING`), lo que requiere que la política SELECT acepte al propietario
  directamente (migración `20261007172110`).
- **WRITE (update):** solo columnas editables: `name`, `species_id`, `sex`, `breed`, `birth_date`,
  `weight_kg`, `sterilized`, `known_conditions`, `allergies`, `temperament_notes`. `owner_id` no tiene
  GRANT de UPDATE (transferencia solo por `transfer_pet_ownership`). Si RLS filtra la fila
  (`can_edit_pet` falso), el update no devuelve fila y se trata como `not_allowed`.
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
- **Query keys:** `['pets','list']`, `['pets','detail',id]`, `['pets','detail',id,'can-edit']`,
  `['pets','photo',path]`, `['species',locale]`, `['breeds','list',speciesId,locale]`,
  `['breeds','detail',breedId,locale]`. Crear/editar/borrar invalidan `['pets','list']` y
  actualizan o eliminan el detalle. La caché se vacía al cambiar de usuario (AuthProvider).
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
- **READ:** `pets` (mascotas del usuario), `pet_streaks`, `daily_logs` (último registro), `reminders` (próximos)
- **WRITE:** —
- **RPC:** ninguno

### DailyLogScreen
Backend: migración `20261008150202_daily_logs_fixes.sql`. Frontend **fase 1 implementada** (registro
de hoy, online; sin offline ni historial). Decisiones: `DECISIONS.md`.

**Implementación (fase 1).** Ruta `(app)/pets/[id]/daily-log` (registro de **hoy**); entrada desde la
ficha con `TodayLogCard` (estado de hoy + botón). Código: `frontend/src/features/daily-logs/`:
`api/daily-logs-api.ts`, `hooks/use-daily-log.ts`, `hooks/use-today-log-date.ts`, `log-date.ts`,
`daily-log-form.ts` (valores, validación, payload y estado del editor), `daily-log-errors.ts`,
`query-keys.ts`, `types.ts`, `components/` (`DailyLogEditor`, `ScaleSelector`, `TagSelector`,
`TodayLogCard`). Pruebas: `*.test.mjs` (`npm test`).
- **"Hoy":** solo `useTodayLogDate()` / `todayLogDate()`: día del calendario (`Intl`, nunca
  `toISOString`) en la zona del **perfil** → la del **dispositivo** si es `NULL`/no válida → `UTC`. La
  pantalla fija la fecha al abrirse (el registro que se rellena no cambia de día); la tarjeta de la
  ficha la recalcula al volver a primer plano.
- **Abrir:** lee `daily_logs` por (`pet_id`, `log_date`); si no hay, formulario vacío. Nunca crea nada
  al abrir. Los cambios posteriores de la query no pisan lo que se está editando.
- **Guardar:** `rpc('save_daily_log', toSaveDailyLogArgs(...))` con el registro completo. Botón
  deshabilitado + `createSubmitGuard` (`lib/submit-guard.ts`) contra dobles toques; el formulario se
  bloquea mientras guarda. Éxito: la fila devuelta pasa al formulario y a la caché, se invalida solo
  `['daily-logs','detail',petId,logDate]` y se muestra «Registro guardado.» sin salir. Error: se
  conservan los datos y se muestra el mensaje (`dailyLogs.errors.*`).
- **Tipos:** los generados marcan todos los parámetros de la RPC como no nulos; `SaveDailyLogArgs`
  (`types.ts`) admite `null` en niveles y notas y se convierte al tipo generado solo en la API.
- **«Todo como siempre»:** pone las 7 escalas en 3 en el formulario; no guarda ni toca lo opcional.
  Tocar una opción ya elegida la deja en `null`.
- **Comportamiento inusual:** la nota solo se envía con el interruptor activado (el campo no se ve si
  está desactivado).
- **Permisos (UX):** `can_edit_pet` (`useCanEditPet`). Sin permiso: formulario de solo lectura (o
  «Todavía no hay registro de hoy»), sin botones de guardar. RLS/RPC siguen siendo la autoridad.
- **Query keys:** `['daily-logs','detail',petId,logDate]` (`null` = no existe), `['profile','timezone']`.
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
  `daily_logs_tags_check`); fallo de red → `network`.
- **Storage:** ninguno

### HistoryScreen
- **READ:** `daily_logs` (rango de fechas), `pet_streaks`
- **WRITE:** —
- **RPC:** ninguno

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
- **READ:** `pet_co_owners`, `pets`
- **WRITE:** ninguna directa
- **RPC:** `invite_pet_member`, `accept_pet_invitation`, `decline_pet_invitation`, `revoke_pet_invitation`, `change_pet_member_role`

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

## 5. Offline (daily logs)

```
Usuario completa el formulario
  ↓
Persistencia local inmediata (SQLite/MMKV/AsyncStorage — cualquiera vale,
no hace falta una solución compleja), con clave (user_id, pet_id, log_date):
varias ediciones sin red del mismo día se combinan en una sola entrada
  ↓
Si hay red: rpc('save_daily_log', …) con el registro completo
Si no hay red: se queda en cola de sincronización
  ↓
Al recuperar conexión: procesa la cola en orden
  ↓
success  -> marca como sincronizado (no hay id local que sustituir: la
            identidad es (pet_id, log_date) y el cliente no envía `id`)
conflict -> no existe: si otro dispositivo ya creó el registro de ese día,
            save_daily_log lo actualiza (gana el último guardado)
retry    -> reintento con backoff simple; no bloquea la cola completa
            si un solo item falla
```

Casos a manejar explícitamente en la UI:
- **Fecha inválida / futura / fuera de la ventana:** `validate_daily_log_date` la rechazará (`hint` `log_date_future` o `log_date_too_old`); no reintentar automáticamente. Consecuencia de la ventana de creación de 7 días: un registro **nuevo** creado sin conexión que tarde más de 7 días en sincronizarse será rechazado (editar uno que ya existe en el servidor no tiene límite).
- **Permisos perdidos mientras estaba offline** (p. ej. el owner revocó el acceso del co-tutor): `save_daily_log` fallará con `42501` al reconectar; mostrar "ya no tienes acceso a esta mascota", no reintentar indefinidamente.
- **Timezone:** el `log_date` se calcula en el momento de crear el registro (sección 14 del README), no al sincronizar — así un registro offline no cambia de día solo por tardar en subir.

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
